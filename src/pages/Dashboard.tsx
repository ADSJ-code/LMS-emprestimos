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
  const [period, setPeriod] = useState<'hoje' | 'semana' | 'mes' | 'todos'>('todos');
  const [loading, setLoading] = useState(false);
  
  // Controle do Drill-down (Expandido para todos os cards)
  const [selectedRange, setSelectedRange] = useState<'low' | 'mid' | 'high' | 'capital' | 'profit' | 'overdue' | null>(null);
  
  // Lista Completa para Filtros
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

      // 1. FILTRAGEM POR PERÍODO (Para os Cards de Fluxo)
      const filteredLoans = loans.filter((loan: any) => {
        if (period === 'todos') return true;
        const loanDate = parseLocalDate(loan.startDate);
        loanDate.setHours(0,0,0,0);

        if (period === 'hoje') return loanDate.toDateString() === today.toDateString();
        if (period === 'semana') {
          const weekAgo = new Date(today);
          weekAgo.setDate(today.getDate() - 7);
          return loanDate >= weekAgo;
        }
        if (period === 'mes') {
          const monthAgo = new Date(today);
          monthAgo.setMonth(today.getMonth() - 1);
          return loanDate >= monthAgo;
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
        const capitalRestante = (loan.amount || 0);
        const totalRestante = (loan.installmentValue || 0) * (loan.installments || 0);
        const jurosRestante = Math.max(0, totalRestante - capitalRestante);
        const status = loan.status ? loan.status.toLowerCase() : '';

        if (status !== 'pago') {
             capitalTotal += capitalRestante;
             lucroTotal += jurosRestante;
        }

        const dueDate = parseLocalDate(loan.nextDue);
        dueDate.setHours(0,0,0,0);

        if ((status === 'atrasado' || dueDate < today) && status !== 'pago') {
             const valorComMulta = calculateOverdueValue(loan.installmentValue, loan.nextDue, 'Atrasado', loan.fineRate || 2, loan.moraInterestRate || 1);
             atrasoTotal += valorComMulta;
             
             const totalOriginalEstimado = (loan.installmentValue || 0) * (loan.installments || 1);
             const ratioCapital = totalOriginalEstimado > 0 ? (loan.amount || 0) / totalOriginalEstimado : 1;
             const parteCapital = valorComMulta * ratioCapital;
             
             atrasoCap += parteCapital;
             atrasoJur += (valorComMulta - parteCapital);
        }
      });

      // Loop Geral para Taxas (Sempre total da carteira ativa)
      loans.forEach((loan: Loan) => {
          if(loan.status !== 'Pago') {
              const totalVal = loan.installmentValue * loan.installments;
              const profit = totalVal - loan.amount;
              const safeProfit = profit > 0 ? profit : 0;

              if (loan.interestRate < 10) {
                  rLowCount++;
                  rLowVal += safeProfit;
              } else if (loan.interestRate <= 15) {
                  rMidCount++;
                  rMidVal += safeProfit;
              } else {
                  rHighCount++;
                  rHighVal += safeProfit;
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

  useEffect(() => { fetchAndCalculate(); }, [period]);

  // --- FILTRO DE DETALHES ---
  const detailedLoans = useMemo(() => {
      if (!selectedRange) return [];
      
      const today = new Date();
      today.setHours(0,0,0,0);

      return allLoans.filter(l => {
          // Lógica para Atrasados
          if (selectedRange === 'overdue') {
              const dueDate = parseLocalDate(l.nextDue);
              dueDate.setHours(0,0,0,0);
              return l.status !== 'Pago' && dueDate < today;
          }

          // Para os outros, ignora Pagos
          if (l.status === 'Pago') return false; 

          if (selectedRange === 'capital' || selectedRange === 'profit') return true; // Mostra todos ativos
          if (selectedRange === 'low') return l.interestRate < 10;
          if (selectedRange === 'mid') return l.interestRate >= 10 && l.interestRate <= 15;
          if (selectedRange === 'high') return l.interestRate > 15;
          return false;
      });
  }, [allLoans, selectedRange]);

  const rangeTitles = {
      low: 'Contratos com Taxa Baixa (< 10%)',
      mid: 'Contratos com Taxa Média (10% - 15%)',
      high: 'Contratos com Taxa Alta (> 15%)',
      capital: 'Detalhamento de Capital na Rua',
      profit: 'Detalhamento de Lucro Projetado',
      overdue: 'Contratos em Atraso (Crítico)'
  };

  return (
    <Layout>
      {selectedRange ? (
          /* TELA DE DETALHES */
          <div className="animate-in slide-in-from-right-10 duration-300">
              <header className="mb-6 flex items-center gap-4">
                  <button onClick={() => setSelectedRange(null)} className="p-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"><ArrowLeft size={20}/></button>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-800">{rangeTitles[selectedRange]}</h2>
                    <p className="text-slate-500">
                        {selectedRange === 'overdue' ? 'Lista de inadimplência com valores atualizados.' : 'Detalhamento financeiro dos contratos ativos.'}
                    </p>
                  </div>
              </header>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  <table className="w-full text-left">
                      <thead>
                          <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                              <th className="p-4">Cliente / Contrato</th>
                              
                              {/* Colunas Dinâmicas */}
                              {selectedRange === 'overdue' ? (
                                  <>
                                    <th className="p-4 text-center">Vencimento</th>
                                    <th className="p-4 text-right">Valor Original</th>
                                    <th className="p-4 text-right text-red-600">Valor Atualizado (+Multa)</th>
                                  </>
                              ) : (
                                  <>
                                    <th className="p-4 text-center">Início</th>
                                    <th className="p-4 text-right">Capital (Principal)</th>
                                    <th className="p-4 text-right text-green-700">Lucro (Juros)</th>
                                  </>
                              )}
                              <th className="p-4 text-center">Taxa</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                          {detailedLoans.length === 0 ? (<tr><td colSpan={5} className="p-8 text-center text-slate-400">Nenhum contrato encontrado.</td></tr>) : (
                              detailedLoans.map(loan => {
                                  const totalVal = loan.installmentValue * loan.installments;
                                  const profit = totalVal - loan.amount;
                                  
                                  // Cálculo específico se for atrasado
                                  let overdueValue = 0;
                                  if (selectedRange === 'overdue') {
                                      overdueValue = calculateOverdueValue(loan.installmentValue, loan.nextDue, 'Atrasado', loan.fineRate || 2, loan.moraInterestRate || 1);
                                  }

                                  return (
                                      <tr key={loan.id} className="hover:bg-slate-50/50 transition-colors">
                                          <td className="p-4">
                                              <div className="font-bold text-slate-800">{loan.client}</div>
                                              <div className="text-[10px] text-slate-400 font-mono">ID: {loan.id}</div>
                                          </td>

                                          {selectedRange === 'overdue' ? (
                                              <>
                                                <td className="p-4 text-center text-sm font-bold text-red-500">
                                                    {new Date(loan.nextDue).toLocaleDateString('pt-BR')}
                                                </td>
                                                <td className="p-4 text-right text-slate-500">R$ {formatMoney(loan.installmentValue)}</td>
                                                <td className="p-4 text-right font-black text-red-600 text-lg">R$ {formatMoney(overdueValue)}</td>
                                              </>
                                          ) : (
                                              <>
                                                <td className="p-4 text-center text-sm text-slate-500">
                                                    {new Date(loan.startDate).toLocaleDateString('pt-BR')}
                                                </td>
                                                <td className={`p-4 text-right font-bold ${selectedRange === 'capital' ? 'text-blue-700 text-lg' : 'text-slate-600'}`}>
                                                    R$ {formatMoney(loan.amount)}
                                                </td>
                                                <td className={`p-4 text-right font-bold ${selectedRange === 'profit' ? 'text-green-700 text-lg' : 'text-slate-600'}`}>
                                                    R$ {formatMoney(profit)}
                                                </td>
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
          /* DASHBOARD PADRÃO */
          <>
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <div><h2 className="text-2xl font-bold text-slate-800">Dashboard Geral</h2><p className="text-slate-500">{period === 'todos' ? 'Visão completa da carteira.' : period === 'hoje' ? 'Resultados de hoje.' : period === 'semana' ? 'Últimos 7 dias.' : 'Desempenho do mês.'}</p></div>
                <div className="flex gap-2 items-center">
                    <button onClick={fetchAndCalculate} className="p-2 bg-white border border-gray-200 rounded-lg text-slate-500 hover:text-slate-900 transition-colors"><RefreshCw size={18} className={loading ? "animate-spin" : ""} /></button>
                    <div className="flex bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
                        {['hoje', 'semana', 'mes', 'todos'].map((p) => (
                            <button key={p} onClick={() => setPeriod(p as any)} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${period === p ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-gray-50'}`}>{p}</button>
                        ))}
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                {/* CARD CAPITAL - Clicável */}
                <div onClick={() => setSelectedRange('capital')} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-blue-300 transition-all relative overflow-hidden cursor-pointer group">
                    <div className="absolute right-0 top-0 opacity-5 p-2"><Briefcase size={64} /></div>
                    <div className="flex justify-between items-start mb-4"><div className="p-3 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-600 group-hover:text-white transition-colors"><Briefcase size={24} /></div><span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full">Principal</span></div>
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">{period === 'todos' ? 'Capital na Rua' : 'Emprestado no Período'}</h3>
                    <p className="text-2xl font-black text-slate-800">{formatMoney(metrics.capitalNaRua)}</p>
                    <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">Ver detalhes <ArrowRight size={10}/></p>
                </div>

                {/* CARD LUCRO - Clicável */}
                <div onClick={() => setSelectedRange('profit')} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-green-300 transition-all relative overflow-hidden cursor-pointer group">
                    <div className="absolute right-0 top-0 opacity-5 p-2"><TrendingUp size={64} /></div>
                    <div className="flex justify-between items-start mb-4"><div className="p-3 bg-green-50 text-green-600 rounded-lg group-hover:bg-green-600 group-hover:text-white transition-colors"><TrendingUp size={24} /></div><span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full">Juros</span></div>
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">Lucro Projetado</h3>
                    <p className="text-2xl font-black text-green-600">+{formatMoney(metrics.lucroProjetado)}</p>
                    <p className="text-[10px] text-slate-400 mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">Ver detalhes <ArrowRight size={10}/></p>
                </div>

                {/* CARD ATRASO - Clicável */}
                <div onClick={() => setSelectedRange('overdue')} className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-red-500 hover:shadow-md hover:bg-red-50/10 transition-all cursor-pointer group">
                    <div className="flex justify-between items-start mb-2"><div className="p-3 bg-red-50 text-red-600 rounded-lg group-hover:bg-red-600 group-hover:text-white transition-colors"><AlertTriangle size={24} /></div><span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-full">Cobrar</span></div>
                    <h3 className="text-slate-500 text-xs font-bold uppercase mb-1">Total em Atraso</h3>
                    <p className="text-2xl font-black text-slate-800 mb-3">{formatMoney(metrics.atrasoGeral)}</p>
                    <div className="pt-2 border-t border-gray-100 space-y-1">
                        <div className="flex justify-between text-[10px] uppercase text-slate-500 font-bold"><span>Risco Capital:</span><span className="text-slate-700">{formatMoney(metrics.atrasoCapital)}</span></div>
                        <div className="flex justify-between text-[10px] uppercase text-slate-500 font-bold"><span>Juros Pendentes:</span><span className="text-red-500">{formatMoney(metrics.atrasoJuros)}</span></div>
                    </div>
                </div>

                <div className="bg-slate-900 p-6 rounded-xl shadow-lg text-white relative overflow-hidden">
                    <div className="absolute right-0 top-0 opacity-10 p-2"><FileText size={64} /></div>
                    <div className="flex justify-between items-start mb-4"><div className="p-3 bg-white/10 rounded-lg text-yellow-400"><FileText size={24} /></div></div>
                    <h3 className="text-slate-300 text-xs font-bold uppercase mb-1">Contratos (Filtro)</h3>
                    <p className="text-3xl font-black text-white">{metrics.contratosAtivos}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <div className="flex items-center gap-2 mb-4"><PieChart className="text-slate-400" size={20}/><h3 className="font-bold text-lg text-slate-800">Distribuição de Juros por Taxa</h3></div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div onClick={() => setSelectedRange('low')} className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-center cursor-pointer hover:bg-slate-100 transition-colors group">
                                <p className="text-xs font-bold text-slate-500 uppercase mb-1 group-hover:text-blue-600 transition-colors">1% a 9% (Baixa)</p>
                                <p className="text-2xl font-black text-slate-700">R$ {formatMoney(metrics.taxas.lowVal)}</p>
                                <p className="text-[10px] text-slate-400">{metrics.taxas.lowCount} Contratos</p>
                            </div>
                            <div onClick={() => setSelectedRange('mid')} className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-center cursor-pointer hover:bg-blue-100 transition-colors group">
                                <p className="text-xs font-bold text-blue-500 uppercase mb-1 group-hover:text-blue-700 transition-colors">10% a 15% (Média)</p>
                                <p className="text-2xl font-black text-blue-700">R$ {formatMoney(metrics.taxas.midVal)}</p>
                                <p className="text-[10px] text-blue-400">{metrics.taxas.midCount} Contratos</p>
                            </div>
                            <div onClick={() => setSelectedRange('high')} className="p-4 bg-indigo-50 rounded-lg border border-indigo-100 text-center cursor-pointer hover:bg-indigo-100 transition-colors group">
                                <p className="text-xs font-bold text-indigo-500 uppercase mb-1 group-hover:text-indigo-700 transition-colors">Acima de 15% (Alta)</p>
                                <p className="text-2xl font-black text-indigo-700">R$ {formatMoney(metrics.taxas.highVal)}</p>
                                <p className="text-[10px] text-indigo-400">{metrics.taxas.highCount} Contratos</p>
                            </div>
                        </div>
                    </div>

                    {/* ACESSO RÁPIDO OTIMIZADO */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <h3 className="font-bold text-lg text-slate-800 mb-4">Acesso Rápido</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <button onClick={() => navigate('/billing')} className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-blue-500 hover:bg-blue-50 transition-all group"><div className="p-3 bg-blue-100 text-blue-600 rounded-full mb-2 group-hover:scale-110 transition-transform"><Plus size={20} /></div><span className="text-sm font-medium text-slate-700">Novo Empréstimo</span></button>
                            
                            <button onClick={() => navigate('/clients')} className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-purple-500 hover:bg-purple-50 transition-all group"><div className="p-3 bg-purple-100 text-purple-600 rounded-full mb-2 group-hover:scale-110 transition-transform"><Users size={20} /></div><span className="text-sm font-medium text-slate-700">Novo Cliente</span></button>
                            
                            {/* ALTERADO: DE CONSULTAR CPF PARA HISTÓRICO */}
                            <button onClick={() => navigate('/history')} className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-green-500 hover:bg-green-50 transition-all group"><div className="p-3 bg-green-100 text-green-600 rounded-full mb-2 group-hover:scale-110 transition-transform"><Clock size={20} /></div><span className="text-sm font-medium text-slate-700">Histórico Completo</span></button>
                            
                            <button onClick={() => navigate('/overdue')} className="flex flex-col items-center justify-center p-4 rounded-lg border border-gray-200 hover:border-yellow-500 hover:bg-yellow-50 transition-all group"><div className="p-3 bg-yellow-100 text-yellow-600 rounded-full mb-2 group-hover:scale-110 transition-transform"><FileText size={20} /></div><span className="text-sm font-medium text-slate-700">Relatórios</span></button>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit">
                    <div className="flex justify-between items-center mb-6"><h3 className="font-bold text-lg text-slate-800">Atividade (Filtro)</h3><button onClick={() => navigate('/history')} className="text-blue-600 text-xs font-medium hover:underline flex items-center gap-1">Ver tudo <ArrowRight size={12} /></button></div>
                    <div className="space-y-6">
                        {recentActivities.length > 0 ? (recentActivities.map((activity) => (<div key={activity.id} className="flex gap-4 items-start"><div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${activity.type === 'atraso' ? 'bg-red-500' : 'bg-green-500'}`} /><div><p className="text-sm font-medium text-slate-800 leading-tight">{activity.text}</p><p className="text-xs text-slate-400 mt-1">{activity.time}</p></div>{activity.value !== '-' && (<span className={`ml-auto text-xs font-bold whitespace-nowrap ${activity.type === 'atraso' ? 'text-red-600 bg-red-50 px-2 py-1 rounded' : 'text-slate-600'}`}>{activity.value}</span>)}</div>))) : (<div className="text-center py-8 text-slate-400 text-sm"><Activity size={24} className="mx-auto mb-2 opacity-50"/>Nenhuma atividade neste período.</div>)}
                    </div>
                    <div className="mt-8 pt-6 border-t border-gray-100">
                        <div className="flex items-center justify-between p-4 bg-yellow-50 rounded-lg border border-yellow-100"><div className="flex items-center gap-3"><Calendar className="text-yellow-600" size={20} /><div><p className="text-sm font-bold text-yellow-900">Cobrança Diária</p><p className="text-xs text-yellow-700">Verifique os vencimentos</p></div></div><button onClick={() => navigate('/overdue')} className="bg-white text-yellow-700 px-3 py-1 rounded text-xs font-bold shadow-sm hover:bg-yellow-100">Abrir</button></div>
                    </div>
                </div>
            </div>
          </>
      )}
    </Layout>
  );
};

export default Dashboard;