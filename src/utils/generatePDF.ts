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

const calculateTotalInstallments = (loan: Loan): number => {
    if (!loan.startDate || !loan.nextDue) return loan.installments;
    const start = new Date(loan.startDate);
    const due = new Date(loan.nextDue);
    start.setMinutes(start.getMinutes() + start.getTimezoneOffset());
    due.setMinutes(due.getMinutes() + due.getTimezoneOffset());
    
    // Cálculo aproximado de meses
    const monthsPassed = (due.getFullYear() - start.getFullYear()) * 12 + (due.getMonth() - start.getMonth());
    const correction = loan.installments > 0 ? 1 : 0;
    const totalEstimated = loan.installments + monthsPassed - correction;
    return totalEstimated > 0 ? totalEstimated : loan.installments;
};

// Tenta extrair a cidade do endereço da empresa (formato esperado: "Rua X, 00 - Bairro, Cidade/UF")
const extractCityFromAddress = (address: string, defaultCity: string = "São Paulo"): string => {
    if (!address) return defaultCity;
    try {
        // Tenta achar padrão "Cidade/UF" ou pegar a parte antes do CEP
        const parts = address.split(',');
        if (parts.length > 2) {
            const cityPart = parts[parts.length - 2]; // Pega a penúltima parte (comum em endereços)
            if (cityPart && cityPart.includes('/')) return cityPart.split('/')[0].trim();
            if (cityPart && cityPart.includes('-')) return cityPart.split('-')[1].trim(); // Bairro - Cidade
            return cityPart.trim();
        }
        return defaultCity;
    } catch (e) {
        return defaultCity;
    }
}

// --- GERADORES ---

