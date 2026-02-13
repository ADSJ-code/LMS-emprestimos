import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, AlertTriangle, TrendingUp, Plus, 
  Search, FileText, ArrowRight, Calendar, Activity, 
  Briefcase, PieChart, RefreshCw, ArrowLeft, Filter,
  UserCheck, Bell, X, Clock
} from 'lucide-react';
import Layout from '../components/Layout';
import { calculateOverdueValue, formatMoney } from '../utils/finance';
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
  
  // Estado do Modal "Bom Dia" (NOVO)
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [dailyAlerts, setDailyAlerts] = useState<{today: Loan[], warning: Loan[]}>({ today: [], warning: [] });

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
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  const calculateLoanProfit = (loan: Loan) => {
      if (loan.projectedProfit && loan.projectedProfit > 0) return loan.projectedProfit;
      const amount = Number(loan.amount) || 0;
      const installments = Number(loan.installments) || 0;
      const installmentValue = Number(loan.installmentValue) || 0;
      if (loan.interestType === 'SIMPLE') return installmentValue * (installments || 1);
      const totalReceivable = installmentValue * installments;
      return Math.max(0, totalReceivable - amount);
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

      // --- LÓGICA DE ALERTAS DIÁRIOS (NOVO) ---
      const warningDays = (settings as any).system?.warningDays || 3;
      const dueToday: Loan[] = [];
      const dueSoon: Loan[] = [];

      loans.forEach(l => {
          if (l.status === 'Pago') return;
          const due = parseLocalDate(l.nextDue);
          due.setHours(0,0,0,0);
          
          const diffTime = due.getTime() - today.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays === 0) dueToday.push(l);
          else if (diffDays > 0 && diffDays <= warningDays) dueSoon.push(l);
      });

      setDailyAlerts({ today: dueToday, warning: dueSoon });
      
      // Só abre o modal se houver algo relevante e não tiver sido fechado na sessão
      if ((dueToday.length > 0 || dueSoon.length > 0) && !sessionStorage.getItem('welcomeModalSeen')) {
          setShowWelcomeModal(true);
          sessionStorage.setItem('welcomeModalSeen', 'true');
      }

      // --- CÁLCULO DE MÉTRICAS ---
      const activeDebtors = new Set(loans.filter(l => l.status !== 'Pago').map(l => l.client));

      const filteredLoans = loans.filter((loan: any) => {
        if (period === 'todos') return true;
        const loanStart = parseLocalDate(loan.startDate);
        const loanDue = parseLocalDate(loan.nextDue);
        loanStart.setHours(0,0,0,0);
        loanDue.setHours(0,0,0,0);

        if (period === 'hoje') return loanStart.toDateString() === today.toDateString();
        if (period === 'semana') {
          const weekAgo = new Date(today);
          weekAgo.setDate(today.getDate() - 7);
          return loanStart >= weekAgo && loanStart <= today;
        }
        if (period === 'mes') {
          const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
          const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          return loanStart >= monthStart && loanStart <= monthEnd;
        }
        if (period === 'proximo_mes') {
            const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);
            return loanDue >= nextMonthStart && loanDue <= nextMonthEnd && loan.status !== 'Pago';
        }
        if (period === 'personalizado') {
            if (!customStart || !customEnd) return true;
            const start = parseLocalDate(customStart);
            const end = parseLocalDate(customEnd);
            return loanDue >= start && loanDue <= end && loan.status !== 'Pago';
        }
        return true;
      });

      let capitalTotal = 0;
      let lucroTotal = 0;
      let atrasoTotal = 0;
      
      let rLowVal = 0, rLowCount = 0;
      let rMidVal = 0, rMidCount = 0;
      let rHighVal = 0, rHighCount = 0;

      filteredLoans.forEach((loan: any) => {
        const status = loan.status ? loan.status.toLowerCase() : '';
        const amount = Number(loan.amount) || 0;
        const installmentValue = Number(loan.installmentValue) || 0;
        const installments = Number(loan.installments) || 0;
        const profit = calculateLoanProfit(loan);
        const isProjection = period === 'proximo_mes' || period === 'personalizado';

        if (isProjection) {
             capitalTotal += installmentValue; 
             const profitPart = profit / (installments || 1);
             lucroTotal += profitPart;
        } else {
             if (status !== 'pago') {
                 capitalTotal += amount;
                 lucroTotal += profit;
             }
        }

        const dueDate = parseLocalDate(loan.nextDue);
        dueDate.setHours(0,0,0,0);

        if ((status === 'atrasado' || dueDate < today) && status !== 'pago') {
             const valorComMulta = calculateOverdueValue(installmentValue, loan.nextDue, 'Atrasado', loan.fineRate ?? 2, loan.moraInterestRate ?? 1);
             atrasoTotal += valorComMulta;
        }
      });

      loans.forEach((loan: Loan) => {
          if(loan.status !== 'Pago') {
              const capital = Number(loan.amount) || 0;
              if (loan.interestRate < 10) { rLowCount++; rLowVal += capital; } 
              else if (loan.interestRate <= 15) { rMidCount++; rMidVal += capital; } 
              else { rHighCount++; rHighVal += capital; }
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
          text: isOverdue ? `Atraso: ${loan.client}` : `Novo: ${loan.client}`,
          time: parseLocalDate(loan.startDate).toLocaleDateString('pt-BR'), 
          value: isOverdue ? 'Cobrar' : `+ ${formatMoney(loan.amount)}`
        };
      });
      setRecentActivities(activities);

    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  useEffect(() => { 
      if (period !== 'personalizado') {
          fetchAndCalculate();
      }
  }, [period]);

  const handleCustomFilter = () => {
      setPeriod('personalizado');
      fetchAndCalculate();
  }

  const detailedLoans = useMemo(() => {
      if (!selectedRange) return [];
      const today = new Date();
      today.setHours(0,0,0,0);

      return allLoans.filter(l => {
          if (selectedRange === 'overdue') {
              const dueDate = parseLocalDate(l.nextDue);
              dueDate.setHours(0,0,0,0);
              return l.status !== 'Pago' && dueDate < today;
          }
          if (selectedRange === 'active') {
              return l.status !== 'Pago';
          }
          if (l.status === 'Pago') return false; 
          if (selectedRange === 'capital' || selectedRange === 'profit') return true; 
          if (selectedRange === 'low') return l.interestRate < 10;
          if (selectedRange === 'mid') return l.interestRate >= 10 && l.interestRate <= 15;
          if (selectedRange === 'high') return l.interestRate > 15;
          return false;
      });
  }, [allLoans, selectedRange]);

  const rangeTitles = {
      low: 'Capital em Taxa Baixa (< 10%)',
      mid: 'Capital em Taxa Média (10% - 15%)',
      high: 'Capital em Taxa Alta (> 15%)',
      capital: 'Detalhamento de Capital',
      profit: 'Detalhamento de Lucro Projetado',
      overdue: 'Contratos em Atraso (Crítico)',
      active: 'Carteira de Clientes Ativos'
  };

  return (
    <Layout>
      {/* MODAL BOM DIA (NOVO) */}
      {showWelcomeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
                  <div className="bg-slate-900 p-6 flex justify-between items-center">
                      <div>
                          <h3 className="text-xl font-bold text-white flex items-center gap-2">👋 Bom dia!</h3>
                          <p className="text-slate-400 text-sm">Resumo operacional de hoje.</p>
                      </div>
                      <button onClick={() => setShowWelcomeModal(false)} className="text-white/50 hover:text-white"><X size={24}/></button>
                  </div>
                  <div className="p-6 space-y-6">
                      <div>
                          <h4 className="text-sm font-bold text-slate-500 uppercase mb-3 flex items-center gap-2"><Bell size={16}/> Vencendo Hoje</h4>
                          {dailyAlerts.today.length === 0 ? <p className="text-sm text-slate-400 italic">Nenhum vencimento para hoje.</p> : (
                              <div className="space-y-2">
                                  {dailyAlerts.today.map(l => (
                                      <div key={l.id} className="flex justify-between items-center p-3 bg-blue-50 rounded-xl border border-blue-100">
                                          <span className="font-bold text-blue-900">{l.client}</span>
                                          <span className="text-blue-700 font-bold">R$ {formatMoney(l.installmentValue)}</span>
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>
                      <div>
                          <h4 className="text-sm font-bold text-slate-500 uppercase mb-3 flex items-center gap-2"><AlertTriangle size={16}/> Próximos Vencimentos</h4>
                          {dailyAlerts.warning.length === 0 ? <p className="text-sm text-slate-400 italic">Nada no radar próximo.</p> : (
                              <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                                  {dailyAlerts.warning.map(l => (
                                      <div key={l.id} className="flex justify-between items-center p-3 bg-yellow-50 rounded-xl border border-yellow-100">
                                          <div>
                                              <span className="font-bold text-yellow-900 block">{l.client}</span>
                                              <span className="text-[10px] text-yellow-600">{new Date(l.nextDue).toLocaleDateString('pt-BR')}</span>
                                          </div>
                                          <span className="text-yellow-800 font-bold">R$ {formatMoney(l.installmentValue)}</span>
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>
                      <button onClick={() => setShowWelcomeModal(false)} className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800">Entendido</button>
                  </div>
              </div>
          </div>
      )}

      {selectedRange ? (
          <div className="animate-in slide-in-from-right-10 duration-300">
              <header className="mb-6 flex items-center gap-4">
                  <button onClick={() => setSelectedRange(null)} className="p-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"><ArrowLeft size={20}/></button>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-800">{rangeTitles[selectedRange]}</h2>
                    <p className="text-slate-500">{selectedRange === 'overdue' ? 'Lista de inadimplência.' : 'Detalhamento dos valores.'}</p>
                  </div>
              </header>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  <table className="w-full text-left">
                      <thead>
                          <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                              <th className="p-4">Cliente</th>
                              <th className="p-4 text-center">Vencimento</th>
                              <th className="p-4 text-right">Valor Base</th>
                              {selectedRange === 'overdue' && <th className="p-4 text-right text-red-600">Total com Multa</th>}
                              <th className="p-4 text-center">Status</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                          {detailedLoans.map(loan => {
                              const overdueVal = calculateOverdueValue(loan.installmentValue, loan.nextDue, 'Atrasado', loan.fineRate ?? 2, loan.moraInterestRate ?? 1);
                              return (
                                  <tr key={loan.id} className="hover:bg-slate-50/50">
                                      <td className="p-4 font-bold text-slate-800">{loan.client}</td>
                                      <td className="p-4 text-center text-sm">{new Date(loan.nextDue).toLocaleDateString('pt-BR')}</td>
                                      <td className="p-4 text-right font-bold text-slate-700">R$ {formatMoney(loan.installmentValue)}</td>
                                      {selectedRange === 'overdue' && <td className="p-4 text-right font-black text-red-600">R$ {formatMoney(overdueVal)}</td>}
                                      <td className="p-4 text-center"><span className="bg-slate-100 px-2 py-1 rounded text-xs font-bold">{loan.status}</span></td>
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
                <div><h2 className="text-2xl font-bold text-slate-800">Dashboard Geral</h2><p className="text-slate-500">Visão completa da operação.</p></div>
                <div className="flex flex-col md:flex-row gap-3 items-start md:items-center w-full xl:w-auto">
                    <button onClick={fetchAndCalculate} className="p-2.5 bg-white border border-gray-200 rounded-xl text-slate-500 hover:text-slate-900 transition-colors shadow-sm"><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button>
                    <div className="flex bg-white p-1 rounded-xl border border-gray-200 shadow-sm overflow-x-auto max-w-full">
                        {['hoje', 'semana', 'mes', 'proximo_mes', 'todos'].map(p => (
                            <button key={p} onClick={() => setPeriod(p as any)} className={`px-4 py-2 text-sm font-bold rounded-lg transition-all whitespace-nowrap ${period === p ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>{p.replace('_', ' ').toUpperCase()}</button>
                        ))}
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div onClick={() => setSelectedRange('capital')} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-4"><div className="p-3 bg-blue-50 text-blue-600 rounded-lg"><Briefcase size={24} /></div></div>
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">Capital na Rua</h3>
                    <p className="text-2xl font-black text-slate-800">{formatMoney(metrics.capitalNaRua)}</p>
                </div>
                <div onClick={() => setSelectedRange('profit')} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-green-300 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-4"><div className="p-3 bg-green-50 text-green-600 rounded-lg"><TrendingUp size={24} /></div></div>
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">Lucro Projetado</h3>
                    <p className="text-2xl font-black text-green-600">+{formatMoney(metrics.lucroProjetado)}</p>
                </div>
                <div onClick={() => setSelectedRange('overdue')} className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-red-500 hover:shadow-md hover:bg-red-50/10 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-2"><div className="p-3 bg-red-50 text-red-600 rounded-lg"><AlertTriangle size={24} /></div></div>
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">Total em Atraso</h3>
                    <p className="text-2xl font-black text-slate-800 mb-3">{formatMoney(metrics.atrasoGeral)}</p>
                </div>
                <div onClick={() => setSelectedRange('active')} className="bg-slate-900 p-6 rounded-xl shadow-lg text-white relative overflow-hidden cursor-pointer hover:bg-slate-800 transition-all">
                    <div className="absolute right-0 top-0 opacity-10 p-2"><FileText size={64} /></div>
                    <h3 className="text-slate-300 text-xs font-bold uppercase mb-1">Contratos Ativos</h3>
                    <p className="text-3xl font-black text-white">{metrics.contratosAtivos}</p>
                    <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1"><Users size={12}/> {metrics.totalClientesCadastrados} clientes cadastrados</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <div className="flex items-center gap-2 mb-4"><PieChart className="text-slate-400" size={20}/><h3 className="font-bold text-lg text-slate-800">Distribuição de Capital por Taxa</h3></div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div onClick={() => setSelectedRange('low')} className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center cursor-pointer hover:bg-slate-100 transition-colors group">
                                <p className="text-xs font-bold text-slate-500 uppercase mb-1 group-hover:text-blue-600 transition-colors">1% a 9% (Baixa)</p>
                                <p className="text-2xl font-black text-slate-700">R$ {formatMoney(metrics.taxas.lowVal)}</p>
                                <p className="text-[10px] text-slate-400">Capital Alocado</p>
                            </div>
                            <div onClick={() => setSelectedRange('mid')} className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-center cursor-pointer hover:bg-blue-100 transition-colors group">
                                <p className="text-xs font-bold text-blue-500 uppercase mb-1 group-hover:text-blue-700 transition-colors">10% a 15% (Média)</p>
                                <p className="text-2xl font-black text-blue-700">R$ {formatMoney(metrics.taxas.midVal)}</p>
                                <p className="text-[10px] text-blue-400">Capital Alocado</p>
                            </div>
                            <div onClick={() => setSelectedRange('high')} className="p-4 bg-indigo-50 rounded-lg border border-indigo-100 text-center cursor-pointer hover:bg-indigo-100 transition-colors group">
                                <p className="text-xs font-bold text-indigo-500 uppercase mb-1 group-hover:text-indigo-700 transition-colors">Acima de 15% (Alta)</p>
                                <p className="text-2xl font-black text-indigo-700">R$ {formatMoney(metrics.taxas.highVal)}</p>
                                <p className="text-[10px] text-indigo-400">Capital Alocado</p>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <h3 className="font-bold text-lg text-slate-800 mb-4">Acesso Rápido</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <button onClick={() => navigate('/billing')} className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all group"><div className="p-3 bg-blue-100 text-blue-600 rounded-full mb-2 group-hover:scale-110 transition-transform"><Plus size={20} /></div><span className="text-sm font-medium text-slate-700">Novo Empréstimo</span></button>
                            <button onClick={() => navigate('/clients')} className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-purple-500 hover:bg-purple-50 transition-all group"><div className="p-3 bg-purple-100 text-purple-600 rounded-full mb-2 group-hover:scale-110 transition-transform"><Users size={20} /></div><span className="text-sm font-medium text-slate-700">Novo Cliente</span></button>
                            <button onClick={() => navigate('/history')} className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-green-500 hover:bg-green-50 transition-all group"><div className="p-3 bg-green-100 text-green-600 rounded-full mb-2 group-hover:scale-110 transition-transform"><Clock size={20} /></div><span className="text-sm font-medium text-slate-700">Histórico Completo</span></button>
                            <button onClick={() => navigate('/overdue')} className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-yellow-500 hover:bg-yellow-50 transition-all group"><div className="p-3 bg-yellow-100 text-yellow-600 rounded-full mb-2 group-hover:scale-110 transition-transform"><FileText size={20} /></div><span className="text-sm font-medium text-slate-700">Relatórios</span></button>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit">
                    <div className="flex justify-between items-center mb-6"><h3 className="font-bold text-lg text-slate-800">Atividade</h3><button onClick={() => navigate('/history')} className="text-blue-600 text-xs font-medium hover:underline flex items-center gap-1">Ver tudo <ArrowRight size={12} /></button></div>
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