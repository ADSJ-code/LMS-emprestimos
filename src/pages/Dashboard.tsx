import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, AlertTriangle, TrendingUp, Plus, 
  Search, FileText, ArrowRight, Calendar, Activity, 
  Briefcase, PieChart, RefreshCw, ArrowLeft, Filter,
  UserCheck, Bell, X, Clock, CalendarDays, ChevronDown, CheckCircle
} from 'lucide-react';
import Layout from '../components/Layout';
import { calculateOverdueValue, formatMoney, calculateCapitalBalance } from '../utils/finance';
import { loanService, clientService, settingsService, Loan, Client } from '../services/api';

const Dashboard = () => {
  const navigate = useNavigate();
  
  // --- ESTADOS DE FILTRO ---
  const [period, setPeriod] = useState<'hoje' | 'semana' | 'mes' | 'proximo_mes' | 'personalizado' | 'todos'>('todos');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [loading, setLoading] = useState(false);
  const [selectedRange, setSelectedRange] = useState<'low' | 'mid' | 'high' | 'capital' | 'profit' | 'overdue' | 'active' | null>(null);
  const [allLoans, setAllLoans] = useState<Loan[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  
  const [filteredLoansContext, setFilteredLoansContext] = useState<Loan[]>([]);

  // --- ESTADOS DO MODAL VENCIMENTOS ---
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  
  const [maturityDate, setMaturityDate] = useState(() => {
      const d = new Date();
      const offset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - offset).toISOString().split('T')[0];
  });

  const [metrics, setMetrics] = useState({
    capitalNaRua: 0,
    lucroProjetado: 0,
    atrasoGeral: 0,
    contratosAtivos: 0,
    totalClientesCadastrados: 0,
    clientesComDivida: 0,
    taxas: { lowVal: 0, lowCount: 0, midVal: 0, midCount: 0, highVal: 0, highCount: 0 }
  });

  const [recentActivities, setRecentActivities] = useState<any[]>([]);

  const parseLocalDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    const cleanStr = dateStr.split('T')[0];
    const [year, month, day] = cleanStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  // NOVA FUNÇÃO: Calcula apenas o Lucro que AINDA FALTA receber
  const calculateRemainingProfit = (loan: Loan) => {
      let totalExpectedInterest = loan.projectedProfit || 0;
      
      if (!totalExpectedInterest) {
          const amount = Number(loan.amount) || 0;
          const installments = Number(loan.installments) || 0;
          const installmentValue = Number(loan.installmentValue) || 0;
          
          if (loan.interestType === 'SIMPLE') {
              totalExpectedInterest = installmentValue * (installments || 1);
          } else {
              totalExpectedInterest = Math.max(0, (installmentValue * installments) - amount);
          }
      }
      
      const paidInterest = Number(loan.totalPaidInterest) || 0;
      return Math.max(0, totalExpectedInterest - paidInterest);
  };

  const fetchAndCalculate = async () => {
    setLoading(true);
    try {
      const [loans, clients, settings] = await Promise.all([
          loanService.getAll(),
          clientService.getAll(),
          settingsService.get()
      ]);
      
      setAllLoans(loans); 
      setAllClients(clients);
      
      const today = new Date();
      today.setHours(0,0,0,0);

      const todayStr = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
      
      const dueToday = loans.filter(l => {
          if (l.status === 'Pago') return false;
          return l.nextDue.split('T')[0] === todayStr;
      });

      const hasSeenModal = sessionStorage.getItem('welcomeModalSeen');
      
      if (dueToday.length > 0 && !hasSeenModal) {
          setMaturityDate(todayStr);
          setShowWelcomeModal(true);
          sessionStorage.setItem('welcomeModalSeen', 'true');
      }

      const activeDebtors = new Set(loans.filter(l => l.status !== 'Pago').map(l => l.client));

      // 1. FILTRAGEM PRINCIPAL
      const filteredLoans = loans.filter((loan: any) => {
        if (period === 'personalizado') {
            if (!customStart || !customEnd) return true; 
            const start = parseLocalDate(customStart);
            const end = parseLocalDate(customEnd);
            end.setHours(23, 59, 59, 999); 
            const loanDue = parseLocalDate(loan.nextDue);
            loanDue.setHours(0,0,0,0);
            return loanDue >= start && loanDue <= end;
        }
        if (period === 'todos') return true;
        
        const loanDue = parseLocalDate(loan.nextDue);
        loanDue.setHours(0,0,0,0);

        if (period === 'hoje') return loanDue.getTime() === today.getTime(); 
        if (period === 'semana') {
          const weekEnd = new Date(today);
          weekEnd.setDate(today.getDate() + 7);
          return loanDue >= today && loanDue <= weekEnd;
        }
        if (period === 'mes') {
          const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
          const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          return loanDue >= monthStart && loanDue <= monthEnd;
        }
        if (period === 'proximo_mes') {
            const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);
            return loanDue >= nextMonthStart && loanDue <= nextMonthEnd;
        }
        return true;
      });

      setFilteredLoansContext(filteredLoans);

      let capitalTotal = 0;
      let lucroTotal = 0;
      let atrasoTotal = 0;
      let rLowVal = 0, rLowCount = 0, rMidVal = 0, rMidCount = 0, rHighVal = 0, rHighCount = 0;

      filteredLoans.forEach((loan: any) => {
        const status = loan.status ? loan.status.toLowerCase() : '';
        const installmentValue = Number(loan.installmentValue) || 0;
        
        // PONTO 1 e 2 DO CLÓVIS: Lemos o Saldo Devedor real e o Lucro Restante real
        const capBalance = calculateCapitalBalance(loan);
        const remProfit = calculateRemainingProfit(loan);

        // Se o contrato ainda tem saldo devedor, ele entra nas métricas principais
        if (status !== 'pago' && capBalance > 0) {
            capitalTotal += capBalance;
            lucroTotal += remProfit;
        }

        const dueDate = parseLocalDate(loan.nextDue);
        dueDate.setHours(0,0,0,0);

        if ((status === 'atrasado' || (dueDate < today && status !== 'acordo')) && status !== 'pago') {
             const valorComMulta = calculateOverdueValue(installmentValue, loan.nextDue, 'Atrasado', loan.fineRate ?? 2, loan.moraInterestRate ?? 1, loan.amount);
             atrasoTotal += valorComMulta;
        }

        // PONTO 1: Gráfico de Taxas agora soma o SALDO DEVEDOR (capBalance) e não mais o montante inicial
        if (status !== 'pago' && capBalance > 0) {
            if (loan.interestRate < 10) { rLowCount++; rLowVal += capBalance; } 
            else if (loan.interestRate <= 15) { rMidCount++; rMidVal += capBalance; } 
            else { rHighCount++; rHighVal += capBalance; }
        }
      });

      setMetrics({
        capitalNaRua: capitalTotal,
        lucroProjetado: lucroTotal,
        atrasoGeral: atrasoTotal,
        contratosAtivos: filteredLoans.filter((l: any) => l.status !== 'Pago').length,
        totalClientesCadastrados: clients.length,
        clientesComDivida: activeDebtors.size,
        taxas: { lowVal: rLowVal, lowCount: rLowCount, midVal: rMidVal, midCount: rMidCount, highVal: rHighVal, highCount: rHighCount }
      });

      const activities = [...filteredLoans].reverse().slice(0, 5).map((loan: any) => {
        const dueDate = parseLocalDate(loan.nextDue);
        dueDate.setHours(0,0,0,0);
        const isOverdue = dueDate < today && loan.status !== 'Pago';
        return {
          id: loan.id,
          type: isOverdue ? 'atraso' : 'novo_contrato',
          text: isOverdue ? `Atraso: ${loan.client}` : `Vencimento: ${loan.client}`,
          time: dueDate.toLocaleDateString('pt-BR'), 
          value: isOverdue ? 'Cobrar' : `R$ ${formatMoney(loan.installmentValue)}`
        };
      });
      setRecentActivities(activities);

    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  useEffect(() => { 
      if (period !== 'personalizado') fetchAndCalculate();
  }, [period]);

  const handleCustomFilter = () => {
      setPeriod('personalizado');
      fetchAndCalculate();
  }

  const loansOnMaturityDate = useMemo(() => {
      if (!maturityDate) return [];
      return allLoans.filter(l => {
          if (l.status === 'Pago') return false;
          const loanDateStr = l.nextDue.split('T')[0];
          return loanDateStr === maturityDate;
      });
  }, [allLoans, maturityDate]);

  const detailedLoans = useMemo(() => {
      if (!selectedRange) return [];
      const today = new Date();
      today.setHours(0,0,0,0);

      return filteredLoansContext.filter(l => {
          if (selectedRange === 'overdue') {
              const dueDate = parseLocalDate(l.nextDue);
              dueDate.setHours(0,0,0,0);
              return l.status !== 'Pago' && dueDate < today;
          }
          if (selectedRange === 'active') return l.status !== 'Pago';
          if (l.status === 'Pago') return false; 
          if (selectedRange === 'capital' || selectedRange === 'profit') return true; 
          if (selectedRange === 'low') return l.interestRate < 10;
          if (selectedRange === 'mid') return l.interestRate >= 10 && l.interestRate <= 15;
          if (selectedRange === 'high') return l.interestRate > 15;
          return false;
      });
  }, [filteredLoansContext, selectedRange]);

  const rangeTitles = {
      low: 'Capital em Taxa Baixa (< 10%)', mid: 'Capital em Taxa Média (10% - 15%)', high: 'Capital em Taxa Alta (> 15%)',
      capital: 'Previsão de Fluxo / Capital', profit: 'Detalhamento de Lucro', overdue: 'Contratos em Atraso (Crítico)', active: 'Carteira de Clientes Ativos'
  };

  const goToBillingWithSearch = (clientName: string) => {
       sessionStorage.setItem('searchClient', clientName);
       navigate('/billing');
  }

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
                  <div><h2 className="text-2xl font-bold text-slate-800">{rangeTitles[selectedRange]}</h2><p className="text-slate-500">{selectedRange === 'overdue' ? 'Lista de inadimplência.' : 'Detalhamento dos valores no período filtrado.'}</p></div>
              </header>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  <table className="w-full text-left">
                      <thead>
                          <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                              <th className="p-4">Cliente</th>
                              <th className="p-4 text-center">Vencimento</th>
                              <th className="p-4 text-center">Taxa (%)</th>
                              {/* Alteramos o cabeçalho para deixar claro do que se trata */}
                              <th className="p-4 text-right">Saldo Capital</th>
                              <th className="p-4 text-right text-green-600">Lucro Restante</th>
                              {selectedRange === 'overdue' && <th className="p-4 text-right text-red-600">Total com Multa</th>}
                              <th className="p-4 text-center">Status</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                          {detailedLoans.map(loan => {
                              const capBalance = calculateCapitalBalance(loan);
                              const remProfit = calculateRemainingProfit(loan);
                              const overdueVal = calculateOverdueValue(loan.installmentValue, loan.nextDue, 'Atrasado', loan.fineRate ?? 2, loan.moraInterestRate ?? 1, loan.amount);
                              
                              return (
                                  <tr key={loan.id} className="hover:bg-blue-50 transition-colors cursor-pointer" onClick={() => goToBillingWithSearch(loan.client)}>
                                      <td className="p-4 font-bold text-slate-800">
                                          {loan.client}
                                          <div className="text-[10px] font-mono text-slate-400 font-normal">{loan.id}</div>
                                      </td>
                                      <td className="p-4 text-center text-sm font-medium">{new Date(loan.nextDue).toLocaleDateString('pt-BR')}</td>
                                      <td className="p-4 text-center font-bold text-slate-600">{loan.interestRate}%</td>
                                      
                                      {/* Mostra o Saldo devedor e o Lucro Restante em vez do inicial */}
                                      <td className="p-4 text-right font-bold text-slate-700">R$ {formatMoney(capBalance)}</td>
                                      <td className="p-4 text-right font-bold text-green-600">R$ {formatMoney(remProfit)}</td>
                                      
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
              </div>
          </div>
      ) : (
          <>
            <header className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-8 gap-4">
                <div><h2 className="text-2xl font-bold text-slate-800">Dashboard</h2><p className="text-slate-500">Visão geral e projeções.</p></div>
                <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center w-full xl:w-auto">
                    <button onClick={fetchAndCalculate} className="p-2.5 bg-white border border-gray-200 rounded-xl text-slate-500 hover:text-slate-900 transition-colors shadow-sm"><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button>
                    <div className="relative">
                        <select value={period === 'personalizado' ? 'personalizado' : period} onChange={(e) => setPeriod(e.target.value as any)} className="appearance-none bg-white pl-4 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm font-bold text-slate-700 shadow-sm outline-none focus:ring-2 focus:ring-slate-900/10 cursor-pointer">
                            <option value="todos">Todos os Períodos</option><option value="hoje">Vencendo Hoje</option><option value="semana">Esta Semana</option><option value="mes">Este Mês</option><option value="proximo_mes">Próximo Mês</option><option value="personalizado">Datas Personalizadas</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16}/>
                    </div>
                    {(period === 'personalizado' || (customStart && customEnd)) && (
                        <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm animate-in fade-in slide-in-from-left-2">
                            <div className="flex items-center gap-2 px-2"><input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="text-xs font-bold text-slate-600 bg-transparent outline-none w-28 border border-slate-100 rounded p-1"/><span className="text-slate-300">até</span><input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="text-xs font-bold text-slate-600 bg-transparent outline-none w-28 border border-slate-100 rounded p-1"/></div>
                            <button onClick={handleCustomFilter} className="p-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-all" title="Aplicar"><Filter size={14}/></button>
                        </div>
                    )}
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div onClick={() => setSelectedRange('capital')} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-4"><div className="p-3 bg-blue-50 text-blue-600 rounded-lg"><Briefcase size={24} /></div></div>
                    {/* Tooltip para o Clóvis entender que é Saldo Devedor */}
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1" title="Soma do Saldo Devedor de Capital (Descontadas as amortizações)">Capital na Rua (Saldo)</h3>
                    <p className="text-2xl font-black text-slate-800">{formatMoney(metrics.capitalNaRua)}</p>
                </div>
                <div onClick={() => setSelectedRange('profit')} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-green-300 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-4"><div className="p-3 bg-green-50 text-green-600 rounded-lg"><TrendingUp size={24} /></div></div>
                    {/* Tooltip para o Lucro */}
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1" title="Juros que ainda faltam receber">Lucro a Receber</h3>
                    <p className="text-2xl font-black text-green-600">+{formatMoney(metrics.lucroProjetado)}</p>
                </div>
                <div onClick={() => setSelectedRange('overdue')} className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-red-500 hover:shadow-md hover:bg-red-50/10 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-2"><div className="p-3 bg-red-50 text-red-600 rounded-lg"><AlertTriangle size={24} /></div></div><h3 className="text-slate-500 text-xs font-bold uppercase mb-1">Total em Atraso</h3><p className="text-2xl font-black text-slate-800 mb-3">{formatMoney(metrics.atrasoGeral)}</p>
                </div>
                <div onClick={() => setSelectedRange('active')} className="bg-slate-900 p-6 rounded-xl shadow-lg text-white relative overflow-hidden cursor-pointer hover:bg-slate-800 transition-all">
                    <div className="absolute right-0 top-0 opacity-10 p-2"><FileText size={64} /></div><h3 className="text-slate-300 text-xs font-bold uppercase mb-1">Contratos no Filtro</h3><p className="text-3xl font-black text-white">{metrics.contratosAtivos}</p><p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1"><Users size={12}/> {metrics.totalClientesCadastrados} clientes cadastrados</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <div className="flex items-center gap-2 mb-4"><PieChart className="text-slate-400" size={20}/><h3 className="font-bold text-lg text-slate-800">Distribuição de Capital por Taxa</h3></div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div onClick={() => setSelectedRange('low')} className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center cursor-pointer hover:bg-slate-100 transition-colors group"><p className="text-xs font-bold text-slate-500 uppercase mb-1 group-hover:text-blue-600 transition-colors">1% a 9% (Baixa)</p><p className="text-2xl font-black text-slate-700">R$ {formatMoney(metrics.taxas.lowVal)}</p></div>
                            <div onClick={() => setSelectedRange('mid')} className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-center cursor-pointer hover:bg-blue-100 transition-colors group"><p className="text-xs font-bold text-blue-500 uppercase mb-1 group-hover:text-blue-700 transition-colors">10% a 15% (Média)</p><p className="text-2xl font-black text-blue-700">R$ {formatMoney(metrics.taxas.midVal)}</p></div>
                            <div onClick={() => setSelectedRange('high')} className="p-4 bg-indigo-50 rounded-lg border border-indigo-100 text-center cursor-pointer hover:bg-indigo-100 transition-colors group"><p className="text-xs font-bold text-indigo-500 uppercase mb-1 group-hover:text-indigo-700 transition-colors">Acima de 15% (Alta)</p><p className="text-2xl font-black text-indigo-700">R$ {formatMoney(metrics.taxas.highVal)}</p></div>
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
                    <div className="flex justify-between items-center mb-6"><h3 className="font-bold text-lg text-slate-800">Atividade Recente</h3><button onClick={() => navigate('/history')} className="text-blue-600 text-xs font-medium hover:underline flex items-center gap-1">Ver tudo <ArrowRight size={12} /></button></div>
                    <div className="space-y-6">
                        {recentActivities.length > 0 ? (recentActivities.map((activity) => (<div key={activity.id} className="flex gap-4 items-start"><div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${activity.type === 'atraso' ? 'bg-red-500' : 'bg-green-500'}`} /><div><p className="text-sm font-medium text-slate-800 leading-tight">{activity.text}</p><p className="text-xs text-slate-400 mt-1">{activity.time}</p></div>{activity.value !== '-' && (<span className={`ml-auto text-xs font-bold whitespace-nowrap ${activity.type === 'atraso' ? 'text-red-600 bg-red-50 px-2 py-1 rounded' : 'text-slate-600'}`}>{activity.value}</span>)}</div>))) : (<div className="text-center py-8 text-slate-400 text-sm"><Activity size={24} className="mx-auto mb-2 opacity-50"/>Nenhuma atividade.</div>)}
                    </div>
                </div>
            </div>
          </>
      )}
    </Layout>
  );
};

export default Dashboard;