export const generateContractPDF = async (loan: Loan, clientData?: Client) => {
  // 1. Busca Configurações Atualizadas
  const settings = await settingsService.get();
  
  // Garante que estamos lendo do lugar certo (nova estrutura)
  const legacySettings = settings as any;
  const companyData = settings.company || legacySettings.general || {};

  const lenderName = companyData.name || "CREDIT NOW FINANCEIRA";
  const lenderCNPJ = companyData.cnpj || "00.000.000/0001-00";
  const lenderAddress = companyData.address || "Endereço da Empresa, 000 - Cidade/UF";
  const lenderPix = companyData.pixKey || "Chave PIX não informada";
  
  // Define cidade da assinatura baseada no endereço da empresa ou do cliente
  const contractCity = extractCityFromAddress(lenderAddress, clientData?.city || "Local");

  const doc = new jsPDF();
  const totalOriginalInstallments = calculateTotalInstallments(loan);

  const borrowerName = clientData?.name || loan.client || "__________________________";
  const borrowerCPF = clientData?.cpf || "___.___.___-__";
  const borrowerRG = clientData?.rg || "________________"; 
  const borrowerAddress = clientData?.address 
    ? `${clientData.address}, ${clientData.number || 'S/N'} - ${clientData.neighborhood || ''}, ${clientData.city || ''}/${clientData.state || ''}, CEP: ${clientData.cep || ''}`
    : "__________________________________________________";

  const margin = 20;
  const pageWidth = 210;
  const maxLineWidth = pageWidth - (margin * 2);
  let y = 20;

  const addText = (text: string, isBold: boolean = false, align: 'left' | 'center' | 'right' | 'justify' = 'justify', fontSize: number = 10) => {
    doc.setFont("times", isBold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxLineWidth);
    
    // Quebra de página se necessário
    if (y + (lines.length * 5) > 280) { 
        doc.addPage(); 
        y = 20; 
    }
    
    if (align === 'justify' || align === 'left') doc.text(lines, margin, y, { align: 'left', maxWidth: maxLineWidth });
    else if (align === 'center') doc.text(lines, pageWidth / 2, y, { align: 'center', maxWidth: maxLineWidth });
    else if (align === 'right') doc.text(lines, pageWidth - margin, y, { align: 'right', maxWidth: maxLineWidth });

    y += (lines.length * 5) + 2;
  };

  // --- CONTEÚDO DO CONTRATO ---

  addText("INSTRUMENTO PARTICULAR DE MÚTUO", true, 'center', 14);
  y += 5;

  addText("Pelo presente Contrato de Mútuo, e na melhor forma de direito, as Partes:");
  y += 2;

  addText(`${lenderName.toUpperCase()}, inscrita no CNPJ sob o nº ${lenderCNPJ}, com sede na ${lenderAddress}, neste ato designado por "MUTUANTE"; e,`, true);
  addText(`${borrowerName.toUpperCase()}, inscrito(a) no CPF sob o nº ${borrowerCPF} e portador(a) da cédula de identidade RG nº ${borrowerRG}, residente e domiciliado(a) na ${borrowerAddress}, doravante denominado simplesmente por "MUTUÁRIA".`, true);
  
  y += 5;
  addText(`Resolvem celebrar o presente Contrato que se regerá pelas cláusulas e condições acordadas entre as Partes que seguem disciplinadas a seguir:`);
  y += 5;

  addText("Cláusula Primeira – DO OBJETO", true);
  const bankInfo = loan.clientBank ? `, Banco ${loan.clientBank}` : "";
  const payMethodInfo = loan.paymentMethod ? `, chave Pix/Conta ${loan.paymentMethod}` : "";
  addText(`1.1 Pelo presente instrumento, o MUTUANTE entrega ao MUTUÁRIO neste ato, a título de empréstimo, a importância de ${formatMoney(loan.amount)}, através de transferência bancária para conta do próprio MUTUÁRIO${bankInfo}${payMethodInfo}.`);
  addText(`1.2 Fica acordado entre as Partes que o Valor do Mútuo, na data do vencimento do presente contrato, será acrescido de uma taxa de remuneração de ${loan.interestRate}% a.m do Valor do Mútuo.`);
  addText(`1.3 O Valor do Mútuo deverá ser restituído em sua integralidade pelo MUTUÁRIO ao MUTUANTE até o término do prazo de vigência.`);
  addText(`1.4 Em caso de atraso, incidirá multa de ${loan.fineRate || 2}% e juros de mora de 1% ao mês.`);

  y += 5;
  addText("Cláusula Segunda – DO PRAZO E PAGAMENTO", true);
  
  let baseDate = new Date(loan.startDate);
  baseDate.setMinutes(baseDate.getMinutes() + baseDate.getTimezoneOffset());
  
  let datesText = "";
  for (let i = 1; i <= totalOriginalInstallments; i++) {
      const pDate = new Date(baseDate);
      pDate.setMonth(baseDate.getMonth() + i);
      datesText += formatDateShort(pDate.toISOString());
      if (i < totalOriginalInstallments) datesText += ", ";
  }

  addText(`2.1. O pagamento deverá ser realizado em ${totalOriginalInstallments} parcelas de ${formatMoney(loan.installmentValue)}, com vencimentos em: ${datesText}.`);
  addText(`2.2. O pagamento deverá ser realizado preferencialmente via PIX para a chave: ${lenderPix}, ou conta indicada pelo MUTUANTE.`);

  y += 5;
  addText("Cláusula Terceira – DISPOSIÇÕES GERAIS", true);
  addText(`3.1. O presente Contrato obriga as Partes e seus sucessores. O foro eleito é o da Comarca de ${contractCity}.`);

  y += 10;
  addText(`E, por estarem de acordo, as Partes assinam o presente instrumento em duas vias.`, false);
  
  y += 10;
  addText(`${contractCity}, ${formatDateExtenso(new Date().toISOString())}.`, false, 'right');

  y += 20;
  if (y > 230) { doc.addPage(); y = 40; }

  doc.setLineWidth(0.1);
  doc.line(margin, y, margin + 80, y);
  doc.setFontSize(8);
  doc.text(`MUTUANTE: ${lenderName.toUpperCase()}`, margin, y + 4);

  doc.line(margin + 90, y, margin + 170, y);
  doc.text(`MUTUÁRIO: ${borrowerName.toUpperCase()}`, margin + 90, y + 4);

  doc.save(`Contrato_${borrowerName.replace(/\s+/g, '_')}.pdf`);
};

export const generatePromissoryPDF = async (loan: Loan, clientData?: Client) => {
    const settings = await settingsService.get();
    const legacySettings = settings as any;
    const companyData = settings.company || legacySettings.general || {};

    const lenderName = companyData.name || "CREDIT NOW FINANCEIRA";
    const lenderCNPJ = companyData.cnpj || "00.000.000/0001-00";
    const lenderAddress = companyData.address || "";
    // Tenta extrair a cidade para a Promissória também
    const promissoriaCity = extractCityFromAddress(lenderAddress, "São Paulo - SP");

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
        doc.text(`Nº: ${loan.id.split('/')[0]} - ${i}/${totalOriginalInstallments}`, 30, 55);
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
        doc.text("CONTROLE", 277, 60, { angle: 90 });
        (doc as any).setLineDash([]);
    }

    doc.save(`Promissorias_Carne_${borrowerName.replace(/\s+/g, '_')}.pdf`);
};