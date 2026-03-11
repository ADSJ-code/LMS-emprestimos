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
  totalAmount?: number, // NOVO: Valor do capital total que o Billing está enviando (ex: R$ 1000)
  screenData?: { payCapital: string, payInterest: string } // NOVO
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

  const baseForCalculation = (totalAmount && totalAmount > 0) ? totalAmount : 0;

  const safeFine = (finePercent || 0);
  const fineValue = baseForCalculation * (safeFine / 100);

  const safeMora = (moraPercent || 0);
  const dailyInterestRate = (safeMora / 100); 
  const interestValue = baseForCalculation * (dailyInterestRate * days);

  return amount + fineValue + interestValue;
};

export const calculateCapitalBalance = (loan: Loan): number => {
    const balance = loan.amount - (loan.totalPaidCapital || 0);
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

    // Modalidade 1: Pagamento Mínimo (Só Juros)
    if (loan.interestType === 'SIMPLE') {
        const pmt = Number(loan.installmentValue) || 0;
        return { capital: 0, interest: pmt, total: pmt };
    }

    // Chave Mestra
    const mode = localStorage.getItem('amortizationMode') || 'LINEAR'; 

    const pmt = Number(loan.installmentValue) || 0;
    const installments = Number(loan.installments) || 1; // Fator atualizado a cada pagamento
    const originalAmount = Number(loan.amount) || 0;
    
    // Calcula o lucro projetado original do contrato
    const expectedTotalInterest = Number(loan.projectedProfit) > 0 
        ? Number(loan.projectedProfit) 
        : Math.max(0, (pmt * installments) - originalAmount);

    if (mode === 'LINEAR') {
        // ==========================================
        // MODO RODRIGO (CORRIGIDO): Divide o SALDO pelas PARCELAS RESTANTES
        // Isso garante que todo mês a fatia seja idêntica, mesmo após pagar.
        // ==========================================
        const remainingProfit = Math.max(0, expectedTotalInterest - (Number(loan.totalPaidInterest) || 0));
        
        let capitalPart = currentCapitalBalance / installments;
        let interestPart = remainingProfit / installments;

        // Ajuste fino para não dar diferença de centavos em relação à parcela
        if (Math.abs((capitalPart + interestPart) - pmt) > 0.05) {
            interestPart = pmt - capitalPart;
        }

        // Arredondamento contábil para não quebrar a tela
        capitalPart = Math.round(capitalPart * 100) / 100;
        interestPart = Math.round(interestPart * 100) / 100;

        // Regra de segurança: O Capital da parcela não pode ser maior que a dívida real restante
        if (currentCapitalBalance < capitalPart) {
            capitalPart = currentCapitalBalance;
            interestPart = pmt - capitalPart;
            if (interestPart < 0) interestPart = 0;
        }

        return { capital: capitalPart, interest: interestPart, total: pmt };

    } else {
        // ==========================================
        // MODO CLÓVIS: Tabela Price Bancária Original
        // ==========================================
        let periodicRate = loan.interestRate / 100; 

        if (loan.frequency === 'SEMANAL') periodicRate = periodicRate / 4; 
        else if (loan.frequency === 'DIARIO') periodicRate = periodicRate / 30; 

        let fixedInstallment = loan.installmentValue;
        
        if (!fixedInstallment || fixedInstallment === 0) {
            if (periodicRate === 0) fixedInstallment = loan.amount / installments;
            else fixedInstallment = loan.amount * ( (periodicRate * Math.pow(1 + periodicRate, installments)) / (Math.pow(1 + periodicRate, installments) - 1) );
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
        
        return {
            interest: periodicInterest,
            capital: capitalPart,
            total: periodicInterest + capitalPart
        };
    }
};