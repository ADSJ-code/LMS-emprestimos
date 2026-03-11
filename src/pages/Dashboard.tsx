import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, AlertTriangle, TrendingUp, Plus, 
  Search, FileText, ArrowRight, Calendar, Activity, 
  Briefcase, PieChart, RefreshCw, ArrowLeft, Filter,
  UserCheck, Bell, X, Clock, CalendarDays, ChevronDown, CheckCircle
} from 'lucide-react';
import Layout from '../components/Layout';
import { calculateOverdueValue, formatMoney, calculateCapitalBalance, calculateInstallmentBreakdown } from '../utils/finance';
import { loanService, clientService, settingsService, Loan, Client } from '../services/api';

const Dashboard = () => {
  const navigate = useNavigate();
  
  // --- ESTADOS DE FILTRO E VISÃO ---
  const [period, setPeriod] = useState<'hoje' | 'semana' | 'mes' | 'proximo_mes' | 'personalizado' | 'todos'>('todos');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  
  const [viewMode, setViewMode] = useState<'saldo' | 'fluxo'>('saldo');
  const [taxasViewMode, setTaxasViewMode] = useState<'capital' | 'lucro'>('capital');

  // FILTROS LOCAIS DOS CARDS
  const [tierFilters, setTierFilters] = useState({ capital: 'all', profit: 'all', overdue: 'all' });

  const [loading, setLoading] = useState(false);
  const [selectedRange, setSelectedRange] = useState<'low' | 'mid' | 'high' | 'capital' | 'profit' | 'overdue' | 'active' | 'clients_contracts' | null>(null);
  const [allLoans, setAllLoans] = useState<Loan[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  
  const [filteredLoansContext, setFilteredLoansContext] = useState<any[]>([]);

  // --- ESTADOS DO MODAL VENCIMENTOS ---
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  
  const [maturityDate, setMaturityDate] = useState(() => {
      const d = new Date();
      const offset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - offset).toISOString().split('T')[0];
  });

  const defaultTiers = { all: 0, low: 0, mid: 0, high: 0 };
  const [metrics, setMetrics] = useState({
    capitalNaRua: { ...defaultTiers },
    lucroProjetado: { ...defaultTiers },
    atrasoGeral: { ...defaultTiers },
    contratosAtivosFiltro: 0,
    contratosAtivosGlobais: 0,
    totalContratosLancados: 0,
    totalClientesCadastrados: 0,
    clientesComDivida: 0,
    taxas: { lowCap: 0, midCap: 0, highCap: 0, lowProf: 0, midProf: 0, highProf: 0 }
  });

  const [recentActivities, setRecentActivities] = useState<any[]>([]);

  // Helpers de Tempo e Matemática
  const parseLocalDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    const cleanStr = dateStr.split('T')[0];
    const [year, month, day] = cleanStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  const calculateRemainingProfit = (loan: Loan) => {
      const amount = Number(loan.amount) || 0;
      const installments = Number(loan.installments) || 0;
      const installmentValue = Number(loan.installmentValue) || 0;
      const paidInterest = Number(loan.totalPaidInterest) || 0;
      
      let totalExpectedInterest = Number(loan.projectedProfit) || 0;
      if (totalExpectedInterest <= 0) {
          if (loan.interestType === 'SIMPLE') totalExpectedInterest = installmentValue * (installments || 1);
          else totalExpectedInterest = Math.max(0, (installmentValue * installments) - amount);
      }
      return Math.max(0, totalExpectedInterest - paidInterest);
  };

  const getLoanDetails = (loan: Loan) => {
      const today = new Date();
      today.setHours(0,0,0,0);
      let tempDue = parseLocalDate(loan.nextDue);
      let totalOverdue = 0;
      let missedCount = 0;
      let count = 0;
      
      const baseAmount = loan.status === 'Acordo' ? loan.installmentValue + (loan.agreementValue || 0) : loan.installmentValue;
      const remainingInstallments = loan.interestType === 'SIMPLE' ? 999 : (loan.installments || 1);
      
      while (tempDue < today) {
          const dateStr = tempDue.toISOString().split('T')[0];
          totalOverdue += calculateOverdueValue(baseAmount, dateStr, 'Atrasado', loan.fineRate ?? 2, loan.moraInterestRate ?? 1, loan.amount);
          missedCount++;
          
          if (loan.status === 'Acordo') break; 
          
          count++;
          if (count >= remainingInstallments) break; 
          if (count > 60) break; 
          
          if (loan.frequency === 'SEMANAL') tempDue.setDate(tempDue.getDate() + 7);
          else if (loan.frequency === 'DIARIO') tempDue.setDate(tempDue.getDate() + 1);
          else tempDue.setMonth(tempDue.getMonth() + 1);
      }

      if (missedCount === 0 && loan.status === 'Atrasado') {
           const dateStr = loan.nextDue.split('T')[0];
           totalOverdue += calculateOverdueValue(baseAmount, dateStr, 'Atrasado', loan.fineRate ?? 2, loan.moraInterestRate ?? 1, loan.amount);
           missedCount = 1;
      }

      return { totalOverdue, missedCount };
  };

  // --- MOTOR CENTRAL DE FILTRAGEM E PROJEÇÃO ---
  const fetchAndCalculate = async () => {
    setLoading(true);
    try {
      const [loans, clients] = await Promise.all([ loanService.getAll(), clientService.getAll() ]);
      
      const safeLoans = (loans || []).map(l => ({
          ...l,
          amount: Number(l.amount) || 0,
          installmentValue: Number(l.installmentValue) || 0,
          installments: Number(l.installments) || 0,
          totalPaidCapital: Number(l.totalPaidCapital) || 0,
          totalPaidInterest: Number(l.totalPaidInterest) || 0,
          projectedProfit: Number(l.projectedProfit) || 0
      }));

      setAllLoans(safeLoans); 
      setAllClients(clients || []);
      
      const today = new Date();
      today.setHours(0,0,0,0);
      
      let startFilter: Date | null = null;
      let endFilter: Date | null = null;

      if (period === 'hoje') {
          startFilter = new Date(today);
          endFilter = new Date(today);
      } else if (period === 'semana') {
          startFilter = new Date(today);
          endFilter = new Date(today);
          endFilter.setDate(today.getDate() + 7);
      } else if (period === 'mes') {
          startFilter = new Date(today.getFullYear(), today.getMonth(), 1);
          endFilter = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      } else if (period === 'proximo_mes') {
          startFilter = new Date(today.getFullYear(), today.getMonth() + 1, 1);
          endFilter = new Date(today.getFullYear(), today.getMonth() + 2, 0);
      } else if (period === 'personalizado' && customStart && customEnd) {
          startFilter = parseLocalDate(customStart);
          endFilter = parseLocalDate(customEnd);
      }

      if (endFilter) endFilter.setHours(23, 59, 59, 999);

      const activeDebtors = new Set();
      const uniqueMatchedContracts = new Set();
      
      let capAcc = { all: 0, low: 0, mid: 0, high: 0 };
      let profAcc = { all: 0, low: 0, mid: 0, high: 0 };
      let overAcc = { all: 0, low: 0, mid: 0, high: 0 };

      let rLowCap = 0, rMidCap = 0, rHighCap = 0;
      let rLowProf = 0, rMidProf = 0, rHighProf = 0;
      let totalGloballyActive = 0;
      
      const filteredContext: any[] = [];
      const isFluxo = viewMode === 'fluxo' && period !== 'todos';
      const pad = (n: number) => n.toString().padStart(2, '0');

      safeLoans.forEach((loan: any) => {
        const isPaid = loan.status === 'Pago' || loan.status === 'Quitado';
        
        if (!isPaid) {
            totalGloballyActive++;
            activeDebtors.add(loan.client);
        }
        
        if (isPaid) return;

        const breakdown = calculateInstallmentBreakdown(loan);
        const { totalOverdue, missedCount } = getLoanDetails(loan);
        
        // Lucro real restante = Todo o lucro - (lucro das parcelas que já estão em atraso)
        const remProfit = calculateRemainingProfit(loan);
        const futureProfitTotal = Math.max(0, remProfit - (missedCount * breakdown.interest));
        const capBalance = calculateCapitalBalance(loan);

        let currentDue = parseLocalDate(loan.nextDue);
        
        let hasMatch = false;
        let capToAdd = 0;
        let profToAdd = 0;
        let overToAdd = 0;
        let slices: any[] = []; 

        if (!startFilter || !endFilter) {
            hasMatch = true;
            capToAdd = capBalance;          // TODO o capital fica
            profToAdd = futureProfitTotal;  // Somente lucro futuro
            overToAdd = totalOverdue;       // Bola de neve das atrasadas
        } else {
            const limit = loan.interestType === 'SIMPLE' ? 60 : (loan.installments || 1);
            for (let i = 0; i < limit; i++) {
                if (currentDue >= startFilter && currentDue <= endFilter) {
                    hasMatch = true;
                    capToAdd += breakdown.capital;
                    
                    // Separando o que é lucro futuro do que é atraso dentro deste período
                    if (currentDue < today || (i === 0 && loan.status === 'Atrasado')) {
                        const baseAmount = (i === 0 && loan.status === 'Acordo') ? loan.installmentValue + (loan.agreementValue || 0) : loan.installmentValue;
                        overToAdd += calculateOverdueValue(baseAmount, currentDue.toISOString().split('T')[0], 'Atrasado', loan.fineRate ?? 2, loan.moraInterestRate ?? 1, loan.amount);
                    } else {
                        profToAdd += breakdown.interest;
                    }
                    
                    slices.push({
                        date: `${currentDue.getFullYear()}-${pad(currentDue.getMonth() + 1)}-${pad(currentDue.getDate())}`,
                        capital: breakdown.capital,
                        interest: breakdown.interest,
                        index: i
                    });
                }
                if (currentDue > endFilter) break;

                if (loan.frequency === 'SEMANAL') currentDue.setDate(currentDue.getDate() + 7);
                else if (loan.frequency === 'DIARIO') currentDue.setDate(currentDue.getDate() + 1);
                else currentDue.setMonth(currentDue.getMonth() + 1);
            }
        }

        if (hasMatch) {
            uniqueMatchedContracts.add(loan.id);

            const tier = loan.interestRate < 10 ? 'low' : loan.interestRate <= 15 ? 'mid' : 'high';

            // Alimentando os acumuladores dos Cards
            capAcc.all += capToAdd;
            capAcc[tier] += capToAdd;

            profAcc.all += profToAdd;
            profAcc[tier] += profToAdd;

            overAcc.all += overToAdd;
            overAcc[tier] += overToAdd;

            // Alimentando o gráfico de pizza (Tiers Globais)
            let capGraph = isFluxo ? capToAdd : capBalance;
            let profGraph = isFluxo ? profToAdd : calculateRemainingProfit(loan);

            if (tier === 'low') { rLowCap += capGraph; rLowProf += profGraph; } 
            else if (tier === 'mid') { rMidCap += capGraph; rMidProf += profGraph; } 
            else { rHighCap += capGraph; rHighProf += profGraph; }

            // Alimentando a Tabela de Detalhes
            if (period !== 'todos' && slices.length > 0) {
                slices.forEach(slice => {
                    filteredContext.push({ 
                        ...loan, 
                        uniqueSliceId: `${loan.id}-slice-${slice.index}`,
                        projectedDate: slice.date,
                        projectedCapitalForPeriod: slice.capital, 
                        projectedInterestForPeriod: slice.interest
                    });
                });
            } else {
                filteredContext.push({ 
                    ...loan, 
                    uniqueSliceId: loan.id,
                    projectedDate: loan.nextDue,
                    projectedCapitalForPeriod: capToAdd, 
                    projectedInterestForPeriod: profToAdd
                });
            }
        }
      });

      setFilteredLoansContext(filteredContext);

      setMetrics({
        capitalNaRua: capAcc,
        lucroProjetado: profAcc,
        atrasoGeral: overAcc,
        contratosAtivosFiltro: uniqueMatchedContracts.size,
        contratosAtivosGlobais: totalGloballyActive,
        totalContratosLancados: safeLoans.length,
        totalClientesCadastrados: clients ? clients.length : 0,
        clientesComDivida: activeDebtors.size,
        taxas: { lowCap: rLowCap, midCap: rMidCap, highCap: rHighCap, lowProf: rLowProf, midProf: rMidProf, highProf: rHighProf }
      });

      const activities = [...safeLoans].sort((a, b) => new Date(b.nextDue).getTime() - new Date(a.nextDue).getTime()).slice(0, 6).map((loan: any) => {
        const dueDate = parseLocalDate(loan.nextDue);
        const isOverdue = dueDate < today && loan.status !== 'Pago' && loan.status !== 'Quitado';
        return {
          id: loan.id,
          type: isOverdue ? 'atraso' : 'novo_contrato',
          text: isOverdue ? `Atraso: ${loan.client}` : `Pendente: ${loan.client}`,
          time: dueDate.toLocaleDateString('pt-BR'), 
          value: isOverdue ? 'Cobrar' : `R$ ${formatMoney(loan.installmentValue)}`
        };
      });
      setRecentActivities(activities);

    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  useEffect(() => { 
      if (period !== 'personalizado') fetchAndCalculate();
  }, [period, viewMode]);

  useEffect(() => {
      if (period === 'personalizado' && customStart && customEnd) {
          const timeout = setTimeout(() => fetchAndCalculate(), 500);
          return () => clearTimeout(timeout);
      }
  }, [customStart, customEnd, period, viewMode]);

  const handlePeriodChange = (val: string) => {
      setPeriod(val as any);
      if (val !== 'todos') setViewMode('fluxo');
      else setViewMode('saldo');
  };

  const loansOnMaturityDate = useMemo(() => {
      if (!maturityDate) return [];
      return allLoans.filter(l => {
          if (l.status === 'Pago' || l.status === 'Quitado') return false;
          return l.nextDue.split('T')[0] === maturityDate;
      });
  }, [allLoans, maturityDate]);

  const detailedLoans = useMemo(() => {
      if (!selectedRange || selectedRange === 'clients_contracts') return [];
      const today = new Date();
      today.setHours(0,0,0,0);

      if (selectedRange === 'overdue') {
          const contextIds = new Set(filteredLoansContext.map(l => l.id));
          return allLoans.filter(l => {
              const dueDate = parseLocalDate(l.nextDue);
              const isOverdue = l.status !== 'Pago' && l.status !== 'Quitado' && (dueDate < today || l.status === 'Atrasado');
              
              // Filtro de Faixa Aplicado na Tabela
              let passTier = true;
              if (tierFilters.overdue === 'low') passTier = l.interestRate < 10;
              if (tierFilters.overdue === 'mid') passTier = l.interestRate >= 10 && l.interestRate <= 15;
              if (tierFilters.overdue === 'high') passTier = l.interestRate > 15;

              return isOverdue && contextIds.has(l.id) && passTier;
          });
      }

      return filteredLoansContext.filter(l => {
          if (selectedRange === 'active') return l.status !== 'Pago' && l.status !== 'Quitado';
          if (l.status === 'Pago' || l.status === 'Quitado') return false; 
          
          // Filtros de Faixa Aplicados na Tabela
          let passTier = true;
          if (selectedRange === 'capital' && tierFilters.capital !== 'all') {
              if (tierFilters.capital === 'low') passTier = l.interestRate < 10;
              if (tierFilters.capital === 'mid') passTier = l.interestRate >= 10 && l.interestRate <= 15;
              if (tierFilters.capital === 'high') passTier = l.interestRate > 15;
          }
          if (selectedRange === 'profit' && tierFilters.profit !== 'all') {
              if (tierFilters.profit === 'low') passTier = l.interestRate < 10;
              if (tierFilters.profit === 'mid') passTier = l.interestRate >= 10 && l.interestRate <= 15;
              if (tierFilters.profit === 'high') passTier = l.interestRate > 15;
          }
          
          if (!passTier) return false;

          if (selectedRange === 'capital' || selectedRange === 'profit') return true; 
          if (selectedRange === 'low') return l.interestRate < 10;
          if (selectedRange === 'mid') return l.interestRate >= 10 && l.interestRate <= 15;
          if (selectedRange === 'high') return l.interestRate > 15;
          return false;
      });
  }, [filteredLoansContext, allLoans, selectedRange, tierFilters]);

  // Agrupamento para a visão de Clientes vs Contratos
  const activeContractsByClient = useMemo(() => {
      if (selectedRange !== 'clients_contracts') return [];
      const map = new Map();
      allLoans.forEach(l => {
          if (l.status === 'Pago' || l.status === 'Quitado') return;
          if (!map.has(l.client)) map.set(l.client, { name: l.client, contracts: [], totalCapital: 0, totalProfit: 0 });
          const c = map.get(l.client);
          c.contracts.push(l);
          c.totalCapital += calculateCapitalBalance(l);
          c.totalProfit += calculateRemainingProfit(l);
      });
      return Array.from(map.values()).sort((a,b) => b.contracts.length - a.contracts.length);
  }, [allLoans, selectedRange]);

  const rangeTitles = {
      low: 'Taxa Baixa (< 10%)', mid: 'Taxa Média (10% - 15%)', high: 'Taxa Alta (> 15%)',
      capital: 'Detalhamento de Capital', profit: 'Detalhamento de Lucro', overdue: 'Contratos em Atraso (Bola de Neve)', active: 'Carteira de Contratos no Filtro',
      clients_contracts: 'Relação de Clientes e Contratos Ativos'
  };

  const goToBillingWithSearch = (clientName: string) => {
       sessionStorage.setItem('searchClient', clientName);
       navigate('/billing');
  }

  const isFluxoAtivo = viewMode === 'fluxo' && period !== 'todos';

  return (
    <Layout>
      {showWelcomeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
                  <div className="bg-slate-900 p-6 flex justify-between items-center">
                      <div>
                          <h3 className="text-xl font-bold text-white flex items-center gap-2"><CalendarDays size={22} className="text-yellow-400"/> Vencimentos</h3>
                          <p className="text-slate-400 text-xs">Consulte o que vence em cada data.</p>
                      </div>
                      <button onClick={() => setShowWelcomeModal(false)} className="text-white/50 hover:text-white"><X size={24}/></button>
                  </div>
                  
                  <div className="p-4 bg-slate-50 border-b border-slate-200">
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Data de Referência</label>
                      <input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} className="w-full p-3 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"/>
                  </div>

                  <div className="p-6">
                      <h4 className="text-sm font-bold text-slate-500 uppercase mb-3 flex items-center gap-2"><Bell size={16}/> Lista de Contratos ({loansOnMaturityDate.length})</h4>
                      <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                          {loansOnMaturityDate.length === 0 ? (
                              <div className="text-center py-6">
                                  <CheckCircle size={40} className="mx-auto text-slate-300 mb-2"/>
                                  <p className="text-sm text-slate-400 italic">Nada consta para esta data.</p>
                              </div>
                          ) : (
                              loansOnMaturityDate.map(l => (
                                  <div key={l.id} className="flex justify-between items-center p-3 bg-blue-50 rounded-xl border border-blue-100 hover:bg-blue-100 transition-colors cursor-pointer" onClick={() => goToBillingWithSearch(l.client)}>
                                      <div>
                                          <span className="font-bold text-blue-900 block">{l.client}</span>
                                          <span className="text-[10px] text-blue-500 font-mono">{l.id}</span>
                                      </div>
                                      <span className="text-blue-700 font-bold">R$ {formatMoney(l.installmentValue)}</span>
                                  </div>
                              ))
                          )}
                      </div>
                      <div className="mt-6 pt-4 border-t border-slate-100">
                          <button onClick={() => setShowWelcomeModal(false)} className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all">Fechar</button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {selectedRange ? (
          <div className="animate-in slide-in-from-right-10 duration-300">
              <header className="mb-6 flex items-center gap-4">
                  <button onClick={() => setSelectedRange(null)} className="p-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"><ArrowLeft size={20}/></button>
                  <div><h2 className="text-2xl font-bold text-slate-800">{rangeTitles[selectedRange]}</h2><p className="text-slate-500">Detalhamento dos valores baseados na sua seleção.</p></div>
              </header>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  
                  {selectedRange === 'clients_contracts' ? (
                      <table className="w-full text-left">
                          <thead>
                              <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                                  <th className="p-4">Cliente / Devedor</th>
                                  <th className="p-4 text-center">Contratos Ativos</th>
                                  <th className="p-4 text-center">IDs de Referência</th>
                                  <th className="p-4 text-right">Risco Capital (R$)</th>
                                  <th className="p-4 text-right text-green-600">Lucro Esperado (R$)</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                              {activeContractsByClient.map(c => (
                                  <tr key={c.name} className="hover:bg-blue-50 transition-colors cursor-pointer" onClick={() => goToBillingWithSearch(c.name)}>
                                      <td className="p-4 font-bold text-slate-800">{c.name}</td>
                                      <td className="p-4 text-center">
                                          <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-bold">{c.contracts.length} ativos</span>
                                      </td>
                                      <td className="p-4 text-center text-[10px] text-slate-400 font-mono tracking-widest">
                                          {c.contracts.map((cnt: any) => cnt.id.substring(0,6)).join(', ')}
                                      </td>
                                      <td className="p-4 text-right font-bold text-slate-700">R$ {formatMoney(c.totalCapital)}</td>
                                      <td className="p-4 text-right font-bold text-green-600">R$ {formatMoney(c.totalProfit)}</td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  ) : (
                      <table className="w-full text-left">
                          <thead>
                              <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                                  <th className="p-4">Cliente</th>
                                  <th className="p-4 text-center">
                                      {selectedRange === 'overdue' ? 'Atrasado Desde' : period === 'todos' ? 'Venc. Original' : 'Data Projetada'}
                                  </th>
                                  <th className="p-4 text-center">Taxa (%)</th>
                                  <th className="p-4 text-right">
                                      {selectedRange === 'overdue' ? 'Valor Original (Atrasado)' : period !== 'todos' ? 'Capital da Parcela' : 'Saldo Devedor (Total)'}
                                  </th>
                                  <th className="p-4 text-right text-green-600">
                                      {selectedRange === 'overdue' ? '-' : period !== 'todos' ? 'Juros da Parcela' : 'Lucro Restante (Total)'}
                                  </th>
                                  {selectedRange === 'overdue' && <th className="p-4 text-right text-red-600">Bola de Neve (Atualizado)</th>}
                                  <th className="p-4 text-center">Status</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                              {detailedLoans.map(loan => {
                                  const capBalance = calculateCapitalBalance(loan);
                                  const remProfit = calculateRemainingProfit(loan);
                                  const overdueVal = getLoanDetails(loan).totalOverdue;
                                  
                                  return (
                                      <tr key={loan.uniqueSliceId || loan.id} className="hover:bg-blue-50 transition-colors cursor-pointer" onClick={() => goToBillingWithSearch(loan.client)}>
                                          <td className="p-4 font-bold text-slate-800">
                                              {loan.client}
                                              <div className="text-[10px] font-mono text-slate-400 font-normal">{loan.id}</div>
                                          </td>
                                          
                                          <td className="p-4 text-center text-sm font-medium">
                                              {selectedRange === 'overdue' ? (
                                                  <>
                                                      <div className="flex items-center justify-center gap-1 text-red-600 font-bold">
                                                          <Calendar size={12}/>
                                                          {parseLocalDate(loan.nextDue).toLocaleDateString('pt-BR')}
                                                      </div>
                                                      <div className="text-[9px] text-red-400 font-bold uppercase tracking-wider mt-0.5">Pendente</div>
                                                  </>
                                              ) : period === 'todos' ? (
                                                  <>
                                                      {parseLocalDate(loan.nextDue).toLocaleDateString('pt-BR')}
                                                      <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Atual</div>
                                                  </>
                                              ) : (
                                                  <>
                                                      {parseLocalDate(loan.projectedDate).toLocaleDateString('pt-BR')}
                                                      <div className="text-[9px] text-blue-500 font-bold uppercase tracking-wider mt-0.5">Projetada</div>
                                                  </>
                                              )}
                                          </td>

                                          <td className="p-4 text-center font-bold text-slate-600">{loan.interestRate}%</td>
                                          
                                          <td className="p-4 text-right font-bold text-slate-700">
                                              R$ {formatMoney(selectedRange === 'overdue' ? loan.installmentValue : period !== 'todos' ? loan.projectedCapitalForPeriod : capBalance)}
                                          </td>
                                          <td className="p-4 text-right font-bold text-green-600">
                                              {selectedRange === 'overdue' ? '-' : `R$ ${formatMoney(period !== 'todos' ? loan.projectedInterestForPeriod : remProfit)}`}
                                          </td>
                                          
                                          {selectedRange === 'overdue' && <td className="p-4 text-right font-black text-red-600">R$ {formatMoney(overdueVal)}</td>}
                                          <td className="p-4 text-center">
                                              <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${loan.status === 'Atrasado' ? 'bg-red-50 text-red-600' : loan.status === 'Acordo' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'}`}>
                                                  {loan.status}
                                              </span>
                                          </td>
                                      </tr>
                                  )
                              })}
                          </tbody>
                      </table>
                  )}
              </div>
          </div>
      ) : (
          <>
            <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-8 gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Dashboard</h2>
                    <p className="text-slate-500">Visão geral e projeções do sistema.</p>
                </div>
                
                <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center w-full xl:w-auto">
                    {period !== 'todos' && (
                        <div className="flex bg-slate-100 p-1 rounded-xl shadow-inner border border-slate-200">
                            <button
                                onClick={() => setViewMode('saldo')}
                                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 ${viewMode === 'saldo' ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-400 hover:text-slate-700'}`}
                            >
                                <Briefcase size={14}/> Saldo Global
                            </button>
                            <button
                                onClick={() => setViewMode('fluxo')}
                                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 ${viewMode === 'fluxo' ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-400 hover:text-slate-700'}`}
                            >
                                <TrendingUp size={14}/> Fluxo do Período
                            </button>
                        </div>
                    )}

                    <button onClick={fetchAndCalculate} className="p-2.5 bg-white border border-gray-200 rounded-xl text-slate-500 hover:text-slate-900 transition-colors shadow-sm"><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button>
                    <div className="relative">
                        <select value={period === 'personalizado' ? 'personalizado' : period} onChange={(e) => handlePeriodChange(e.target.value)} className="appearance-none bg-white pl-4 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-slate-700 shadow-sm outline-none focus:ring-2 focus:ring-slate-900/10 cursor-pointer">
                            <option value="todos">Todos os Períodos</option><option value="hoje">Vencendo Hoje</option><option value="semana">Esta Semana</option><option value="mes">Este Mês</option><option value="proximo_mes">Próximo Mês</option><option value="personalizado">Datas Personalizadas</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16}/>
                    </div>
                    {(period === 'personalizado' || (customStart && customEnd)) && (
                        <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm animate-in fade-in slide-in-from-left-2">
                            <div className="flex items-center gap-2 px-2"><input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="text-xs font-bold text-slate-600 bg-transparent outline-none w-28 border border-slate-100 rounded p-1"/><span className="text-slate-300">até</span><input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="text-xs font-bold text-slate-600 bg-transparent outline-none w-28 border border-slate-100 rounded p-1"/></div>
                        </div>
                    )}
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                
                {/* CARD CAPITAL */}
                <div onClick={() => setSelectedRange('capital')} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 bg-blue-50 text-blue-600 rounded-lg"><Briefcase size={24} /></div>
                        <select onClick={e => e.stopPropagation()} value={tierFilters.capital} onChange={e => setTierFilters({...tierFilters, capital: e.target.value})} className="text-[10px] bg-slate-50 border border-slate-200 rounded p-1 outline-none text-slate-600 font-bold cursor-pointer hover:bg-slate-100">
                            <option value="all">Todas as Faixas</option>
                            <option value="low">1% a 9%</option>
                            <option value="mid">10% a 15%</option>
                            <option value="high">+ 15%</option>
                        </select>
                    </div>
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">
                        {viewMode === 'fluxo' && period !== 'todos' ? 'Entrada Prevista (Capital)' : 'Capital a Receber (Global)'}
                    </h3>
                    <p className="text-2xl font-black text-slate-800">{formatMoney(metrics.capitalNaRua[tierFilters.capital as keyof typeof defaultTiers])}</p>
                </div>

                {/* CARD LUCRO */}
                <div onClick={() => setSelectedRange('profit')} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-green-300 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-4">
                        <div className="p-3 bg-green-50 text-green-600 rounded-lg"><TrendingUp size={24} /></div>
                        <select onClick={e => e.stopPropagation()} value={tierFilters.profit} onChange={e => setTierFilters({...tierFilters, profit: e.target.value})} className="text-[10px] bg-slate-50 border border-slate-200 rounded p-1 outline-none text-slate-600 font-bold cursor-pointer hover:bg-slate-100">
                            <option value="all">Todas as Faixas</option>
                            <option value="low">1% a 9%</option>
                            <option value="mid">10% a 15%</option>
                            <option value="high">+ 15%</option>
                        </select>
                    </div>
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">
                        {viewMode === 'fluxo' && period !== 'todos' ? 'Lucro Previsto no Filtro' : 'Lucro Restante a Receber'}
                    </h3>
                    <p className="text-2xl font-black text-green-600">+{formatMoney(metrics.lucroProjetado[tierFilters.profit as keyof typeof defaultTiers])}</p>
                </div>

                {/* CARD ATRASO */}
                <div onClick={() => setSelectedRange('overdue')} className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-red-500 hover:shadow-md hover:bg-red-50/10 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-2">
                        <div className="p-3 bg-red-50 text-red-600 rounded-lg"><AlertTriangle size={24} /></div>
                        <select onClick={e => e.stopPropagation()} value={tierFilters.overdue} onChange={e => setTierFilters({...tierFilters, overdue: e.target.value})} className="text-[10px] bg-red-50/50 border border-red-200 rounded p-1 outline-none text-red-700 font-bold cursor-pointer hover:bg-red-100">
                            <option value="all">Todas as Faixas</option>
                            <option value="low">1% a 9%</option>
                            <option value="mid">10% a 15%</option>
                            <option value="high">+ 15%</option>
                        </select>
                    </div>
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">
                        {period === 'todos' ? 'Total em Atraso (Global)' : 'Total em Atraso (No Filtro)'}
                    </h3>
                    <p className="text-2xl font-black text-slate-800 mb-3">{formatMoney(metrics.atrasoGeral[tierFilters.overdue as keyof typeof defaultTiers])}</p>
                </div>
                
                {/* Novo Card Global de Clientes e Contratos */}
                <div onClick={() => setSelectedRange('clients_contracts')} className="bg-slate-900 p-6 rounded-xl shadow-lg text-white relative overflow-hidden cursor-pointer hover:bg-slate-800 transition-all group">
                    <div className="absolute right-0 top-0 opacity-10 p-2 group-hover:scale-110 transition-transform"><Users size={64} /></div>
                    <h3 className="text-slate-300 text-xs font-bold uppercase mb-1 flex items-center gap-1"><Briefcase size={12}/> Clientes & Contratos</h3>
                    <div className="flex justify-between items-end mt-2">
                        <div>
                            <p className="text-3xl font-black text-white">{metrics.clientesComDivida}</p>
                            <p className="text-[10px] text-slate-400">Clientes Ativos</p>
                        </div>
                        <div className="text-right">
                            <p className="text-xl font-bold text-white">{metrics.contratosAtivosGlobais}</p>
                            <p className="text-[10px] text-slate-400">Contratos Ativos</p>
                        </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-700/50 flex justify-between text-[10px] text-slate-400 font-medium">
                        <span>Cadastros: {metrics.totalClientesCadastrados}</span>
                        <span>Lançados: {metrics.totalContratosLancados}</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                            <div className="flex items-center gap-2">
                                <PieChart className="text-slate-400" size={20}/>
                                <h3 className="font-bold text-lg text-slate-800">Distribuição por Taxa</h3>
                            </div>
                            <div className="flex bg-slate-100 p-1 rounded-lg w-fit">
                                <button onClick={() => setTaxasViewMode('capital')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${taxasViewMode === 'capital' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Capital</button>
                                <button onClick={() => setTaxasViewMode('lucro')} className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${taxasViewMode === 'lucro' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Lucro</button>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div onClick={() => { setTierFilters({...tierFilters, capital: 'low', profit: 'low'}); setSelectedRange(taxasViewMode === 'capital' ? 'capital' : 'profit'); }} className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center cursor-pointer hover:bg-slate-100 transition-colors group">
                                <p className="text-xs font-bold text-slate-500 uppercase mb-1 group-hover:text-blue-600 transition-colors">1% a 9% (Baixa)</p>
                                <p className="text-2xl font-black text-slate-700">R$ {formatMoney(taxasViewMode === 'capital' ? metrics.taxas.lowCap : metrics.taxas.lowProf)}</p>
                            </div>
                            <div onClick={() => { setTierFilters({...tierFilters, capital: 'mid', profit: 'mid'}); setSelectedRange(taxasViewMode === 'capital' ? 'capital' : 'profit'); }} className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-center cursor-pointer hover:bg-blue-100 transition-colors group">
                                <p className="text-xs font-bold text-blue-500 uppercase mb-1 group-hover:text-blue-700 transition-colors">10% a 15% (Média)</p>
                                <p className="text-2xl font-black text-blue-700">R$ {formatMoney(taxasViewMode === 'capital' ? metrics.taxas.midCap : metrics.taxas.midProf)}</p>
                            </div>
                            <div onClick={() => { setTierFilters({...tierFilters, capital: 'high', profit: 'high'}); setSelectedRange(taxasViewMode === 'capital' ? 'capital' : 'profit'); }} className="p-4 bg-indigo-50 rounded-lg border border-indigo-100 text-center cursor-pointer hover:bg-indigo-100 transition-colors group">
                                <p className="text-xs font-bold text-indigo-500 uppercase mb-1 group-hover:text-indigo-700 transition-colors">Acima de 15% (Alta)</p>
                                <p className="text-2xl font-black text-indigo-700">R$ {formatMoney(taxasViewMode === 'capital' ? metrics.taxas.highCap : metrics.taxas.highProf)}</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <h3 className="font-bold text-lg text-slate-800 mb-4">Acesso Rápido</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <button onClick={() => navigate('/billing')} className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all group"><div className="p-3 bg-blue-100 text-blue-600 rounded-full mb-2 group-hover:scale-110 transition-transform"><Plus size={20} /></div><span className="text-sm font-medium text-slate-700">Novo Empréstimo</span></button>
                            <button onClick={() => navigate('/clients')} className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-purple-500 hover:bg-purple-50 transition-all group"><div className="p-3 bg-purple-100 text-purple-600 rounded-full mb-2 group-hover:scale-110 transition-transform"><Users size={20} /></div><span className="text-sm font-medium text-slate-700">Novo Cliente</span></button>
                            
                            <button onClick={() => setShowWelcomeModal(true)} className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-orange-500 hover:bg-orange-50 transition-all group"><div className="p-3 bg-orange-100 text-orange-600 rounded-full mb-2 group-hover:scale-110 transition-transform"><CalendarDays size={20} /></div><span className="text-sm font-medium text-slate-700">Vencimentos</span></button>
                            
                            <button onClick={() => navigate('/overdue')} className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-yellow-500 hover:bg-yellow-50 transition-all group"><div className="p-3 bg-yellow-100 text-yellow-600 rounded-full mb-2 group-hover:scale-110 transition-transform"><FileText size={20} /></div><span className="text-sm font-medium text-slate-700">Relatórios</span></button>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit">
                    <div className="flex justify-between items-center mb-6"><h3 className="font-bold text-lg text-slate-800">Atividade Global</h3><button onClick={() => navigate('/history')} className="text-blue-600 text-xs font-medium hover:underline flex items-center gap-1">Ver tudo <ArrowRight size={12} /></button></div>
                    <div className="space-y-6">
                        {recentActivities.length > 0 ? (recentActivities.map((activity) => (<div key={activity.id} className="flex gap-4 items-start"><div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${activity.type === 'atraso' ? 'bg-red-500' : 'bg-slate-300'}`} /><div><p className="text-sm font-medium text-slate-800 leading-tight">{activity.text}</p><p className="text-xs text-slate-400 mt-1">{activity.time}</p></div>{activity.value !== '-' && (<span className={`ml-auto text-xs font-bold whitespace-nowrap ${activity.type === 'atraso' ? 'text-red-600 bg-red-50 px-2 py-1 rounded' : 'text-slate-600'}`}>{activity.value}</span>)}</div>))) : (<div className="text-center py-8 text-slate-400 text-sm"><Activity size={24} className="mx-auto mb-2 opacity-50"/>Nenhuma atividade no momento.</div>)}
                    </div>
                </div>
            </div>
          </>
      )}
    </Layout>
  );
};

export default Dashboard;