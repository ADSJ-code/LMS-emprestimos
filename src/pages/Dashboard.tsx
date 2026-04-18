import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, AlertTriangle, TrendingUp, Plus, 
  Search, FileText, ArrowRight, Calendar, Activity, 
  Briefcase, PieChart, RefreshCw, ArrowLeft, Filter,
  UserCheck, Bell, BellRing, X, Clock, CalendarDays, ChevronDown, CheckCircle
} from 'lucide-react';
import Layout from '../components/Layout';
import { calculateOverdueValue, formatMoney, calculateCapitalBalance, calculateInstallmentBreakdown } from '../utils/finance';
import { loanService, clientService, settingsService, Loan, Client } from '../services/api';

const Dashboard = () => {
  const navigate = useNavigate();
  
  // 🚀 EXTRAÇÃO DE APELIDO: Limpa o JSON e mostra apenas a observação
  const getNickname = (obs?: string) => {
      if (!obs) return '';
      return obs.replace(/\[META:.*?\]/g, '').trim();
  };
  
  // --- ESTADOS DE FILTRO E VISÃO ---
  const [period, setPeriod] = useState<'hoje' | 'semana' | 'mes' | 'proximo_mes' | 'personalizado' | 'todos'>('todos');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  
  const [viewMode, setViewMode] = useState<'saldo' | 'fluxo'>('saldo');
  const [taxasViewMode, setTaxasViewMode] = useState<'capital' | 'lucro'>('capital');

  // FILTROS LOCAIS DOS CARDS
  const [tierFilters, setTierFilters] = useState({ capital: 'all', profit: 'all', overdue: 'all' });

  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState(''); 
  const [selectedRange, setSelectedRange] = useState<'low' | 'mid' | 'high' | 'capital' | 'profit' | 'overdue' | 'active' | 'clients_contracts' | null>(null);
  const [allLoans, setAllLoans] = useState<Loan[]>([]);
  const [allClients, setAllClients] = useState<Client[]>([]);
  
  const [filteredLoansContext, setFilteredLoansContext] = useState<any[]>([]);

  // --- ESTADOS DO MODAL VENCIMENTOS ---
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [isDailyAlertOpen, setIsDailyAlertOpen] = useState(false);
  const [todaysLoans, setTodaysLoans] = useState<Loan[]>([]);  
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
  const getToday = () => {
      const now = new Date();
      const localOffset = now.getTimezoneOffset() * 60000;
      const localNow = new Date(now.getTime() - localOffset);
      const localTodayStr = localNow.toISOString().split('T')[0];
      const [ty, tm, td] = localTodayStr.split('-').map(Number);
      return new Date(ty, tm - 1, td);
  };

  // 🚀 LIMPADOR INTELIGENTE: Blindagem contra vírgulas brasileiras
  const parseVal = (v: any): number => {
      if (typeof v === 'number') return isNaN(v) ? 0 : v;
      if (!v) return 0;
      if (typeof v === 'string') return parseFloat(v.replace(/\./g, '').replace(',', '.')) || 0;
      return 0;
  };

  // --- NOVO MOTOR DE CÁLCULO C/ JUROS SIMPLES ---
  const getSyncedBreakdown = (loan: Loan | null) => {
      if (!loan) return { interest: 0, capital: 0, total: 0 };
      
      if (loan.interestType === 'SIMPLE') {
          const dueDate = new Date(loan.nextDue);
          const cycleStart = new Date(dueDate);
          cycleStart.setMonth(cycleStart.getMonth() - 1);
          cycleStart.setHours(23, 59, 59, 999);

          let capitalPaidInThisCycle = 0;
          if (loan.history) {
              loan.history.forEach(h => {
                  const hDate = new Date(h.date);
                  if (hDate > cycleStart && !h.note?.includes('[CICLO COMPLETADO]')) {
                      capitalPaidInThisCycle += parseVal(h.capitalPaid);
                  }
              });
          }

          const principalAtStartOfMonth = (parseVal(loan.amount) - parseVal(loan.totalPaidCapital)) + capitalPaidInThisCycle;
          let periodRate = parseVal(loan.interestRate) / 100;
          if (loan.frequency === 'SEMANAL') periodRate /= 4;
          else if (loan.frequency === 'DIARIO') periodRate /= 30;

          const dynamicInterest = principalAtStartOfMonth * periodRate;
          let extraAcordo = 0;
          if (loan.status === 'Acordo' && parseVal(loan.agreementValue) > 0) extraAcordo = parseVal(loan.agreementValue);
          
          return { interest: dynamicInterest + extraAcordo, capital: 0, total: dynamicInterest + extraAcordo };
          
      } else {
          const totalReceivable = parseVal(loan.amount) + parseVal(loan.projectedProfit);
          const originalInstallments = Math.max(1, Math.round(totalReceivable / parseVal(loan.installmentValue)));
          const flatInterest = parseVal(loan.projectedProfit) / originalInstallments;
          const flatCapital = parseVal(loan.installmentValue) - flatInterest;

          let extraAcordo = 0;
          if (loan.status === 'Acordo' && parseVal(loan.agreementValue) > 0) extraAcordo = parseVal(loan.agreementValue);

          return { 
              interest: Math.max(0, flatInterest) + extraAcordo, 
              capital: Math.max(0, flatCapital), 
              total: parseVal(loan.installmentValue) + extraAcordo
          };
      }
  };

  const parseLocalDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    let cleanStr = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    if (cleanStr.includes('/')) {
        const [d, m, y] = cleanStr.split('/');
        return new Date(Number(y), Number(m) - 1, Number(d));
    }
    const [year, month, day] = cleanStr.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const getLoanRealStatus = (loan: Loan) => {
      if (loan.status === 'Pago' || loan.status === 'Quitado') return 'Quitado'; 
      if (loan.status === 'Acordo') return 'Acordo';
      const balance = parseVal(loan.amount) - parseVal(loan.totalPaidCapital);
      if (balance <= 0.10) return 'Quitado'; 
      
      const today = new Date();
      today.setHours(0,0,0,0);
      const todayStr = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
      const dueStr = loan.nextDue.split('T')[0];

      const dueLocalDate = parseLocalDate(loan.nextDue);

      const validSlices = ((loan as any).multiDates || []).filter((s: any) => s && s.day && !isNaN(Number(s.day)) && Number(s.day) > 0 && parseVal(s.amount) > 0);
      const expectedInstallment = parseVal(loan.installmentValue);
      const sumSlices = validSlices.reduce((acc: number, s: any) => acc + parseVal(s.amount), 0);
      const isActuallyMultiDate = validSlices.length > 0 && Math.abs(sumSlices - expectedInstallment) <= 5.00;

      if (isActuallyMultiDate) {
          const currentMonth = dueLocalDate.getMonth();
          const currentYear = dueLocalDate.getFullYear();
          let hasLateSlice = false;

          for (const slice of validSlices) {
              const sliceDate = new Date(currentYear, currentMonth, Number(slice.day));
              if (sliceDate < today) {
                  const baseAmount = parseVal(slice.amount);
                  const slicePaidAmount = (loan.history || []).reduce((acc, h) => {
                      const hDue = h.originalDueDate ? parseLocalDate(h.originalDueDate) : parseLocalDate(h.date);
                      if (hDue.getMonth() === currentMonth && hDue.getFullYear() === currentYear && h.note?.includes(`Dia ${slice.day}`)) {
                          return acc + parseVal(h.amount);
                      }
                      return acc;
                  }, 0);
                  
                  if (slicePaidAmount < (baseAmount - 0.05)) {
                      hasLateSlice = true;
                      break;
                  }
              }
          }
          if (hasLateSlice) return 'Atrasado';
          // 🚀 CORREÇÃO: Se nenhuma fatia falhou, o contrato está Em Dia (ignora a data base travada)
          return 'Em Dia';
      }

      if (dueLocalDate < today) return 'Atrasado';
      return 'Em Dia';
  };

  const getLoanDetails = (loan: Loan) => {
      const today = getToday();
      let tempDue = parseLocalDate(loan.nextDue);
      let totalOverdue = 0;
      let missedCount = 0;
      let count = 0;
      
      const realStatus = getLoanRealStatus(loan);
      const breakdown = getSyncedBreakdown(loan);
      
      const validSlices = ((loan as any).multiDates || []).filter((s: any) => s && s.day && !isNaN(Number(s.day)) && Number(s.day) > 0 && parseVal(s.amount) > 0);
      const expectedInstallment = parseVal(loan.installmentValue);
      const sumSlices = validSlices.reduce((acc: number, s: any) => acc + parseVal(s.amount), 0);
      const isActuallyMultiDate = validSlices.length > 0 && Math.abs(sumSlices - expectedInstallment) <= 5.00;

      if (isActuallyMultiDate) {
          const currentMonth = tempDue.getMonth();
          const currentYear = tempDue.getFullYear();
          const todayDate = new Date();
          todayDate.setHours(0,0,0,0);
          
          for (const slice of validSlices) {
              const baseAmount = parseVal(slice.amount);
              const sliceDate = new Date(currentYear, currentMonth, Number(slice.day));
              
              const slicePaidAmount = (loan.history || []).reduce((acc, h) => {
                  const hDue = h.originalDueDate ? parseLocalDate(h.originalDueDate) : parseLocalDate(h.date);
                  if (hDue.getMonth() === currentMonth && hDue.getFullYear() === currentYear && h.note?.includes(`Dia ${slice.day}`)) {
                      return acc + parseVal(h.amount);
                  }
                  return acc;
              }, 0);

              const isPaid = slicePaidAmount >= (baseAmount - 0.05);
              
              if (!isPaid && sliceDate < todayDate && loan.status !== 'Pago' && loan.status !== 'Quitado') {
                  const ratio = baseAmount / (breakdown.total || 1);
                  const sliceDateStr = sliceDate.toISOString().split('T')[0];
                  const sliceOverdue = calculateOverdueValue(baseAmount, sliceDateStr, 'Atrasado', parseVal(loan.fineRate) || 0, parseVal(loan.moraInterestRate) || 0, parseVal(loan.amount) * ratio);
                  totalOverdue += (sliceOverdue - slicePaidAmount);
                  missedCount++;
              }
          }
          return { totalOverdue, missedCount };
      }

      const baseAmount = loan.interestType === 'SIMPLE' ? breakdown.total : (realStatus === 'Acordo' ? parseVal(loan.installmentValue) + parseVal(loan.agreementValue) : parseVal(loan.installmentValue));
      
      const remainingInstallments = loan.interestType === 'SIMPLE' ? 1 : (parseVal(loan.installments) || 1);
      const pad = (n: number) => n.toString().padStart(2, '0');
      
      while (tempDue < today) {
          const dateStr = `${tempDue.getFullYear()}-${pad(tempDue.getMonth() + 1)}-${pad(tempDue.getDate())}`;
          totalOverdue += calculateOverdueValue(baseAmount, dateStr, 'Atrasado', parseVal(loan.fineRate) || 0, parseVal(loan.moraInterestRate) || 0, parseVal(loan.amount));
          missedCount++;
          
          if (realStatus === 'Acordo') break; 
          
          count++;
          if (count >= remainingInstallments) break; 
          if (count > 60) break; 
          
          if (loan.frequency === 'SEMANAL') tempDue.setDate(tempDue.getDate() + 7);
          else if (loan.frequency === 'DIARIO') tempDue.setDate(tempDue.getDate() + 1);
          else tempDue.setMonth(tempDue.getMonth() + 1);
      }

      if (missedCount === 0 && realStatus === 'Atrasado') {
           const dateStr = loan.nextDue.includes('T') ? loan.nextDue.split('T')[0] : loan.nextDue;
           totalOverdue += calculateOverdueValue(baseAmount, dateStr, 'Atrasado', parseVal(loan.fineRate) || 2, parseVal(loan.moraInterestRate) || 1, parseVal(loan.amount));
           missedCount = 1;
      }

      return { totalOverdue, missedCount };
  };

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
      
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      let startFilter: Date | null = null;
      let endFilter: Date | null = null;

      if (period === 'hoje') {
          startFilter = new Date(today); endFilter = new Date(today);
      } else if (period === 'semana') {
          startFilter = new Date(today); endFilter = new Date(today); endFilter.setDate(today.getDate() + 7);
      } else if (period === 'mes') {
          startFilter = new Date(today.getFullYear(), today.getMonth(), 1); endFilter = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      } else if (period === 'proximo_mes') {
          startFilter = new Date(today.getFullYear(), today.getMonth() + 1, 1); endFilter = new Date(today.getFullYear(), today.getMonth() + 2, 0);
      } else if (period === 'personalizado' && customStart && customEnd) {
          startFilter = parseLocalDate(customStart); endFilter = parseLocalDate(customEnd);
      }

      if (endFilter) endFilter.setHours(23, 59, 59, 999);

      const activeDebtors = new Set();
      const uniqueMatchedContracts = new Set();
      
      let capAcc = { all: 0, low: 0, mid: 0, high: 0 };
      let profAcc = { all: 0, low: 0, mid: 0, high: 0 };
      let overAcc = { all: 0, low: 0, mid: 0, high: 0 };

      let totalGloballyActive = 0;
      const filteredContext: any[] = [];
      const pad = (n: number) => n.toString().padStart(2, '0');

      safeLoans.forEach((loan: any) => {
        const isPaid = loan.status === 'Pago' || loan.status === 'Quitado';
        if (!isPaid) {
            totalGloballyActive++;
            activeDebtors.add(loan.client);
        }
        if (isPaid) return;

        const breakdown = getSyncedBreakdown(loan);    const realStatus = getLoanRealStatus(loan);
        const { totalOverdue } = getLoanDetails(loan); // Puxa a bola de neve inteira!        
        let currentDue = parseLocalDate(loan.nextDue);
        let hasMatch = false;
        let capToAdd = 0;
        let profToAdd = 0;
        let overToAdd = 0;
        let slices: any[] = []; 

        const limit = loan.interestType === 'SIMPLE' ? 1 : (loan.installments || 1);

        for (let i = 0; i < limit; i++) {
            const inRange = !startFilter || !endFilter || (currentDue >= startFilter && currentDue <= endFilter);
            if (inRange) {
                hasMatch = true;
                const isOverdueInstallment = currentDue < today || (i === 0 && realStatus === 'Atrasado');

                if (isOverdueInstallment) {
                    const baseAmount = (i === 0 && realStatus === 'Acordo') ? loan.installmentValue + (loan.agreementValue || 0) : loan.installmentValue;
                    const dateStr = `${currentDue.getFullYear()}-${pad(currentDue.getMonth() + 1)}-${pad(currentDue.getDate())}`;
                    // Sincronia Atraso: No card global, a produção só conta a parcela ATUAL pendente
                    if (i === 0) {
                        overToAdd = calculateOverdueValue(baseAmount, dateStr, 'Atrasado', loan.fineRate ?? 2, loan.moraInterestRate ?? 1, loan.amount);
                    }
                } else {
                    capToAdd += (loan.interestType === 'SIMPLE' ? 0 : breakdown.capital);
                    profToAdd += breakdown.interest;
                    slices.push({ date: currentDue.toISOString(), capital: breakdown.capital, interest: breakdown.interest, index: i });
                }
            }
            if (loan.frequency === 'SEMANAL') currentDue.setDate(currentDue.getDate() + 7);
            else if (loan.frequency === 'DIARIO') currentDue.setDate(currentDue.getDate() + 1);
            else currentDue.setMonth(currentDue.getMonth() + 1);
        }

        if (hasMatch) {
            uniqueMatchedContracts.add(loan.id);
            const tier = loan.interestRate < 10 ? 'low' : loan.interestRate <= 15 ? 'mid' : 'high';

            if (period !== 'todos') {
                capAcc.all += capToAdd; capAcc[tier] += capToAdd;
                profAcc.all += profToAdd; profAcc[tier] += profToAdd;
                overAcc.all += overToAdd; overAcc[tier] += overToAdd;
                
                slices.forEach(s => {
                    filteredContext.push({ 
                        ...loan, uniqueSliceId: `${loan.id}-${s.index}`, projectedDate: s.date,
                        projectedCapitalForPeriod: s.capital, projectedInterestForPeriod: s.interest
                    });
                });
            } else {
                // --- MÁGICA DA SINCRONIA GLOBAL (PRODUÇÃO) ---
                let gCap = Math.max(0, parseVal(loan.amount) - parseVal(loan.totalPaidCapital));
                const gExpected = parseVal(loan.projectedProfit) || Math.max(0, (parseVal(loan.installmentValue) * parseVal(loan.installments)) - parseVal(loan.amount));
                
                let gProf = (loan.interestType === 'SIMPLE') ? breakdown.interest : Math.max(0, gExpected - parseVal(loan.totalPaidInterest));
                capAcc.all += gCap; capAcc[tier] += gCap;
                profAcc.all += gProf; profAcc[tier] += gProf;
                
                // 🚨 SOMA CORRETA DA INADIMPLÊNCIA: Só soma se o status for realmente 'Atrasado'
                if (realStatus === 'Atrasado') {
                    overAcc.all += totalOverdue; overAcc[tier] += totalOverdue;
                }

                filteredContext.push({ 
                    ...loan, uniqueSliceId: loan.id, projectedDate: loan.nextDue,
                    projectedCapitalForPeriod: gCap, projectedInterestForPeriod: gProf
                });
            }
        }
      });

      // Arredondamento final para bater os centavos (.13)
      const round = (n: number) => Math.round(n * 100) / 100;
      
      // 👉 ESSA É A LINHA QUE FALTAVA PARA A LISTA APARECER:
      setFilteredLoansContext(filteredContext);
      
      setMetrics({
        capitalNaRua: { all: round(capAcc.all), low: round(capAcc.low), mid: round(capAcc.mid), high: round(capAcc.high) },        lucroProjetado: { all: round(profAcc.all), low: round(profAcc.low), mid: round(profAcc.mid), high: round(profAcc.high) },
        atrasoGeral: { all: round(overAcc.all), low: round(overAcc.low), mid: round(overAcc.mid), high: round(overAcc.high) },
        contratosAtivosFiltro: uniqueMatchedContracts.size,
        contratosAtivosGlobais: totalGloballyActive,
        totalContratosLancados: safeLoans.length,
        totalClientesCadastrados: allClients.length,
        clientesComDivida: activeDebtors.size,
        taxas: { 
            lowCap: round(capAcc.low), midCap: round(capAcc.mid), highCap: round(capAcc.high), 
            lowProf: round(profAcc.low), midProf: round(profAcc.mid), highProf: round(profAcc.high) 
        }
      });

      const activities = [...safeLoans].sort((a, b) => new Date(b.nextDue).getTime() - new Date(a.nextDue).getTime()).slice(0, 6).map((loan: any) => {
        const dueDate = parseLocalDate(loan.nextDue);
        const isOverdue = dueDate < today && loan.status !== 'Pago' && loan.status !== 'Quitado';
        return {
          id: loan.id, type: isOverdue ? 'atraso' : 'novo_contrato',
          text: isOverdue ? `Atraso: ${loan.client}` : `Pendente: ${loan.client}`,
          time: dueDate.toLocaleDateString('pt-BR'), value: isOverdue ? 'Cobrar' : `R$ ${formatMoney(loan.installmentValue)}`
        };
      });
      setRecentActivities(activities);

    } catch (error) { console.error(error); } 
    finally { setLoading(false); }
  };

  useEffect(() => { 
      if (period !== 'personalizado') fetchAndCalculate();
  }, [period, viewMode]);

  // --- LÓGICA DO POP-UP DIÁRIO (VENCIMENTOS DE HOJE) ---
  useEffect(() => {
      const today = new Date();
      const todayStr = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
      
      const dueToday = allLoans.filter(l => {
         const dStr = l.nextDue.split('T')[0];
         return dStr === todayStr && l.status !== 'Pago' && l.status !== 'Quitado';
      });
      setTodaysLoans(dueToday);
  }, [allLoans]);

  useEffect(() => {
      if (todaysLoans.length > 0) {
          const todayStr = new Date().toISOString().split('T')[0];
          const lastPopupDate = localStorage.getItem('lastDailyPopupDate');
          
          if (lastPopupDate !== todayStr) {
              setIsDailyAlertOpen(true);
              localStorage.setItem('lastDailyPopupDate', todayStr);
          }
      }
  }, [todaysLoans]);

  useEffect(() => {
      const handleFocus = () => {
          if (todaysLoans.length > 0) {
              const todayStr = new Date().toISOString().split('T')[0];
              const lastPopupDate = localStorage.getItem('lastDailyPopupDate');
              if (lastPopupDate !== todayStr) {
                  setIsDailyAlertOpen(true);
                  localStorage.setItem('lastDailyPopupDate', todayStr);
              }
          }
      };
      window.addEventListener('focus', handleFocus);
      return () => window.removeEventListener('focus', handleFocus);
  }, [todaysLoans]);
  // ----------------------------------------------------
  
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
      const today = getToday();

      if (selectedRange === 'overdue') {
          const contextIds = new Set(filteredLoansContext.map(l => l.id));
          return allLoans.filter(l => {
              const realStatus = getLoanRealStatus(l);
              
              // 🚨 RODRIGO PONTO 2: Apenas 'Atrasado' entra na lista (Acordos ficam de fora)
              const isOverdue = realStatus === 'Atrasado';
              
              let passTier = true;
              if (tierFilters.overdue === 'low') passTier = parseVal(l.interestRate) < 10;
              if (tierFilters.overdue === 'mid') passTier = parseVal(l.interestRate) >= 10 && parseVal(l.interestRate) <= 15;
              if (tierFilters.overdue === 'high') passTier = parseVal(l.interestRate) > 15;

              return isOverdue && contextIds.has(l.id) && passTier;
          }).sort((a, b) => a.client.localeCompare(b.client));
      }

      return filteredLoansContext.filter(l => {
          const realStatus = getLoanRealStatus(l);
          if (selectedRange === 'active') return realStatus !== 'Quitado';
          if (realStatus === 'Quitado') return false; 
          
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
      }).sort((a, b) => a.client.localeCompare(b.client));
  }, [filteredLoansContext, allLoans, selectedRange, tierFilters]);

  const activeContractsByClient = useMemo(() => {
      if (selectedRange !== 'clients_contracts') return [];
      const map = new Map();
      
      allLoans.forEach(l => {
          if (l.status === 'Pago' || l.status === 'Quitado') return;
          if (!map.has(l.client)) map.set(l.client, { name: l.client, contracts: [], totalCapital: 0, totalProfit: 0 });
          const c = map.get(l.client);
          c.contracts.push(l);
          
          c.totalCapital += calculateCapitalBalance(l);
          const gExpected = Number(l.projectedProfit) || Math.max(0, (l.installmentValue * l.installments) - l.amount);
          const gProf = l.interestType === 'SIMPLE' ? calculateInstallmentBreakdown(l).interest : Math.max(0, gExpected - (Number(l.totalPaidInterest) || 0));
          c.totalProfit += gProf;
      });

      const result = Array.from(map.values());

      if (!searchTerm) return result.sort((a, b) => a.name.localeCompare(b.name));

      const term = searchTerm.toLowerCase();
      return result.filter(c => {
          const clientInfo = allClients.find(cli => cli.name === c.name);
          const cpfLimpo = clientInfo?.cpf ? clientInfo.cpf.replace(/\D/g, '') : '';
          const buscaCpf = term.replace(/\D/g, '');

          const matchNome = c.name.toLowerCase().includes(term);
          const matchCpf = buscaCpf && cpfLimpo.includes(buscaCpf);
          const matchContrato = c.contracts.some((cnt: any) => cnt.id.toString().includes(term));

          return matchNome || matchCpf || matchContrato;
      }).sort((a, b) => a.name.localeCompare(b.name));
  }, [allLoans, allClients, selectedRange, searchTerm]);

  const rangeTitles = {
      low: 'Taxa Baixa (< 10%)', mid: 'Taxa Média (10% - 15%)', high: 'Taxa Alta (> 15%)',
      capital: 'Detalhamento de Capital', profit: 'Detalhamento de Lucro', overdue: 'Contratos em Atraso (Bola de Neve)', active: 'Carteira de Contratos no Filtro',
      clients_contracts: 'Relação de Clientes e Contratos Ativos'
  };

  const goToBillingWithSearch = (clientName: string) => {
       sessionStorage.setItem('searchClient', clientName);
       navigate('/billing');
  }

  return (
    <Layout>
      {isDailyAlertOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 sm:p-6 sm:items-start sm:pt-[10vh] overflow-y-auto animate-in fade-in duration-200">
             <div className="bg-slate-50 rounded-3xl shadow-2xl w-full max-w-md flex flex-col animate-in slide-in-from-bottom-4 sm:slide-in-from-top-8 fade-in duration-300 relative my-auto sm:my-0 ring-1 ring-white/20 overflow-hidden">
                 {/* HEADER */}
                 <div className="bg-slate-900 p-6 flex justify-between items-center relative">
                     <div className="absolute -right-4 -top-4 bg-white/5 w-24 h-24 rounded-full blur-xl"></div>
                     <div className="flex items-center gap-3 text-white font-bold relative z-10">
                         <div className="bg-yellow-400/20 p-2.5 rounded-xl">
                             <BellRing className="text-yellow-400" size={22}/>
                         </div>
                         <span className="text-lg tracking-wide">Vencimentos de Hoje</span>
                     </div>
                     <button onClick={() => setIsDailyAlertOpen(false)} className="text-white/40 hover:text-white hover:bg-white/10 p-2 rounded-full transition-all relative z-10"><X size={20}/></button>
                 </div>
                 
                 {/* BODY */}
                 <div className="p-5 max-h-[60vh] overflow-y-auto custom-scrollbar">
                     {todaysLoans.length === 0 ? (
                         <div className="text-center py-10">
                             <div className="bg-white w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
                                 <CheckCircle size={36} className="text-green-500"/>
                             </div>
                             <p className="text-slate-800 font-bold text-lg">Tudo limpo por aqui!</p>
                             <p className="text-slate-500 text-sm mt-1">Nenhum vencimento pendente para hoje.</p>
                         </div>
                     ) : (
                         <div className="space-y-3">
                             <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 ml-1">Atenção ao dia de hoje:</p>
                             {todaysLoans.map(l => (
                                 <div key={l.id} className="flex justify-between items-center p-4 bg-white border border-slate-200 rounded-2xl hover:border-yellow-400 hover:shadow-md hover:shadow-yellow-400/10 transition-all cursor-pointer group" onClick={() => goToBillingWithSearch(l.client)}>
                                     <div className="flex items-center gap-4">
                                         <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-600 font-black border border-slate-100 group-hover:bg-yellow-50 group-hover:text-yellow-600 group-hover:border-yellow-200 transition-colors text-lg">{l.client.charAt(0)}</div>
                                         <div>
                                             <p className="font-bold text-slate-800 group-hover:text-slate-900 leading-tight">{l.client}</p>
                                             {getNickname(allClients.find(c => c.name === l.client)?.observations) && (
                                                <p className="text-[10px] font-bold text-blue-600 truncate max-w-[150px] mt-0.5">
                                                    {getNickname(allClients.find(c => c.name === l.client)?.observations)}
                                                </p>
                                             )}
                                             <p className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {l.id}</p>
                                         </div>
                                     </div>
                                     <div className="text-right">
                                         <p className="font-black text-slate-800 group-hover:text-yellow-600 transition-colors text-lg">R$ {formatMoney(l.interestType === 'SIMPLE' ? calculateInstallmentBreakdown(l).total : Number(l.installmentValue))}</p>
                                         <span className="inline-block mt-1 text-[9px] text-slate-500 uppercase font-bold bg-slate-100 px-2 py-0.5 rounded-md group-hover:bg-yellow-100 group-hover:text-yellow-700 transition-colors">Cobrar ➔</span>
                                     </div>
                                 </div>
                             ))}
                         </div>
                     )}
                 </div>

                 {/* FOOTER */}
                 <div className="p-5 border-t border-slate-200 bg-slate-50/80 flex justify-end">
                      <button onClick={() => setIsDailyAlertOpen(false)} className="w-full sm:w-auto px-8 py-3 bg-slate-900 text-white rounded-xl font-bold shadow-lg shadow-slate-900/20 hover:bg-slate-800 hover:-translate-y-0.5 transition-all">Entendido</button>
                 </div>
             </div>
        </div>
      )}

      {showWelcomeModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 sm:p-6 sm:items-start sm:pt-[10vh] overflow-y-auto animate-in fade-in duration-200">
             <div className="bg-slate-50 rounded-3xl shadow-2xl w-full max-w-md flex flex-col animate-in slide-in-from-bottom-4 sm:slide-in-from-top-8 fade-in duration-300 relative my-auto sm:my-0 ring-1 ring-white/20 overflow-hidden">
                 
                 {/* HEADER */}
                 <div className="bg-slate-900 p-6 flex justify-between items-center relative">
                     <div className="absolute -right-4 -top-4 bg-white/5 w-24 h-24 rounded-full blur-xl"></div>
                     <div className="flex items-center gap-3 text-white font-bold relative z-10">
                         <div className="bg-orange-400/20 p-2.5 rounded-xl">
                             <CalendarDays className="text-orange-400" size={22}/>
                         </div>
                         <div className="flex flex-col">
                            <span className="text-lg tracking-wide leading-tight">Vencimentos</span>
                            <span className="text-[10px] font-normal text-slate-400">Consulte qualquer data</span>
                         </div>
                     </div>
                     <button onClick={() => setShowWelcomeModal(false)} className="text-white/40 hover:text-white hover:bg-white/10 p-2 rounded-full transition-all relative z-10"><X size={20}/></button>
                 </div>
                 
                 {/* FILTER BAR */}
                 <div className="p-5 bg-white border-b border-slate-200 shadow-sm relative z-10">
                     <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Escolha uma Data</label>
                     <input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} className="w-full p-3.5 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400 transition-all bg-slate-50 hover:bg-white"/>
                 </div>

                 {/* BODY */}
                 <div className="p-5 max-h-[50vh] overflow-y-auto custom-scrollbar">
                     {loansOnMaturityDate.length === 0 ? (
                         <div className="text-center py-10">
                             <div className="bg-white w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm border border-slate-100">
                                 <CalendarDays size={36} className="text-slate-300"/>
                             </div>
                             <p className="text-slate-800 font-bold text-lg">Agenda Livre!</p>
                             <p className="text-slate-500 text-sm mt-1">Nada agendado para esta data.</p>
                         </div>
                     ) : (
                         <div className="space-y-3">
                             <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 ml-1 flex items-center gap-1.5"><Bell size={12}/> Contratos Encontrados ({loansOnMaturityDate.length})</p>
                             {loansOnMaturityDate.map(l => (
                                 <div key={l.id} className="flex justify-between items-center p-4 bg-white border border-slate-200 rounded-2xl hover:border-orange-400 hover:shadow-md hover:shadow-orange-400/10 transition-all cursor-pointer group" onClick={() => goToBillingWithSearch(l.client)}>
                                     <div className="flex items-center gap-4">
                                         <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-600 font-black border border-slate-100 group-hover:bg-orange-50 group-hover:text-orange-600 group-hover:border-orange-200 transition-colors text-lg">{l.client.charAt(0)}</div>
                                         <div>
                                             <p className="font-bold text-slate-800 group-hover:text-slate-900 leading-tight">{l.client}</p>
                                             {getNickname(allClients.find(c => c.name === l.client)?.observations) && (
                                                <p className="text-[10px] font-bold text-blue-600 truncate max-w-[150px] mt-0.5">
                                                    {getNickname(allClients.find(c => c.name === l.client)?.observations)}
                                                </p>
                                             )}
                                             <p className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {l.id}</p>
                                         </div>
                                     </div>
                                     <div className="text-right">
                                         <p className="font-black text-slate-800 group-hover:text-orange-600 transition-colors text-lg">R$ {formatMoney(l.interestType === 'SIMPLE' ? calculateInstallmentBreakdown(l).total : Number(l.installmentValue))}</p>
                                         <span className="inline-block mt-1 text-[9px] text-slate-500 uppercase font-bold bg-slate-100 px-2 py-0.5 rounded-md group-hover:bg-orange-100 group-hover:text-orange-700 transition-colors">Ver Ficha ➔</span>
                                     </div>
                                 </div>
                             ))}
                         </div>
                     )}
                 </div>

                 {/* FOOTER */}
                 <div className="p-5 border-t border-slate-200 bg-slate-50/80">
                     <button onClick={() => setShowWelcomeModal(false)} className="w-full py-3.5 bg-slate-900 text-white rounded-xl font-bold shadow-lg shadow-slate-900/20 hover:bg-slate-800 hover:-translate-y-0.5 transition-all">Fechar Aba</button>
                 </div>
             </div>
        </div>
      )}

      {selectedRange ? (
          <div className="animate-in slide-in-from-right-10 duration-300">
              <header className="mb-6 flex items-center gap-4">
                  <button onClick={() => { setSelectedRange(null); setSearchTerm(''); }} className="p-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors shadow-sm"><ArrowLeft size={20}/></button>
                  <div><h2 className="text-2xl font-bold text-slate-800">{rangeTitles[selectedRange]}</h2><p className="text-slate-500">Detalhamento dos valores baseados na sua seleção.</p></div>
              </header>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  
                  {selectedRange === 'clients_contracts' && (
                      <div className="p-4 border-b bg-slate-50/50">
                          <div className="relative max-w-md">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                              <input 
                                  type="text" 
                                  placeholder="Buscar por nome, CPF ou ID do contrato..." 
                                  value={searchTerm}
                                  onChange={(e) => setSearchTerm(e.target.value)}
                                  className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm text-sm"
                              />
                              {searchTerm && (
                                  <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                      <X size={14} />
                                  </button>
                              )}
                          </div>
                      </div>
                  )}

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
                                          <td className="p-4">
                                              <div className="font-bold text-slate-800">{c.name}</div>
                                              {getNickname(allClients.find(client => client.name === c.name)?.observations) && (
                                                  <div className="text-[10px] font-bold text-blue-600 truncate max-w-[250px] mt-0.5">
                                                      {getNickname(allClients.find(client => client.name === c.name)?.observations)}
                                                  </div>
                                              )}
                                          </td>
                                          <td className="p-4 text-center">
                                          <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-bold">{c.contracts.length} ativos</span>
                                      </td>
                                      <td className="p-4 text-center text-[10px] text-slate-400 font-mono tracking-widest">
                                          {c.contracts.map((cnt: any) => cnt.id).join(', ')}
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
                                      {selectedRange === 'overdue' ? 'Valor Original (Atrasado)' : period !== 'todos' ? 'Capital da Parcela' : 'Capital Restante'}
                                  </th>
                                  <th className="p-4 text-right text-green-600">
                                      {selectedRange === 'overdue' ? '-' : period !== 'todos' ? 'Juros da Parcela' : 'Lucro Restante'}
                                  </th>
                                  {selectedRange === 'overdue' && <th className="p-4 text-right text-red-600">Bola de Neve (Atualizado)</th>}
                                  <th className="p-4 text-center">Status</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                              {detailedLoans.map(loan => {
                                  const overdueVal = getLoanDetails(loan).totalOverdue;
                                  
                                  return (
                                      <tr key={loan.uniqueSliceId || loan.id} className="hover:bg-blue-50 transition-colors cursor-pointer" onClick={() => goToBillingWithSearch(loan.client)}>
                                          <td className="p-4">
                                              <div className="font-bold text-slate-800">{loan.client}</div>
                                              {getNickname(allClients.find(c => c.name === loan.client)?.observations) && (
                                                  <div className="text-[10px] font-bold text-blue-600 truncate max-w-[250px] my-0.5">
                                                      {getNickname(allClients.find(c => c.name === loan.client)?.observations)}
                                                  </div>
                                              )}
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
                                              ) : (
                                                  <>
                                                      <div className="flex items-center justify-center gap-1 font-bold text-slate-700">
                                                          <Calendar size={12} className="text-blue-500"/>
                                                          {parseLocalDate(loan.projectedDate || loan.nextDue).toLocaleDateString('pt-BR')}
                                                      </div>
                                                      {loan.isActualSlice && (
                                                          <div className="text-[10px] text-blue-600 font-black uppercase tracking-tighter mt-1 bg-blue-50 px-1 rounded inline-block">Fatia da Parcela</div>
                                                      )}
                                                      {parseLocalDate(loan.projectedDate || loan.nextDue) < getToday() && getLoanRealStatus(loan) === 'Atrasado' && (
                                                          <div className="text-[9px] text-red-500 font-bold uppercase tracking-wider mt-0.5">(Vencimento em Atraso)</div>
                                                      )}       
                                                  </>
                                              )}
                                          </td>

                                          <td className="p-4 text-center font-bold text-slate-600">{Number(loan.interestRate).toFixed(2)}%</td>    
                                          <td className="p-4 text-right font-bold text-slate-700">
                                              R$ {formatMoney(selectedRange === 'overdue' ? (getSyncedBreakdown(loan).capital) : (loan.interestType === 'SIMPLE' || loan.isMigration ? Math.max(0, Number(loan.amount) - (Number(loan.totalPaidCapital) || 0)) : calculateCapitalBalance(loan)))}
                                          </td>                                          
                                          <td className="p-4 text-right font-bold text-green-600">
                                              R$ {formatMoney(selectedRange === 'overdue' ? (getSyncedBreakdown(loan).interest) : loan.projectedInterestForPeriod)}
                                          </td>                                          
                                          {selectedRange === 'overdue' && <td className="p-4 text-right font-black text-red-600">R$ {formatMoney(overdueVal)}</td>}
                                          <td className="p-4 text-center">
                                              <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${getLoanRealStatus(loan) === 'Atrasado' ? 'bg-red-50 text-red-600' : getLoanRealStatus(loan) === 'Acordo' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'}`}>
                                                  {getLoanRealStatus(loan)}
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
                
                {/* CARD GLOBAL DE CLIENTES E CONTRATOS ATIVOS */}
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