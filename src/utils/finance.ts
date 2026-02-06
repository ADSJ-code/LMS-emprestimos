// Calculadora Oficial do Credit Now
// Agora suporta taxas históricas (Snapshot)

export const calculateOverdueValue = (
  amount: number, 
  dueDateStr: string, 
  status: string,
  finePercent: number = 2, // Padrão se não informado: 2%
  moraPercent: number = 1  // Padrão se não informado: 1%
) => {
  if (status !== 'Atrasado') return amount;

  const due = new Date(dueDateStr);
  const today = new Date();
  
  due.setMinutes(due.getMinutes() + due.getTimezoneOffset());
  today.setHours(0, 0, 0, 0);

  if (due >= today) return amount;

  const diffTime = Math.abs(today.getTime() - due.getTime());
  const days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // 1. Multa (Baseada no percentual salvo no contrato)
  const fine = amount * (finePercent / 100);

  // 2. Juros de Mora (Baseado no percentual salvo / 30 dias)
  const dailyInterestRate = (moraPercent / 100) / 30; 
  const interest = amount * (dailyInterestRate * days);

  return amount + fine + interest;
};

export const formatMoney = (value: number) => {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};