import { Loan } from '../services/api';

export const formatMoney = (value: number | undefined | null | string): string => {
  if (value === undefined || value === null || value === '') return "0,00";
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return "0,00";
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const calculateOverdueValue = (
  amount: number, 
  dueDateStr: string, 
  status: string,
  finePercent?: number, 
  moraPercent?: number 
): number => {
  if (status !== 'Atrasado' && status !== 'Acordo') return amount;
  const due = new Date(dueDateStr);
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  if (today <= due) return amount;

  const diffTime = Math.abs(today.getTime() - due.getTime());
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const safeFine = (finePercent || 0);
  const fineValue = amount * (safeFine / 100);
  const safeMora = (moraPercent || 0);
  const dailyInterestRate = (safeMora / 100) / 30; 
  const interestValue = amount * (dailyInterestRate * days);

  return amount + fineValue + interestValue;
};

/**
 * LÓGICA CORRIGIDA:
 * O Saldo Devedor é: Valor Original Contratado - Total de Capital já Amortizado.
 * O 'loan.amount' NÃO deve ser alterado durante a vida do contrato.
 */
export const calculateCapitalBalance = (loan: Loan): number => {
    const totalAmortized = loan.totalPaidCapital || 0;
    const balance = loan.amount - totalAmortized;
    return balance > 0.10 ? balance : 0;
};

export const calculateRealBalance = (loan: Loan): number => {
    return calculateCapitalBalance(loan);
};

/**
 * LÓGICA DA PARCELA (PRICE MENSAL CHEIO)
 */
export const calculateInstallmentBreakdown = (
    loan: Loan
): { interest: number, capital: number, total: number } => {
    // 1. Saldo Devedor Atual
    const currentCapitalBalance = calculateCapitalBalance(loan);

    if (currentCapitalBalance <= 0.10) {
        return { interest: 0, capital: 0, total: 0 };
    }

    // 2. Valor da Parcela Fixa
    let fixedInstallment = loan.installmentValue;
    
    if (!fixedInstallment || fixedInstallment === 0) {
        const i = loan.interestRate / 100;
        const n = loan.installments; 
        if (i === 0) fixedInstallment = loan.amount / (n || 1);
        else fixedInstallment = loan.amount * ( (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1) );
    }

    // 3. CÁLCULO DE JUROS (PRICE)
    let monthlyInterest = currentCapitalBalance * (loan.interestRate / 100);

    // 4. CÁLCULO DE CAPITAL
    let capitalPart = fixedInstallment - monthlyInterest;

    // Ajustes de borda
    if (capitalPart < 0) {
        capitalPart = 0;
        monthlyInterest = fixedInstallment; 
    }
    if (currentCapitalBalance < capitalPart) {
        capitalPart = currentCapitalBalance;
        monthlyInterest = fixedInstallment - capitalPart;
    }

    monthlyInterest = Math.round(monthlyInterest * 100) / 100;
    capitalPart = Math.round(capitalPart * 100) / 100;
    
    const totalToPay = monthlyInterest + capitalPart;

    return {
        interest: monthlyInterest,
        capital: capitalPart,
        total: totalToPay
    };
};