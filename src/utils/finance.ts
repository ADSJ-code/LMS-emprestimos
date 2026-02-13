import { Loan } from '../services/api';

/**
 * Calcula o valor atualizado de uma parcela em atraso.
 * BLINDAGEM TOTAL: Aceita 0, undefined ou null sem forçar valores padrão indesejados.
 */
export const calculateOverdueValue = (
  amount: number, 
  dueDateStr: string, 
  status: string,
  finePercent?: number, // Se undefined, assume 0 (sem multa forçada)
  moraPercent?: number  // Se undefined, assume 0 (sem juros forçados)
): number => {
  // Se não estiver atrasado, retorna o valor original limpo
  if (status !== 'Atrasado' && status !== 'Acordo') return amount;

  const due = new Date(dueDateStr);
  const today = new Date();
  
  // Normaliza para meia-noite para comparar apenas datas (evita erro de horas)
  due.setMinutes(due.getMinutes() + due.getTimezoneOffset());
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  // Se ainda não venceu (ou vence hoje), não cobra nada extra
  if (due >= today) return amount;

  // Diferença em dias corridos
  const diffTime = Math.abs(today.getTime() - due.getTime());
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // 1. Multa (Multa fixa única sobre o valor da parcela)
  // Usa "|| 0" para garantir que se for null/undefined/NaN vire 0.
  // Se o usuário digitou 0, continua 0.
  const safeFine = (finePercent === undefined || finePercent === null || isNaN(finePercent)) ? 0 : finePercent;
  const fineValue = amount * (safeFine / 100);

  // 2. Juros de Mora (Juros pro rata die baseados na taxa mensal)
  const safeMora = (moraPercent === undefined || moraPercent === null || isNaN(moraPercent)) ? 0 : moraPercent;
  
  // Taxa diária simples = Taxa Mensal / 30 dias
  const dailyInterestRate = (safeMora / 100) / 30; 
  const interestValue = amount * (dailyInterestRate * days);

  return amount + fineValue + interestValue;
};

/**
 * Formata valores monetários para o padrão BRL (R$ 1.234,56).
 * Protegido contra valores nulos/NaN.
 */
export const formatMoney = (value: number | undefined | null | string): string => {
  if (value === undefined || value === null || value === '') return "0,00";
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return "0,00";
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * LÓGICA DE SALDO DEVEDOR REAL (MATEMÁTICA FINANCEIRA / PRICE)
 * * Objetivo: Replicar a planilha onde o saldo devedor é atualizado dia a dia.
 * - Juros são calculados sobre o saldo devedor anterior.
 * - Pagamentos abatem primeiro os juros acumulados, depois o capital.
 */
export const calculateRealBalance = (loan: Loan): number => {
    // 1. Saldo Inicial = Valor do Empréstimo
    let currentBalance = loan.amount;
    
    // Se não houver histórico, retorna o valor cheio
    if (!loan.history || loan.history.length === 0) return currentBalance;

    // 2. Ordena eventos cronologicamente
    // Filtra apenas eventos financeiros relevantes (ignora anotações puras se houver)
    const events = loan.history
        .filter(h => h.type !== 'Acordo') // Acordo muda data, não saldo financeiro passado
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Data de referência inicial (Data do contrato)
    let lastDate = new Date(loan.startDate);
    // Ajusta fuso
    lastDate.setMinutes(lastDate.getMinutes() + lastDate.getTimezoneOffset());
    lastDate.setHours(0,0,0,0);

    const dailyRate = (loan.interestRate / 100) / 30; // Taxa diária linear

    events.forEach(event => {
        // Pula o registro inicial de "Abertura" pois já começamos com loan.amount
        if (event.type === 'Abertura' || event.type === 'Empréstimo') return;

        const eventDate = new Date(event.date);
        eventDate.setMinutes(eventDate.getMinutes() + eventDate.getTimezoneOffset());
        eventDate.setHours(0,0,0,0);

        // Calcula dias decorridos desde a última movimentação
        const diffTime = eventDate.getTime() - lastDate.getTime();
        const days = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

        // A. Aplica Juros do período sobre o saldo anterior (Juro Simples no período, acumulando no saldo)
        const interestAccrued = currentBalance * (dailyRate * days);
        currentBalance += interestAccrued;

        // B. Abate o valor pago (Capital + Juros pagos)
        // Se o cliente pagou, reduzimos do saldo total da dívida
        if (event.amount > 0) {
            currentBalance -= event.amount;
        }

        // Atualiza referência
        lastDate = eventDate;
    });

    // 3. Projeção até HOJE (Juros incorridos desde o último pagamento até agora)
    const today = new Date();
    today.setHours(0,0,0,0);
    
    // Só calcula juros "futuros" se o contrato não estiver quitado/pago
    if (loan.status !== 'Pago') {
        const diffTimeNow = today.getTime() - lastDate.getTime();
        const daysSinceLast = Math.max(0, Math.ceil(diffTimeNow / (1000 * 60 * 60 * 24)));
        
        if (daysSinceLast > 0 && currentBalance > 0.10) {
             const pendingInterest = currentBalance * (dailyRate * daysSinceLast);
             currentBalance += pendingInterest;
        }
    }

    // Retorna zero se o saldo for residual irrelevante (ex: 0.00001)
    return currentBalance < 0.10 ? 0 : currentBalance;
};

/**
 * Calcula a composição da próxima parcela (Juros vs Capital)
 * baseada no Saldo Devedor ATUAL.
 */
export const calculateInstallmentBreakdown = (
    loan: Loan
): { interest: number, capital: number, total: number } => {
    // 1. Pega o Saldo Devedor Real Hoje
    const realBalance = calculateRealBalance(loan);
    
    // 2. Calcula quanto desse saldo é Juro do mês corrente (aproximado)
    // Juros = Saldo Devedor * Taxa Mensal
    const interestPart = realBalance * (loan.interestRate / 100);
    
    // 3. A parcela é fixa (contratada)
    const fixedInstallment = loan.installmentValue;

    // 4. O Capital é o que sobra: (Parcela - Juros)
    let capitalPart = fixedInstallment - interestPart;

    // Se os juros engolirem a parcela (Juros > Parcela), não amortiza nada (Capital = 0)
    // O déficit vai acumular no saldo devedor na próxima rodada
    if (capitalPart < 0) capitalPart = 0;

    return {
        interest: interestPart,
        capital: capitalPart,
        total: fixedInstallment
    };
};