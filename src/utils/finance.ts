import { Loan } from '../services/api';

// Garante que o valor sempre será tratado como número, independente se veio do banco como string.
export const formatMoney = (value: number | undefined | null | string): string => {
  if (value === undefined || value === null || value === '') return "0,00";
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return "0,00";
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Transforma string em número de forma segura (Impede que "20000" quebre a soma)
const safeNumber = (val: any): number => {
    if (val === undefined || val === null) return 0;
    const parsed = Number(val);
    return isNaN(parsed) ? 0 : parsed;
};

export const calculateOverdueValue = (
  amount: number, // Valor da parcela fixa (ex: R$ 200)
  dueDateStr: string, 
  status: string,
  finePercent?: number, 
  moraPercent?: number,
  totalAmount?: number, // NOVO: Valor do capital total que o Billing está enviando (ex: R$ 1000)
  screenData?: { payCapital: string, payInterest: string } // NOVO
): number => {
  if (status !== 'Atrasado' && status !== 'Acordo') return safeNumber(amount);

  // CORREÇÃO DEFINITIVA DE FUSO HORÁRIO (FALSO ATRASO)
  // Separa a data de vencimento de forma limpa
  const cleanDate = dueDateStr.split('T')[0];
  const [year, month, day] = cleanDate.split('-').map(Number);
  const due = new Date(year, month - 1, day);
  
  // Força o "Hoje" a respeitar o fuso horário local do usuário e não o UTC do Servidor
  const now = new Date();
  const localOffset = now.getTimezoneOffset() * 60000;
  const localNow = new Date(now.getTime() - localOffset);
  const localTodayStr = localNow.toISOString().split('T')[0];
  const [ty, tm, td] = localTodayStr.split('-').map(Number);
  const today = new Date(ty, tm - 1, td);

  if (today <= due) return safeNumber(amount);

  const diffTime = Math.abs(today.getTime() - due.getTime());
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  const baseForCalculation = (totalAmount && safeNumber(totalAmount) > 0) ? safeNumber(totalAmount) : 0;

  const safeFine = safeNumber(finePercent);
  const fineValue = baseForCalculation * (safeFine / 100);

  const safeMora = safeNumber(moraPercent);
  const dailyInterestRate = (safeMora / 100); 
  const interestValue = baseForCalculation * (dailyInterestRate * days);

  return safeNumber(amount) + fineValue + interestValue;
};

export const calculateCapitalBalance = (loan: Loan): number => {
    // Blindagem pesada contra string
    const amount = safeNumber(loan.amount);
    const paid = safeNumber(loan.totalPaidCapital);
    const balance = amount - paid;
    
    return balance > 0.10 ? balance : 0;
};

export const calculateRealBalance = (loan: Loan): number => {
    return calculateCapitalBalance(loan);
};

// ============================================================================
// CÉREBRO MODIFICADO: A CHAVE MESTRA E O "MODO RODRIGO" DE DIVISÃO LINEAR
// ============================================================================
export const calculateInstallmentBreakdown = (
    loan: Loan
): { interest: number, capital: number, total: number } => {
    const currentCapitalBalance = calculateCapitalBalance(loan);

    // Se a dívida já foi paga, retorna zerado
    if (currentCapitalBalance <= 0.10) {
        return { interest: 0, capital: 0, total: 0 };
    }

    const pmt = safeNumber(loan.installmentValue);
    
    // Modalidade 1: Pagamento Mínimo (Só Juros)
    if (loan.interestType === 'SIMPLE') {
        let periodicRate = safeNumber(loan.interestRate) / 100;
        
        if (loan.frequency === 'SEMANAL') periodicRate = periodicRate / 4;
        else if (loan.frequency === 'DIARIO') periodicRate = periodicRate / 30;
        
        // RECÁLCULO DINÂMICO: Juros em cima do capital atualizado (amortizado)
        const dynamicInterest = currentCapitalBalance * periodicRate;
        const roundedInterest = Math.round(dynamicInterest * 100) / 100;

        return { capital: 0, interest: roundedInterest, total: roundedInterest };
    }

    // Modalidade 2: Price / Linear Fixa
    // CÁLCULO DIRETO E FIXO (Evita as distorções dos "R$ 659,95")
    
    const originalAmount = safeNumber(loan.amount);
    
    // Calcula o lucro total esperado que foi fixado na criação do contrato
    const expectedTotalInterest = safeNumber(loan.projectedProfit) > 0 
        ? safeNumber(loan.projectedProfit) 
        : Math.max(0, (pmt * (loan.installments || 1)) - originalAmount);

    // No modo Rodrigo (Parcelas Cúbicas Fixas), o Capital é SEMPRE a parcela menos os juros
    // Só descobrimos quantas parcelas originais o contrato tinha para fazer a divisão cravada
    const totalReceivable = originalAmount + expectedTotalInterest;
    let originalInstallmentsCount = Math.round(totalReceivable / pmt);
    if (originalInstallmentsCount < 1 || isNaN(originalInstallmentsCount)) originalInstallmentsCount = 1;

    let flatInterest = expectedTotalInterest / originalInstallmentsCount;
    let flatCapital = pmt - flatInterest;

    // Arredondamento contábil para não quebrar a tela
    flatCapital = Math.round(flatCapital * 100) / 100;
    flatInterest = Math.round(flatInterest * 100) / 100;

    // Regra de segurança final: O Capital da parcela não pode ser maior que a dívida real restante
    if (currentCapitalBalance < flatCapital) {
        flatCapital = currentCapitalBalance;
        flatInterest = pmt - flatCapital;
        if (flatInterest < 0) flatInterest = 0;
    }

    return { 
        capital: flatCapital, 
        interest: flatInterest, 
        total: pmt 
    };
};