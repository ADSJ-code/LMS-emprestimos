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

// 1. Recupera o Valor Original Concedido
const getOriginalAmount = (loan: Loan): number => {
    if (loan.history && loan.history.length > 0) {
        const openingRecord = loan.history.find(h => 
            h.type.toLowerCase().includes('abertura') || 
            h.type.toLowerCase().includes('empréstimo')
        );
        if (openingRecord) return openingRecord.amount;
    }
    return (loan.amount || 0) + (loan.totalPaidCapital || 0);
};

// 2. Recupera o Total de Parcelas Original
const calculateTotalInstallments = (loan: Loan): number => {
    if (!loan.startDate || !loan.nextDue) return loan.installments || 1;

    const start = new Date(loan.startDate);
    const currentNext = new Date(loan.nextDue);
    
    start.setMinutes(start.getMinutes() + start.getTimezoneOffset());
    currentNext.setMinutes(currentNext.getMinutes() + currentNext.getTimezoneOffset());

    let monthsPassed = (currentNext.getFullYear() - start.getFullYear()) * 12;
    monthsPassed -= start.getMonth();
    monthsPassed += currentNext.getMonth();

    const correction = loan.status === 'Pago' ? 1 : 0;
    const paidInstallments = Math.max(0, monthsPassed - 1 + correction);
    const total = (loan.installments || 0) + paidInstallments;
    
    return total > 0 ? total : (loan.installments || 1);
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

// --- GERADOR DO CONTRATO (COM FIADOR) ---

export const generateContractPDF = async (loan: Loan, clientData?: Client) => {
  const settings = await settingsService.get();
  const legacySettings = settings as any;
  const companyData = settings.company || legacySettings.general || {};

  const lenderName = companyData.name || "CREDIT NOW FINANCEIRA";
  const lenderCNPJ = companyData.cnpj || "00.000.000/0001-00";
  const lenderAddress = companyData.address || "Endereço da Empresa, 000 - Cidade/UF";
  const pixDestino = loan.paymentMethod || "Chave PIX não informada";
  const lenderPix = companyData.pixKey || "Chave PIX não informada";
  
  const borrowerName = clientData?.name || loan.client || "__________________________";
  const borrowerCPF = clientData?.cpf || "___.___.___-__";
  const borrowerRG = clientData?.rg || "________________"; 
  const borrowerAddress = clientData?.address 
    ? `${clientData.address}, ${clientData.number || 'S/N'} - ${clientData.neighborhood || ''}, ${clientData.city || ''}/${clientData.state || ''}, CEP: ${clientData.cep || ''}`
    : "Endereço não informado";

  // DADOS DO FIADOR
  const hasGuarantor = !!loan.GuarantorName;
  const guarantorName = loan.GuarantorName || "";
  const guarantorCPF = loan.GuarantorCPF || "";
  const guarantorAddress = loan.GuarantorAddress || "";

  const contractCity = extractCityFromAddress(lenderAddress, clientData?.city || "São Paulo");
  const originalAmount = getOriginalAmount(loan);
  const totalInstallments = calculateTotalInstallments(loan);

  const doc = new jsPDF();
  const margin = 20;
  const pageWidth = 210;
  const maxLineWidth = pageWidth - (margin * 2);
  let y = 20;

  const addText = (text: string, isBold: boolean = false, align: 'left' | 'center' | 'right' | 'justify' = 'justify', fontSize: number = 10) => {
    doc.setFont("times", isBold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxLineWidth);
    const blockHeight = lines.length * 5;
    if (y + blockHeight > 280) { doc.addPage(); y = 20; }
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
  
  // Mutuante
  addText(`${lenderName.toUpperCase()}, inscrita no CNPJ sob o nº ${lenderCNPJ}, com sede na ${lenderAddress}, neste ato designado por "MUTUANTE";`, true);
  
  // Mutuário
  addText("e,", false);
  addText(`${borrowerName.toUpperCase()}, inscrito(a) no CPF sob o nº ${borrowerCPF} e portador(a) da cédula de identidade RG nº ${borrowerRG}, residente e domiciliado(a) na ${borrowerAddress}, doravante denominado simplesmente por "MUTUÁRIA".`, true);
  
  // Fiador (Se houver)
  if (hasGuarantor) {
      addText("e, como FIADOR(A) SOLIDÁRIO(A),", false);
      addText(`${guarantorName.toUpperCase()}, inscrito(a) no CPF sob o nº ${guarantorCPF}, residente e domiciliado(a) na ${guarantorAddress}, doravante denominado simplesmente por "FIADOR".`, true);
  }

  addSpace(3);
  addText(`Resolvem celebrar o presente Contrato que se regerá pelas cláusulas e condições acordadas entre as Partes que seguem disciplinadas a seguir:`);
  addSpace(5);

  addText("Cláusula Primeira – DO OBJETO", true);
  const bankInfo = loan.clientBank ? ` no Banco ${loan.clientBank}` : "";
  addText(`1.1 Pelo presente instrumento, o MUTUANTE entrega ao MUTUÁRIO neste ato, a título de empréstimo (ou "Mútuo"), a importância de ${formatMoney(originalAmount)}, através de transferência bancária para a Chave Pix: ${pixDestino}${bankInfo}.`);
  addText(`1.2 Fica acordado entre as Partes que o Valor do Mútuo, na data do vencimento do presente contrato, será acrescido de uma taxa de remuneração de ${loan.interestRate}% a.m do Valor do Mútuo.`);
  addText(`1.3 O Valor do Mútuo deverá ser restituído em sua integralidade pelo MUTUÁRIO ao MUTUANTE, respeitando-se os juros e correção pactuados na cláusula 1.2 acima, até o término do prazo de vigência do presente contrato, qual seja, até o pagamento da última parcela.`);
  addText(`1.4 Caso o MUTUÁRIO deixe de pagar integralmente o Valor do Mútuo e seus acessórios no prazo estipulado na cláusula 1.3 acima, o saldo devedor corrigido na data do término de referido prazo ficará sujeito a juros moratórios à taxa de 1% ao mês, multa de mora na ordem de ${loan.fineRate !== undefined ? loan.fineRate : 2}% sobre o valor atualizado do débito e correção monetária.`);

  addSpace(5);
  addText("Cláusula Segunda – DO PRAZO DE VIGÊNCIA", true);
  
  let baseDate = new Date(loan.startDate);
  baseDate.setMinutes(baseDate.getMinutes() + baseDate.getTimezoneOffset());
  let datesText = "";
  for (let i = 1; i <= totalInstallments; i++) {
      const pDate = new Date(baseDate);
      pDate.setMonth(baseDate.getMonth() + i);
      datesText += formatDateShort(pDate.toISOString());
      if (i < totalInstallments) datesText += ", ";
      if (i === totalInstallments - 1) datesText += " e ";
  }

  addText(`2.1. O presente Contrato entra em vigor na data de sua assinatura, e sua vigência perdurará nas seguintes datas: ${datesText}, a contar dessa data, findo o qual o MUTUÁRIO deverá efetuar a restituição ao MUTUANTE do Valor do Mútuo, acrescido da taxa de remuneração, perfazendo o em ${totalInstallments} parcelas no valor de ${formatMoney(loan.installmentValue)} através de transferência para a conta corrente do MUTUANTE ou Chave Pix ${lenderPix}, sob pena de, independentemente de qualquer notificação, judicial ou extrajudicial, ficar constituído em mora, autorizada a aplicação de sanções previstas na cláusula 1.4.`);
  addText(`2.2. Poderão as Partes prorrogar o prazo de vigência deste Contrato, mediante aditamento ao presente subscrito por elas juntamente com duas testemunhas.`);

  addSpace(5);
  addText("Cláusula Terceira – DAS DISPOSIÇÕES GERAIS", true);
  addText(`3.1. O MUTUÁRIO arcará com todos e quaisquer tributos e despesas de qualquer natureza incidentes sobre ou decorrentes da presente avença, bem como arcará com os demais custos e despesas dela decorrentes.`);
  addText(`3.2. Todas as obrigações assumidas neste Contrato são irretratáveis e irrevogáveis.`);
  addText(`3.3. O MUTUÁRIO não poderá ceder quaisquer de seus direitos, interesses ou obrigações estabelecidas no presente Contrato sem o prévio consentimento por escrito do MUTUANTE.`);
  addText(`3.4. As Partes reconhecem e acordam que as condições constantes no presente Contrato refletem as suas pretensões e interesses comerciais. Ademais, as Partes têm pleno entendimento e conhecimento do teor do presente Contrato e de suas Cláusulas.`);
  addText(`3.5. O presente Contrato obriga as Partes e seus sucessores a qualquer título.`);
  addText(`3.6. Eventual tolerância por qualquer das Partes no cumprimento de obrigação de outra Parte não constituirá novação, alteração tácita ou qualquer outra forma de alteração das disposições deste Contrato.`);
  addText(`3.7. Para dirimir as dúvidas porventura emergentes deste Contrato, elegem as partes o foro da Comarca de ${contractCity.toUpperCase()}, com expressa renúncia de outro, por mais privilegiado que for.`);

  // CLÁUSULA DO FIADOR (SE HOUVER)
  if (hasGuarantor) {
      addSpace(5);
      addText("Cláusula Quarta – DA GARANTIA FIDEJUSSÓRIA", true);
      addText(`4.1. Assina também o presente contrato, na qualidade de FIADOR(A) e principal pagador(a), solidariamente responsável com o(a) MUTUÁRIO(A) pelo fiel cumprimento de todas as cláusulas e obrigações decorrentes deste contrato, ${guarantorName.toUpperCase()}, renunciando expressamente aos benefícios de ordem, divisão e exoneração previstos no Código Civil Brasileiro.`);
  }

  addSpace(8);
  addText(`E, por estarem de acordo com todas as disposições aqui consignadas, as Partes assinam o presente instrumento em três vias de igual teor e forma, na presença das testemunhas abaixo assinadas.`, false);
  addSpace(8);
  addText(`${contractCity}, ${formatDateExtenso(new Date().toISOString())}.`, false, 'right');

  addSpace(15);
  // Quebra página se necessário para assinaturas
  if (y > (hasGuarantor ? 180 : 200)) { doc.addPage(); y = 40; }
  doc.setLineWidth(0.1);
  
  doc.line(margin, y, margin + 170, y);
  doc.setFont("times", "bold");
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

  doc.save(`Contrato_${borrowerName.replace(/\s+/g, '_')}.pdf`);
};

// --- GERADOR DE PROMISSÓRIAS (MANTIDO) ---

export const generatePromissoryPDF = async (loan: Loan, clientData?: Client) => {
    const settings = await settingsService.get();
    const legacySettings = settings as any;
    const companyData = settings.company || legacySettings.general || {};

    const lenderName = companyData.name || "CREDIT NOW FINANCEIRA";
    const lenderCNPJ = companyData.cnpj || "00.000.000/0001-00";
    const lenderAddress = companyData.address || "";
    const promissoriaCity = extractCityFromAddress(lenderAddress, "São Paulo");

    const doc = new jsPDF('l', 'mm', 'a4'); 
    const totalOriginalInstallments = calculateTotalInstallments(loan);
    
    const borrowerName = clientData?.name || loan.client;
    const borrowerCPF = clientData?.cpf || "___.___.___-__";
    const borrowerAddress = clientData?.address 
        ? `${clientData.address}, ${clientData.number || ''}` 
        : "Endereço não cadastrado";

    let baseDate = new Date(loan.startDate);
    baseDate.setMinutes(baseDate.getMinutes() + baseDate.getTimezoneOffset());

    for (let i = 1; i <= totalOriginalInstallments; i++) {
        if (i > 1) doc.addPage();
        const pDate = new Date(baseDate);
        pDate.setMonth(baseDate.getMonth() + i);

        doc.setLineWidth(0.8);
        doc.rect(15, 15, 267, 100);

        doc.setFont("times", "bold");
        doc.setFontSize(24);
        doc.text("NOTA PROMISSÓRIA", 148, 35, { align: "center" });

        doc.setFontSize(14);
        doc.text(`Nº: ${loan.id.split('/')[0] || '001'} - ${i}/${totalOriginalInstallments}`, 30, 55);
        doc.text(`Valor: ${formatMoney(loan.installmentValue)}`, 260, 55, { align: 'right' });
        doc.text(`Vencimento: ${formatDateShort(pDate.toISOString())}`, 30, 65);

        doc.setFont("times", "normal");
        doc.setFontSize(12);
        
        const texto = `Ao(s) ${formatDateExtenso(pDate.toISOString())}, pagarei(emos) por esta única via de NOTA PROMISSÓRIA a ${lenderName.toUpperCase()}, CNPJ ${lenderCNPJ}, ou à sua ordem, a quantia de ${formatMoney(loan.installmentValue)} em moeda corrente deste país.`;
        const lines = doc.splitTextToSize(texto, 240);
        doc.text(lines, 30, 85);

        doc.text(`Pagável em: ${promissoriaCity}`, 30, 105);

        doc.setFont("times", "bold");
        doc.text("Emitente:", 30, 120);
        doc.setFont("times", "normal");
        doc.text(`${borrowerName}`, 55, 120);
        doc.text(`CPF: ${borrowerCPF}`, 55, 127);
        doc.text(`Endereço: ${borrowerAddress}`, 55, 134);

        doc.line(160, 130, 260, 130);
        doc.setFontSize(10);
        doc.text("Assinatura do Emitente", 210, 135, { align: 'center' });

        doc.setLineWidth(0.2);
        (doc as any).setLineDash([2, 2], 0);
        doc.line(275, 15, 275, 115);
        doc.setFontSize(8);
        doc.text("CONTROLE INTERNO", 277, 60, { angle: 90 });
        (doc as any).setLineDash([]);
    }

    doc.save(`Promissorias_Carne_${borrowerName.replace(/\s+/g, '_')}.pdf`);
};