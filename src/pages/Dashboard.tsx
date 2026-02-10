import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, DollarSign, AlertTriangle, TrendingUp, Plus, 
  Search, FileText, ArrowRight, Calendar, Activity, 
  Briefcase, PieChart, Wallet, RefreshCw, ArrowLeft, Clock
} from 'lucide-react';
import Layout from '../components/Layout';
import { calculateOverdueValue, formatMoney } from '../utils/finance';
import { loanService, Loan } from '../services/api';

const Dashboard = () => {
  const navigate = useNavigate();
  // ADICIONADO 'proximo_mes' E 'personalizado' AOS PERÍODOS
  const [period, setPeriod] = useState<'hoje' | 'semana' | 'mes' | 'proximo_mes' | 'personalizado' | 'todos'>('todos');
  const [customMonth, setCustomMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [loading, setLoading] = useState(false);
  
  const [selectedRange, setSelectedRange] = useState<'low' | 'mid' | 'high' | 'capital' | 'profit' | 'overdue' | null>(null);
  const [allLoans, setAllLoans] = useState<Loan[]>([]);

  const [metrics, setMetrics] = useState({
    capitalNaRua: 0,
    lucroProjetado: 0,
    atrasoGeral: 0,
    atrasoCapital: 0,
    atrasoJuros: 0,
    contratosAtivos: 0,
    novosClientes: 0,
    taxas: { 
        lowVal: 0, lowCount: 0,
        midVal: 0, midCount: 0,
        highVal: 0, highCount: 0 
    }
  });

  const [recentActivities, setRecentActivities] = useState<any[]>([]);

  const parseLocalDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  const fetchAndCalculate = async () => {
    setLoading(true);
    try {
      const loans = await loanService.getAll();
      setAllLoans(loans); 
      
      const today = new Date();
      today.setHours(0,0,0,0);

      // 1. FILTRAGEM POR PERÍODO (INCLUINDO FUTURO)
      const filteredLoans = loans.filter((loan: any) => {
        if (period === 'todos') return true;
        
        // Data base para filtro: Se for atrasado, usa vencimento. Se for novo, usa inicio.
        // Para projeção futura, usamos SEMPRE o vencimento (nextDue)
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

        // --- PROJEÇÃO FUTURA (PRÓXIMO MÊS) ---
        if (period === 'proximo_mes') {
            const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);
            return loanDue >= nextMonthStart && loanDue <= nextMonthEnd && loan.status !== 'Pago';
        }

        // --- PROJEÇÃO PERSONALIZADA ---
        if (period === 'personalizado') {
            const [y, m] = customMonth.split('-').map(Number);
            const pStart = new Date(y, m - 1, 1);
            const pEnd = new Date(y, m, 0);
            return loanDue >= pStart && loanDue <= pEnd && loan.status !== 'Pago';
        }

        return true;
      });

      // Variáveis acumuladoras
      let capitalTotal = 0;
      let lucroTotal = 0;
      let atrasoTotal = 0;
      let atrasoCap = 0;
      let atrasoJur = 0;
      
      let rLowVal = 0, rLowCount = 0;
      let rMidVal = 0, rMidCount = 0;
      let rHighVal = 0, rHighCount = 0;

      // Loop Filtrado
      filteredLoans.forEach((loan: any) => {
        const status = loan.status ? loan.status.toLowerCase() : '';
        const amount = Number(loan.amount) || 0;
        const installmentValue = Number(loan.installmentValue) || 0;
        const installments = Number(loan.installments) || 0;
        const totalReceivable = installmentValue * installments;
        const profit = Math.max(0, totalReceivable - amount);

        // Se for projeção futura, somamos o valor da parcela como "recebível"
        if (period === 'proximo_mes' || period === 'personalizado') {
             // Em projeção, "Capital" vira "Recebível"
             capitalTotal += installmentValue; 
             // Lucro proporcional da parcela
             const profitPart = profit / (installments || 1);
             lucroTotal += profitPart;
        } else {
             // Modo Padrão (Histórico/Atual)
             if (status !== 'pago') {
                 capitalTotal += amount;
                 lucroTotal += profit;
             }
        }

        const dueDate = parseLocalDate(loan.nextDue);
        dueDate.setHours(0,0,0,0);

        if ((status === 'atrasado' || dueDate < today) && status !== 'pago') {
             const valorComMulta = calculateOverdueValue(installmentValue, loan.nextDue, 'Atrasado', loan.fineRate || 2, loan.moraInterestRate || 1);
             atrasoTotal += valorComMulta;
             
             const totalOriginalEstimado = installmentValue * (installments || 1);
             const ratioCapital = totalOriginalEstimado > 0 ? amount / totalOriginalEstimado : 1;
             const parteCapital = valorComMulta * ratioCapital;
             
             atrasoCap += parteCapital;
             atrasoJur += (valorComMulta - parteCapital);
        }
      });

      // Loop Geral para Taxas (Capital Alocado)
      loans.forEach((loan: Loan) => {
          if(loan.status !== 'Pago') {
              const capital = Number(loan.amount) || 0;
              if (loan.interestRate < 10) {
                  rLowCount++;
                  rLowVal += capital;
              } else if (loan.interestRate <= 15) {
                  rMidCount++;
                  rMidVal += capital;
              } else {
                  rHighCount++;
                  rHighVal += capital;
              }
          }
      });

      setMetrics({
        capitalNaRua: capitalTotal,
        lucroProjetado: lucroTotal,
        atrasoGeral: atrasoTotal,
        atrasoCapital: atrasoCap,
        atrasoJuros: atrasoJur,
        contratosAtivos: filteredLoans.filter((l: any) => l.status !== 'Pago').length,
        novosClientes: filteredLoans.length,
        taxas: {
          lowVal: rLowVal, lowCount: rLowCount,
          midVal: rMidVal, midCount: rMidCount,
          highVal: rHighVal, highCount: rHighCount
        }
      });

      const activities = [...filteredLoans].reverse().slice(0, 5).map((loan: any) => {
        const dueDate = parseLocalDate(loan.nextDue);
        dueDate.setHours(0,0,0,0);
        const isOverdue = dueDate < today && loan.status !== 'Pago';
        
        let type = isOverdue ? 'atraso' : 'novo_contrato';
        let text = isOverdue ? `Atraso: ${loan.client}` : `Novo: ${loan.client}`;
        let value = isOverdue ? 'Cobrar' : `+ ${formatMoney(loan.amount)}`;

        // Ajuste para Projeção Futura
        if (period === 'proximo_mes' || period === 'personalizado') {
            type = 'novo_contrato'; // Verde
            text = `Vence em: ${dueDate.toLocaleDateString('pt-BR')} - ${loan.client}`;
            value = `Receber: ${formatMoney(loan.installmentValue)}`;
        }

        return {
          id: loan.id,
          type,
          text,
          time: period === 'proximo_mes' || period === 'personalizado' ? 'Futuro' : parseLocalDate(loan.startDate).toLocaleDateString('pt-BR'), 
          value
        };
      });
      setRecentActivities(activities);

    } catch (error) { console.error(error); } finally { setLoading(false); }
  };

  useEffect(() => { fetchAndCalculate(); }, [period, customMonth]);

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
      capital: period === 'proximo_mes' || period === 'personalizado' ? 'Previsão de Recebimento' : 'Detalhamento de Capital',
      profit: 'Detalhamento de Lucro Projetado',
      overdue: 'Contratos em Atraso (Crítico)'
  };

  return (
    <Layout>
      {selectedRange ? (
          <div className="animate-in slide-in-from-right-10 duration-300">
              <header className="mb-6 flex items-center gap-4">
                  <button onClick={() => setSelectedRange(null)} className="p-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"><ArrowLeft size={20}/></button>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-800">{rangeTitles[selectedRange]}</h2>
                    <p className="text-slate-500">
                        {selectedRange === 'overdue' ? 'Lista de inadimplência.' : 'Detalhamento dos valores.'}
                    </p>
                  </div>
              </header>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  <table className="w-full text-left">
                      <thead>
                          <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                              <th className="p-4">Cliente</th>
                              {selectedRange === 'overdue' ? (
                                  <>
                                    <th className="p-4 text-center">Vencimento</th>
                                    <th className="p-4 text-right text-red-600">Total Devido</th>
                                  </>
                              ) : (
                                  <>
                                    <th className="p-4 text-center">Início</th>
                                    <th className="p-4 text-right">Capital</th>
                                    <th className="p-4 text-right text-green-700">Lucro</th>
                                  </>
                              )}
                              <th className="p-4 text-center">Taxa</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                          {detailedLoans.length === 0 ? (<tr><td colSpan={5} className="p-8 text-center text-slate-400">Nenhum contrato encontrado.</td></tr>) : (
                              detailedLoans.map(loan => {
                                  const amount = Number(loan.amount) || 0;
                                  const totalVal = (Number(loan.installmentValue) || 0) * (Number(loan.installments) || 0);
                                  const profit = totalVal - amount;
                                  let overdueValue = 0;
                                  if (selectedRange === 'overdue') {
                                      overdueValue = calculateOverdueValue(loan.installmentValue, loan.nextDue, 'Atrasado', loan.fineRate || 2, loan.moraInterestRate || 1);
                                  }
                                  return (
                                      <tr key={loan.id} className="hover:bg-slate-50/50 transition-colors">
                                          <td className="p-4"><div className="font-bold text-slate-800">{loan.client}</div></td>
                                          {selectedRange === 'overdue' ? (
                                              <>
                                                <td className="p-4 text-center text-sm font-bold text-red-500">{new Date(loan.nextDue).toLocaleDateString('pt-BR')}</td>
                                                <td className="p-4 text-right font-black text-red-600 text-lg">R$ {formatMoney(overdueValue)}</td>
                                              </>
                                          ) : (
                                              <>
                                                <td className="p-4 text-center text-sm text-slate-500">{new Date(loan.startDate).toLocaleDateString('pt-BR')}</td>
                                                <td className={`p-4 text-right font-bold text-slate-800`}>R$ {formatMoney(amount)}</td>
                                                <td className={`p-4 text-right font-bold text-green-700`}>R$ {formatMoney(profit)}</td>
                                              </>
                                          )}
                                          <td className="p-4 text-center"><span className="bg-slate-100 px-2 py-1 rounded text-xs font-bold">{loan.interestRate}%</span></td>
                                      </tr>
                                  );
                              })
                          )}
                      </tbody>
                  </table>
              </div>
          </div>
      ) : (
          <>
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <div><h2 className="text-2xl font-bold text-slate-800">Dashboard Geral</h2><p className="text-slate-500">Visão completa da operação.</p></div>
                <div className="flex gap-2 items-center flex-wrap">
                    <button onClick={fetchAndCalculate} className="p-2 bg-white border border-gray-200 rounded-lg text-slate-500 hover:text-slate-900 transition-colors"><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button>
                    <div className="flex bg-white p-1 rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
                        <button onClick={() => setPeriod('hoje')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${period === 'hoje' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-gray-50'}`}>Hoje</button>
                        <button onClick={() => setPeriod('mes')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${period === 'mes' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-gray-50'}`}>Este Mês</button>
                        <button onClick={() => setPeriod('proximo_mes')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${period === 'proximo_mes' ? 'bg-blue-600 text-white' : 'text-blue-600 hover:bg-blue-50'}`}>Próximo Mês</button>
                        <button onClick={() => setPeriod('todos')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${period === 'todos' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-gray-50'}`}>Total</button>
                    </div>
                    
                    {/* SELETOR DE MÊS PERSONALIZADO */}
                    <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
                        <input 
                            type="month" 
                            value={customMonth} 
                            onChange={(e) => { setCustomMonth(e.target.value); setPeriod('personalizado'); }}
                            className="text-sm font-bold text-slate-700 bg-transparent outline-none px-2 cursor-pointer"
                        />
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div onClick={() => setSelectedRange('capital')} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-blue-300 transition-all relative overflow-hidden cursor-pointer group">
                    <div className="absolute right-0 top-0 opacity-5 p-2"><Briefcase size={64} /></div>
                    <div className="flex justify-between items-start mb-4"><div className="p-3 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-600 group-hover:text-white transition-colors"><Briefcase size={24} /></div><span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full">Principal</span></div>
                    
                    {/* TÍTULO DINÂMICO BASEADO NO PERÍODO */}
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">
                        {period === 'proximo_mes' || period === 'personalizado' ? 'Previsão de Recebimento' : 'Capital na Rua / Emprestado'}
                    </h3>
                    
                    <p className="text-2xl font-black text-slate-800">{formatMoney(metrics.capitalNaRua)}</p>
                </div>

                <div onClick={() => setSelectedRange('profit')} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-green-300 transition-all relative overflow-hidden cursor-pointer group">
                    <div className="absolute right-0 top-0 opacity-5 p-2"><TrendingUp size={64} /></div>
                    <div className="flex justify-between items-start mb-4"><div className="p-3 bg-green-50 text-green-600 rounded-lg group-hover:bg-green-600 group-hover:text-white transition-colors"><TrendingUp size={24} /></div><span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full">Juros</span></div>
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">Lucro Projetado</h3>
                    <p className="text-2xl font-black text-green-600">+{formatMoney(metrics.lucroProjetado)}</p>
                </div>

                <div onClick={() => setSelectedRange('overdue')} className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-red-500 hover:shadow-md hover:bg-red-50/10 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-2"><div className="p-3 bg-red-50 text-red-600 rounded-lg group-hover:bg-red-600 group-hover:text-white transition-colors"><AlertTriangle size={24} /></div><span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-full">Cobrar</span></div>
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">Total em Atraso</h3>
                    <p className="text-2xl font-black text-slate-800 mb-3">{formatMoney(metrics.atrasoGeral)}</p>
                </div>

                <div className="bg-slate-900 p-6 rounded-xl shadow-lg text-white relative overflow-hidden">
                    <div className="absolute right-0 top-0 opacity-10 p-2"><FileText size={64} /></div>
                    <h3 className="text-slate-300 text-xs font-bold uppercase mb-1">
                        {period === 'proximo_mes' || period === 'personalizado' ? 'Parcelas a Vencer' : 'Contratos Ativos'}
                    </h3>
                    <p className="text-3xl font-black text-white">{metrics.contratosAtivos}</p>
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