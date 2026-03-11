import jsPDF from 'jspdf';
import { Loan, Client, settingsService } from '../services/api';

// --- HELPER FUNCTIONS ---

const formatMoney = (value: number) => {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatDateExtenso = (dateStr: string) => {
  if (!dateStr) return '___/___/_____';
  try {
    const date = new Date(dateStr);
    date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
    return date.toLocaleDateString('pt-BR', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (e) {
    return dateStr;
  }
};

const formatDateShort = (dateStr: string) => {
    if (!dateStr) return '__/__/__';
    try {
        const date = new Date(dateStr);
        date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
        return date.toLocaleDateString('pt-BR');
    } catch (e) {
        return dateStr;
    }
}

// Resgata o valor ORIGINAL exato do dia 1
const getOriginalAmount = (loan: Loan): number => {
    if (loan.history && loan.history.length > 0) {
        // Procura no histórico o registo de Abertura
        const openingRecord = loan.history.find(h => 
            h.type.toLowerCase().includes('abertura') || 
            h.type.toLowerCase().includes('empréstimo')
        );
        if (openingRecord && openingRecord.amount > 0) return openingRecord.amount;
    }
    // Se não tiver histórico, faz a conta matemática reversa segura
    return Number(loan.amount) || 0; 
};

// Resgata o número ORIGINAL de parcelas (O que falta + o que já foi pago)
const getOriginalInstallmentsCount = (loan: Loan): number => {
    const remaining = Number(loan.installments) || 0;
    
    // Se for juros simples, as parcelas são infinitas (ou 1 pra fins de contrato)
    if (loan.interestType === 'SIMPLE') return remaining > 0 ? remaining : 1;

    let paidCount = 0;
    if (loan.history) {
        // Conta quantas parcelas puras ou amortizações já foram pagas
        paidCount = loan.history.filter(h => 
            h.amount > 0 && 
            !h.type.toLowerCase().includes('abertura') && 
            !h.type.toLowerCase().includes('acordo') &&
            (h.capitalPaid && h.capitalPaid > 0) // Só conta se abateu capital (parcela real)
        ).length;
    }

    return remaining + paidCount;
};

const extractCityFromAddress = (address: string, defaultCity: string = "São Paulo"): string => {
    if (!address) return defaultCity;
    try {
        const parts = address.split(',');
        if (parts.length > 1) {
            let suffix = parts[parts.length - 1].trim(); 
            if (suffix.length < 3 && parts.length > 2) suffix = parts[parts.length - 2].trim();
            if (suffix.includes('-')) return suffix.split('-')[1].trim().split('/')[0];
            if (suffix.includes('/')) return suffix.split('/')[0].trim();
            return suffix;
        }
        return defaultCity;
    } catch (e) { return defaultCity; }
}

// --- FUNÇÃO DE DESIGN (MARCA D'ÁGUA E TIMBRADO) ---
const addProfessionalBranding = (doc: jsPDF, companyName: string, type: 'portrait' | 'landscape' = 'portrait') => {
    const width = type === 'portrait' ? 210 : 297;
    const height = type === 'portrait' ? 297 : 210;

    // 1. Faixa de Cabeçalho Timbrado (Azul Escuro/Cinza)
    doc.setFillColor(30, 41, 59); // slate-800
    doc.rect(0, 0, width, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(companyName.toUpperCase(), 15, 8);

    // 2. Marca D'água Central (Nome da Empresa em Cinza Claro, Rotacionado)
    doc.setTextColor(235, 240, 245); // Muito claro, quase invisível
    
    // Pega a primeira palavra do nome da empresa para a marca de água
    const shortName = companyName.split(' ')[0] || 'FINANCEIRA';
    
    // Ajuste dinâmico de tamanho para nomes muito grandes (como "AAAAAAAAAAAA") não vazarem da página
    let fontSize = type === 'portrait' ? 60 : 80;
    if (shortName.length > 10) fontSize = 40; 

    doc.setFontSize(fontSize);
    doc.setFont("helvetica", "bold");
    
    // O baseline: "middle" é o segredo para centralizar perfeitamente no eixo Y antes de rodar
    doc.text(shortName.toUpperCase(), width / 2, height / 2, {
        align: "center",
        baseline: "middle", 
        angle: 45
    });

    // 3. RESET RIGOROSO DAS FONTES (Para não afetar o resto do documento)
    doc.setTextColor(0, 0, 0);
    doc.setFont("times", "normal");
    doc.setFontSize(10);
};

// Formata o nome do arquivo para evitar erros de sistema (ex: tira barras do ID)
const getSafeFileName = (prefix: string, loanId: string, clientName: string) => {
    const safeId = loanId ? loanId.replace(/\//g, '-') : '000';
    const safeName = clientName ? clientName.replace(/\s+/g, '_') : 'Cliente';
    return `${prefix}_${safeId}_${safeName}.pdf`;
};

// --- GERADOR DO CONTRATO (COM FIADOR E DADOS ORIGINAIS) ---

export const generateContractPDF = async (loan: Loan, clientData?: Client) => {
  const settings = await settingsService.get();
  const companyData = settings?.company || settings?.general || {};

  // Extração Blindada
  const lenderName = companyData.name || "NOME DA EMPRESA NÃO CONFIGURADO";
  const lenderCNPJ = companyData.cnpj || "CNPJ NÃO CONFIGURADO";
  const lenderAddress = companyData.address || "Endereço da Sede Não Configurado";
  const lenderPix = companyData.pixKey || "PIX DA EMPRESA NÃO CONFIGURADO"; 
  
  const pixDestino = loan.paymentMethod || "Não informado"; 
  const bankInfo = loan.clientBank ? ` no Banco ${loan.clientBank}` : "";
  
  const borrowerName = clientData?.name || loan.client || "__________________________";
  const borrowerCPF = clientData?.cpf || "___.___.___-__";
  const borrowerRG = clientData?.rg || "________________"; 
  const borrowerAddress = clientData?.address 
    ? `${clientData.address}, ${clientData.number || 'S/N'} - ${clientData.neighborhood || ''}, ${clientData.city || ''}/${clientData.state || ''}, CEP: ${clientData.cep || ''}`
    : "Endereço não informado";

  const hasGuarantor = !!loan.guarantorName;
  const guarantorName = loan.guarantorName || "";
  const guarantorCPF = loan.guarantorCPF || "";
  const guarantorAddress = loan.guarantorAddress || "";

  const contractCity = extractCityFromAddress(lenderAddress, clientData?.city || "São Paulo");
  
  // Usa as novas funções matemáticas que preservam o estado inicial
  const originalAmount = getOriginalAmount(loan);
  const originalInstallmentsCount = getOriginalInstallmentsCount(loan);

  const doc = new jsPDF();
  const margin = 20;
  const pageWidth = 210;
  const maxLineWidth = pageWidth - (margin * 2);
  let y = 30; // Começa mais abaixo por causa do cabeçalho

  // Aplica o Timbrado e Marca de Água na Página 1
  addProfessionalBranding(doc, lenderName, 'portrait');

  const checkPageBreak = (neededHeight: number) => {
      if (y + neededHeight > 280) {
          doc.addPage();
          addProfessionalBranding(doc, lenderName, 'portrait');
          y = 30;
          return true;
      }
      return false;
  };

  const addText = (text: string, isBold: boolean = false, align: 'left' | 'center' | 'right' | 'justify' = 'justify', fontSize: number = 10) => {
    doc.setFont("times", isBold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxLineWidth);
    const blockHeight = lines.length * 5;
    
    const pageBroke = checkPageBreak(blockHeight);
    if (pageBroke) {
        // Se quebrou a página, a marca d'água reseta a fonte. Precisamos reaplicar!
        doc.setFont("times", isBold ? "bold" : "normal");
        doc.setFontSize(fontSize);
    }
    
    if (align === 'justify' || align === 'left') doc.text(lines, margin, y, { align: 'left', maxWidth: maxLineWidth });
    else if (align === 'center') doc.text(lines, pageWidth / 2, y, { align: 'center', maxWidth: maxLineWidth });
    else if (align === 'right') doc.text(lines, pageWidth - margin, y, { align: 'right', maxWidth: maxLineWidth });
    y += blockHeight + 2;
  };

  const addSpace = (size: number = 5) => { y += size; };

  addText("INSTRUMENTO PARTICULAR DE MÚTUO", true, 'center', 14);
  addSpace(5);
  addText("Pelo presente Contrato de Mútuo, e na melhor forma de direito, as Partes:");
  addSpace(2);
  
  addText(`${lenderName.toUpperCase()}, inscrita no CNPJ sob o nº ${lenderCNPJ}, com sede na ${lenderAddress}, neste ato designado por "MUTUANTE";`, true);
  
  addText("e,", false);
  addText(`${borrowerName.toUpperCase()}, inscrito(a) no CPF sob o nº ${borrowerCPF} e portador(a) da cédula de identidade RG nº ${borrowerRG}, residente e domiciliado(a) na ${borrowerAddress}, doravante denominado simplesmente por "MUTUÁRIA".`, true);
  
  if (hasGuarantor) {
      addText("e, como FIADOR(A) SOLIDÁRIO(A),", false);
      addText(`${guarantorName.toUpperCase()}, inscrito(a) no CPF sob o nº ${guarantorCPF}, residente e domiciliado(a) na ${guarantorAddress}, doravante denominado simplesmente por "FIADOR".`, true);
  }

  addSpace(3);
  addText(`Resolvem celebrar o presente Contrato que se regerá pelas cláusulas e condições acordadas entre as Partes que seguem disciplinadas a seguir:`);
  addSpace(5);

  addText("Cláusula Primeira – DO OBJETO", true);
  addText(`1.1 Pelo presente instrumento, o MUTUANTE entrega ao MUTUÁRIO neste ato, a título de empréstimo (ou "Mútuo"), a importância de ${formatMoney(originalAmount)}, através de transferência bancária para a conta do cliente (Chave Pix/Conta: ${pixDestino}${bankInfo}).`);
  addText(`1.2 Fica acordado entre as Partes que o Valor do Mútuo será acrescido de uma taxa de remuneração de ${loan.interestRate}% a.m.`);
  addText(`1.3 O Valor do Mútuo deverá ser restituído em sua integralidade pelo MUTUÁRIO ao MUTUANTE, respeitando-se os juros e correção pactuados na cláusula 1.2 acima.`);
  addText(`1.4 Caso o MUTUÁRIO deixe de pagar integralmente no prazo estipulado, o saldo devedor ficará sujeito a juros moratórios à taxa de ${loan.moraInterestRate ?? 1}% ao mês, multa de mora na ordem de ${loan.fineRate ?? 2}% sobre o valor atualizado do débito e correção monetária.`);

  addSpace(5);
  addText("Cláusula Segunda – DO PRAZO DE VIGÊNCIA E PAGAMENTO", true);
  
  let baseDate = new Date(loan.startDate);
  baseDate.setMinutes(baseDate.getMinutes() + baseDate.getTimezoneOffset());
  let datesText = "";
  
  // Projeta as datas de vencimento reais originais
  for (let i = 1; i <= originalInstallmentsCount; i++) {
      const pDate = new Date(baseDate);
      if (loan.frequency === 'SEMANAL') pDate.setDate(baseDate.getDate() + (7 * i));
      else if (loan.frequency === 'DIARIO') pDate.setDate(baseDate.getDate() + (1 * i));
      else pDate.setMonth(baseDate.getMonth() + i); // MENSAL (Padrão)
      
      datesText += formatDateShort(pDate.toISOString());
      if (i < originalInstallmentsCount) datesText += ", ";
      if (i === originalInstallmentsCount - 1 && originalInstallmentsCount > 1) datesText += " e ";
  }

  const freqText = loan.frequency === 'DIARIO' ? 'diárias' : loan.frequency === 'SEMANAL' ? 'semanais' : 'mensais';

  addText(`2.1. O presente Contrato entra em vigor na data de sua assinatura, devendo o MUTUÁRIO efetuar a restituição ao MUTUANTE perfazendo o em ${originalInstallmentsCount} parcelas ${freqText} e sucessivas no valor de ${formatMoney(loan.installmentValue)}.`);
  addText(`2.2. Os vencimentos ocorrerão nas seguintes datas: ${datesText}.`);
  addText(`2.3. O pagamento deverá ser efetuado exclusivamente através de transferência bancária ou PIX para a chave do MUTUANTE: ${lenderPix}, sob pena de constituição em mora.`);

  addSpace(5);
  addText("Cláusula Terceira – DAS DISPOSIÇÕES GERAIS", true);
  addText(`3.1. O MUTUÁRIO arcará com todos e quaisquer tributos e despesas de qualquer natureza incidentes sobre ou decorrentes da presente avença.`);
  addText(`3.2. Todas as obrigações assumidas neste Contrato são irretratáveis e irrevogáveis.`);
  addText(`3.3. O MUTUÁRIO não poderá ceder quaisquer de seus direitos, interesses ou obrigações estabelecidas no presente sem o prévio consentimento por escrito do MUTUANTE.`);
  addText(`3.4. Para dirimir as dúvidas porventura emergentes deste Contrato, elegem as partes o foro da Comarca de ${contractCity.toUpperCase()}, com expressa renúncia de outro.`);

  if (hasGuarantor) {
      addSpace(5);
      addText("Cláusula Quarta – DA GARANTIA FIDEJUSSÓRIA", true);
      addText(`4.1. Assina também o presente contrato, na qualidade de FIADOR(A) e principal pagador(a), solidariamente responsável com o(a) MUTUÁRIO(A) pelo fiel cumprimento de todas as cláusulas e obrigações decorrentes deste contrato, ${guarantorName.toUpperCase()}, renunciando expressamente aos benefícios de ordem, divisão e exoneração previstos no Código Civil Brasileiro.`);
  }

  addSpace(8);
  addText(`E, por estarem de acordo com todas as disposições aqui consignadas, as Partes assinam o presente instrumento em três vias de igual teor e forma.`, false);
  addSpace(8);
  addText(`${contractCity}, ${formatDateExtenso(loan.startDate || new Date().toISOString())}.`, false, 'right');

  addSpace(15);
  
  // Garantir que as assinaturas ficam todas juntas na mesma página
  checkPageBreak(60); 

  doc.setLineWidth(0.1);
  doc.setFont("times", "bold");
  doc.setFontSize(10); // Forçar fonte tamanho 10 para as assinaturas
  
  doc.line(margin, y, margin + 170, y);
  doc.text(`MUTUANTE: ${lenderName.toUpperCase()}`, margin, y + 5);
  y += 20;

  doc.line(margin, y, margin + 170, y);
  doc.text(`MUTUÁRIO: ${borrowerName.toUpperCase()}`, margin, y + 5);
  y += 25;

  if (hasGuarantor) {
      doc.line(margin, y, margin + 170, y);
      doc.text(`FIADOR: ${guarantorName.toUpperCase()}`, margin, y + 5);
      y += 25;
  }

  doc.text("Testemunhas:", margin, y);
  y += 10;

  doc.line(margin, y, margin + 70, y);
  doc.setFont("times", "normal");
  doc.setFontSize(9);
  doc.text("1. _______________________", margin, y + 5);
  doc.text("RG/CPF:", margin, y + 10);

  const col2 = margin + 90;
  doc.line(col2, y, col2 + 70, y);
  doc.text("2. _______________________", col2, y + 5);
  doc.text("RG/CPF:", col2, y + 10);

  // NOVO NOME DE ARQUIVO COM ID E NOME
  doc.save(getSafeFileName('Contrato', loan.id, borrowerName));
};

// --- GERADOR DE PROMISSÓRIAS (COM DADOS ORIGINAIS) ---

export const generatePromissoryPDF = async (loan: Loan, clientData?: Client) => {
    const settings = await settingsService.get();
    const companyData = settings?.company || settings?.general || {};

    // Extração Blindada
    const lenderName = companyData.name || "CREDOR NÃO CONFIGURADO";
    const lenderCNPJ = companyData.cnpj || "CNPJ NÃO CONFIGURADO";
    const lenderAddress = companyData.address || "";
    const promissoriaCity = extractCityFromAddress(lenderAddress, "São Paulo");

    const doc = new jsPDF('l', 'mm', 'a4'); 
    
    // Resgata o total real original
    const totalOriginalInstallments = getOriginalInstallmentsCount(loan);
    
    const borrowerName = clientData?.name || loan.client;
    const borrowerCPF = clientData?.cpf || "___.___.___-__";
    const borrowerAddress = clientData?.address 
        ? `${clientData.address}, ${clientData.number || ''} - ${clientData.city || ''}/${clientData.state || ''}` 
        : "Endereço não cadastrado";

    let baseDate = new Date(loan.startDate);
    baseDate.setMinutes(baseDate.getMinutes() + baseDate.getTimezoneOffset());

    for (let i = 1; i <= totalOriginalInstallments; i++) {
        if (i > 1) doc.addPage();
        
        // Fundo Timbrado e Marca de Água na Promissória
        addProfessionalBranding(doc, lenderName, 'landscape');

        const pDate = new Date(baseDate);
        if (loan.frequency === 'SEMANAL') pDate.setDate(baseDate.getDate() + (7 * i));
        else if (loan.frequency === 'DIARIO') pDate.setDate(baseDate.getDate() + (1 * i));
        else pDate.setMonth(baseDate.getMonth() + i);

        // Borda da Promissória
        doc.setLineWidth(0.8);
        doc.setDrawColor(30, 41, 59);
        doc.rect(15, 25, 267, 120);

        doc.setFont("times", "bold");
        doc.setFontSize(24);
        doc.text("NOTA PROMISSÓRIA", 148, 45, { align: "center" });

        doc.setFontSize(14);
        doc.text(`Nº: ${loan.id.split('/')[0] || '001'} - ${i}/${totalOriginalInstallments}`, 30, 65);
        doc.text(`Valor: ${formatMoney(loan.installmentValue)}`, 260, 65, { align: 'right' });
        doc.text(`Vencimento: ${formatDateShort(pDate.toISOString())}`, 30, 75);

        doc.setFont("times", "normal");
        doc.setFontSize(12);
        
        const texto = `Ao(s) ${formatDateExtenso(pDate.toISOString())}, pagarei(emos) por esta única via de NOTA PROMISSÓRIA a ${lenderName.toUpperCase()}, CNPJ ${lenderCNPJ}, ou à sua ordem, a quantia de ${formatMoney(loan.installmentValue)} em moeda corrente deste país.`;
        const lines = doc.splitTextToSize(texto, 240);
        doc.text(lines, 30, 95);

        doc.text(`Pagável em: ${promissoriaCity}`, 30, 115);

        doc.setFont("times", "bold");
        doc.text("Emitente:", 30, 130);
        doc.setFont("times", "normal");
        doc.text(`${borrowerName}`, 55, 130);
        doc.text(`CPF: ${borrowerCPF}`, 55, 137);
        doc.text(`Endereço: ${borrowerAddress}`, 55, 144);

        // Linha de Assinatura
        doc.setDrawColor(0,0,0);
        doc.line(160, 135, 260, 135);
        doc.setFontSize(10);
        doc.text("Assinatura do Emitente", 210, 140, { align: 'center' });

        // Linha Tracejada de Corte
        doc.setLineWidth(0.2);
        (doc as any).setLineDash([2, 2], 0);
        doc.line(275, 25, 275, 145);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text("CONTROLE INTERNO", 277, 80, { angle: 90 });
        (doc as any).setLineDash([]);
        doc.setTextColor(0, 0, 0); // Reset
    }

    // NOVO NOME DE ARQUIVO COM ID E NOME
    doc.save(getSafeFileName('Promissorias', loan.id, borrowerName));
};