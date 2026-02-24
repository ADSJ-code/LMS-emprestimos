import { Loan } from '../services/api';

export const formatMoney = (value: number | undefined | null | string): string => {
  if (value === undefined || value === null || value === '') return "0,00";
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return "0,00";
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const calculateOverdueValue = (
  amount: number, // Valor da parcela fixa (ex: R$ 200)
  dueDateStr: string, 
  status: string,
  finePercent?: number, 
  moraPercent?: number,
  totalAmount?: number // NOVO: Valor do capital total que o Billing está enviando (ex: R$ 1000)
): number => {
  if (status !== 'Atrasado' && status !== 'Acordo') return amount;

  // CORREÇÃO DO FUSO HORÁRIO: Força a data a ser lida no fuso local exato
  const cleanDate = dueDateStr.split('T')[0];
  const [year, month, day] = cleanDate.split('-').map(Number);
  const due = new Date(year, month - 1, day);
  
  const today = new Date();
  
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  if (today <= due) return amount;

  const diffTime = Math.abs(today.getTime() - due.getTime());
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // A MÁGICA AQUI: Define se vai calcular juros sobre os 1000 (totalAmount) ou sobre os 200 (amount)
  const baseForCalculation = (totalAmount && totalAmount > 0) ? totalAmount : amount;

  const safeFine = (finePercent || 0);
  // Multa calculada em cima da baseForCalculation (R$ 1000)
  const fineValue = baseForCalculation * (safeFine / 100);

  const safeMora = (moraPercent || 0);

  // Seus logs adaptados para mostrar a nova base de cálculo! Abra o F12 e veja a mágica:
  console.log("Teste Mora 1-> moraPercent recebido:", moraPercent, "| safeMora final:", safeMora);
  console.log("Teste Mora 2-> Valor da Parcela:", amount, "| Valor Base p/ Juros (Capital):", baseForCalculation);

  // Mora integral sobre a BASE (Capital Total), multiplicada pelos dias reais
  const dailyInterestRate = (safeMora / 100); 
  const interestValue = baseForCalculation * (dailyInterestRate * days);

  console.log("Teste Mora 3-> status:", status, "| Juros Mora em R$:", interestValue, "| Multa em R$:", fineValue);

  // Retorna a parcela fixa (200) + Multa do Capital (ex: 0) + Mora do Capital (ex: 100)
  return amount + fineValue + interestValue;
};

export const calculateCapitalBalance = (loan: Loan): number => {
    const balance = loan.amount - (loan.totalPaidCapital || 0);
    return balance > 0.10 ? balance : 0;
};

export const calculateRealBalance = (loan: Loan): number => {
    return calculateCapitalBalance(loan);
};

export const calculateInstallmentBreakdown = (
    loan: Loan
): { interest: number, capital: number, total: number } => {
    const currentCapitalBalance = calculateCapitalBalance(loan);

    if (currentCapitalBalance <= 0.10) {
        return { interest: 0, capital: 0, total: 0 };
    }

    let periodicRate = loan.interestRate / 100; 

    if (loan.frequency === 'SEMANAL') {
        periodicRate = periodicRate / 4; 
    } else if (loan.frequency === 'DIARIO') {
        periodicRate = periodicRate / 30; 
    }

    let fixedInstallment = loan.installmentValue;
    
    if (!fixedInstallment || fixedInstallment === 0) {
        const n = loan.installments; 
        if (periodicRate === 0) fixedInstallment = loan.amount / (n || 1);
        else fixedInstallment = loan.amount * ( (periodicRate * Math.pow(1 + periodicRate, n)) / (Math.pow(1 + periodicRate, n) - 1) );
    }

    let periodicInterest = currentCapitalBalance * periodicRate;
    let capitalPart = fixedInstallment - periodicInterest;

    if (capitalPart < 0) {
        capitalPart = 0;
        periodicInterest = fixedInstallment; 
    }

    if (currentCapitalBalance < capitalPart) {
        capitalPart = currentCapitalBalance;
        periodicInterest = fixedInstallment - capitalPart;
    }

    periodicInterest = Math.round(periodicInterest * 100) / 100;
    capitalPart = Math.round(capitalPart * 100) / 100;
    
    const totalToPay = periodicInterest + capitalPart;

    return {
        interest: periodicInterest,
        capital: capitalPart,
        total: totalToPay
    };
};