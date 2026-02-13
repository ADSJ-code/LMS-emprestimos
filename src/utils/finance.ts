import { Loan, PaymentRecord } from '../services/api';

/**
 * Calcula o valor atualizado de uma parcela em atraso.
 * BLINDAGEM DO ZERO: Usa '??' para garantir que 0% seja respeitado.
 */
export const calculateOverdueValue = (
  amount: number, 
  dueDateStr: string, 
  status: string,
  finePercent?: number, // Opcional, assume 2 se undefined
  moraPercent?: number  // Opcional, assume 1 se undefined
) => {
  // Se não estiver atrasado e não for um acordo quebrado, retorna o valor original
  if (status !== 'Atrasado' && status !== 'Acordo') return amount;

  const due = new Date(dueDateStr);
  const today = new Date();
  
  // Normaliza para meia-noite para comparar apenas datas
  due.setMinutes(due.getMinutes() + due.getTimezoneOffset());
  today.setHours(0, 0, 0, 0);

  // Se ainda não venceu (ou vence hoje), não cobra multa
  if (due >= today) return amount;

  const diffTime = Math.abs(today.getTime() - due.getTime());
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // 1. Multa (Se finePercent for 0, usa 0. Se for undefined/null, usa 2)
  const safeFine = finePercent ?? 2.0;
  const fine = amount * (safeFine / 100);

  // 2. Juros de Mora (Se moraPercent for 0, usa 0. Se for undefined/null, usa 1)
  const safeMora = moraPercent ?? 1.0;
  
  // Juros diários baseados na taxa mensal (pro rata)
  const dailyInterestRate = (safeMora / 100) / 30; 
  const interest = amount * (dailyInterestRate * days);

  return amount + fine + interest;
};

/**
 * Formata valores monetários para o padrão BRL.
 * Protegido contra valores nulos/NaN.
 */
export const formatMoney = (value: number | undefined | null) => {
  if (value === undefined || value === null || isNaN(value)) return "0,00";
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * LÓGICA "CLÓVIS" (CONTA CORRENTE / SALDO REAL):
 * Recalcula o saldo devedor dia-a-dia, aplicando juros sobre o saldo remanescente
 * e abatendo os pagamentos. Isso replica a lógica da planilha.
 */
export const calculateRealBalance = (loan: Loan): number => {
    // Se for Juros Simples puro (só paga aluguel do dinheiro e devolve o principal no fim),
    // o saldo devedor é o Valor Original menos o que já amortizou de capital explicitamente.
    if (loan.interestType === 'SIMPLE') {
        const paidCapital = loan.history?.reduce((acc, h) => acc + (h.capitalPaid || 0), 0) || 0;
        return Math.max(0, loan.amount - paidCapital);
    }

    // --- LÓGICA DA PLANILHA (SISTEMA DE AMORTIZAÇÃO COMPOSTA / CONTA CORRENTE) ---
    // 1. Começamos com o valor do empréstimo
    let currentBalance = loan.amount;
    let lastDate = new Date(loan.startDate);
    const now = new Date();

    // 2. Ordenamos o histórico por data para processar cronologicamente
    const sortedHistory = [...(loan.history || [])]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Taxa diária (Pro Rata) baseada na taxa mensal do contrato
    const dailyRate = (loan.interestRate / 100) / 30;

    sortedHistory.forEach(record => {
        // Ignora registro de "Abertura" pois ele apenas marca o início (já temos o loan.amount)
        if (record.type === 'Abertura' || record.type === 'Empréstimo') return;

        const recordDate = new Date(record.date);
        
        // Calcula dias desde a última movimentação
        const diffTime = recordDate.getTime() - lastDate.getTime();
        const days = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

        // Aplica juros sobre o saldo anterior (Bola de Neve)
        const interestAccrued = currentBalance * dailyRate * days;
        currentBalance += interestAccrued;

        // Abate o valor total pago (O sistema deduz do montante total da dívida)
        currentBalance -= record.amount;

        // Atualiza a data de referência
        lastDate = recordDate;
    });

    // 3. Aplica juros residuais do último pagamento até HOJE (Projeção)
    const diffTimeNow = now.getTime() - lastDate.getTime();
    const daysSinceLast = Math.max(0, Math.ceil(diffTimeNow / (1000 * 60 * 60 * 24)));
    
    if (daysSinceLast > 0 && currentBalance > 0) {
        const pendingInterest = currentBalance * dailyRate * daysSinceLast;
        currentBalance += pendingInterest;
    }

    // Se ficar negativo (pagou a mais), retorna 0 ou negativo (crédito)
    // Aqui retornamos 0 para "Saldo Devedor", mas poderíamos retornar negativo se quiséssemos mostrar crédito.
    return Math.max(0, currentBalance);
};

/**
 * Calcula quanto da próxima parcela é Juros e quanto é Capital.
 * Baseado no Saldo Devedor Real (Matemática Clóvis).
 */
export const calculateInstallmentBreakdown = (
    totalDebt: number, 
    monthlyRate: number, 
    installmentValue: number
) => {
    // Juro do mês = Saldo Devedor * Taxa
    const interestPart = totalDebt * (monthlyRate / 100);
    
    // O que sobra da parcela vai para abater o capital
    const capitalPart = installmentValue - interestPart;
    
    // Se o juro for maior que a parcela (bola de neve negativa), o capital amortizado é 0 (ou negativo na contabilidade)
    // Mas para exibição amigável, mostramos 0.
    return {
        interest: interestPart > 0 ? interestPart : 0,
        capital: capitalPart > 0 ? capitalPart : 0,
        // Retorna também o déficit se a parcela não cobrir os juros
        deficit: capitalPart < 0 ? Math.abs(capitalPart) : 0
    };
};