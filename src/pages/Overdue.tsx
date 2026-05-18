import { useState, useEffect, useMemo } from "react";
import {
  Search,
  AlertTriangle,
  Calendar,
  RefreshCw,
  Filter,
  MessageCircle,
  Eye,
  List,
  DollarSign
} from "lucide-react";
import Layout from "../components/Layout";
import Modal from "../components/Modal";
import { loanService, clientService, Loan, Client } from "../services/api";
import { calculateOverdueValue, formatMoney } from "../utils/finance";

interface LoanExtended extends Loan {
  diffDays: number;
  snowball: {
    totalOriginal: number;
    totalUpdated: number;
    missedInstallments: any[];
  };
}

const getApiUrl = localStorage.getItem("getApiUrl") || "https://creditnow-prod-266321031136.us-central1.run.app";

const sendWhatsappApi = async (
  name: string,
  phone: string,
  companyName: string,
  token: string,
  msg: string,
) => {
  const response = await fetch(getApiUrl+`/api/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userConectado: companyName,
      phone: phone,
      name: name,
      apiKey: token,
      message: msg, // Mensagem customizada antes do envio!
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (errorText.includes("WHATSAPP_DISCONNECTED")) {
      throw new Error("WHATSAPP_DISCONNECTED");
    }
    throw new Error("Falha ao enviar via API");
  }
};

const Overdue = () => {
  // 🚀 LIMPADOR DE ACENTOS E CARACTERES ESPECIAIS
  const normalizeString = (str: string) => {
      return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  };

  // 🚀 EXTRAÇÃO DE APELIDO: Limpa o JSON e mostra apenas a observação
  const getNickname = (obs?: string) => {
      if (!obs) return '';
      return obs.replace(/\[META:.*?\]/g, '').trim();
  };

  const [loans, setLoans] = useState<Loan[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSnowball, setSelectedSnowball] = useState<any>(null);

  const [metrics, setMetrics] = useState({
    totalOverdue: 0,
    recoveredToday: 0,
    recoveredCapital: 0,
    recoveredInterest: 0,
    efficiency: 0,
    count: 0,
  });

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

  const parseVal = (v: any): number => {
      if (typeof v === 'number') return isNaN(v) ? 0 : v;
      if (!v) return 0;
      if (typeof v === 'string') return parseFloat(v.replace(/\./g, '').replace(',', '.')) || 0;
      return 0;
  };

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

  const getLoanRealStatus = (loan: Loan) => {
      if (loan.status === 'Pago' || loan.status === 'Quitado') return 'Quitado'; 
      const balance = parseVal(loan.amount) - parseVal(loan.totalPaidCapital);
      if (balance <= 0.10) return 'Quitado'; 
      
      const today = new Date();
      today.setHours(0,0,0,0);
      
      const dueLocalDate = parseLocalDate(loan.nextDue);

      // 🚀 FIX: Acordos perdem a blindagem e viram 'Atrasado' se o dia combinado passar
      if (loan.status === 'Acordo') {
          if (dueLocalDate < today) return 'Atrasado';
          return 'Acordo';
      }

      const validSlices = ((loan as any).multiDates || []).filter((s: any) => s && s.day && !isNaN(Number(s.day)) && Number(s.day) > 0 && parseVal(s.amount) > 0);

      if (validSlices.length > 0) {
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
          return 'Em Dia';
      }

      if (dueLocalDate < today) return 'Atrasado';
      return 'Em Dia';
  };

  const getSnowballDetails = (loan: Loan) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 🚀 FIX: Se for acordo, a nova data combinada anula qualquer fatia antiga
    let tempDue = parseLocalDate(loan.nextDue);
    if (loan.status === 'Acordo') {
        const isoDue = loan.nextDue.includes('T') ? loan.nextDue.split('T')[0] : loan.nextDue;
        tempDue = parseLocalDate(isoDue);
    }

    let totalOriginal = 0;
    let totalUpdated = 0;
    let missedInstallments: any[] = [];
    let count = 0;

    const realStatus = getLoanRealStatus(loan);
    const breakdown = getSyncedBreakdown(loan);

    // 🚀 FIX: Fatias são ignoradas se o status atual for Acordo (vale a data do acordo)
    const validSlices = loan.status === 'Acordo' ? [] : ((loan as any).multiDates || []).filter((s: any) => s && s.day && !isNaN(Number(s.day)) && Number(s.day) > 0 && parseVal(s.amount) > 0);

    if (validSlices.length > 0) {
        const currentMonth = tempDue.getMonth();
        const currentYear = tempDue.getFullYear();
        
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
            
            if (!isPaid && sliceDate < today && loan.status !== 'Pago' && loan.status !== 'Quitado') {
                const ratio = baseAmount / (breakdown.total || 1);
                const dateStr = sliceDate.toISOString().split('T')[0];
                const sliceOverdue = calculateOverdueValue(baseAmount, dateStr, 'Atrasado', parseVal(loan.fineRate) || 0, parseVal(loan.moraInterestRate) || 0, parseVal(loan.amount) * ratio);
                
                const debtOriginal = baseAmount - slicePaidAmount;
                const debtUpdated = sliceOverdue - slicePaidAmount;

                missedInstallments.push({ date: dateStr, original: debtOriginal, updated: debtUpdated });
                totalOriginal += debtOriginal;
                totalUpdated += debtUpdated;
            }
        }
        return { totalOriginal, totalUpdated, missedInstallments };
    }

    // 🚀 FIX: O breakdown.total já processa PRICE, SIMPLE e soma Acordos Extras automaticamente
    const baseAmount = breakdown.total; 
    const remainingInstallments = loan.interestType === "SIMPLE" ? 999 : parseVal(loan.installments) || 1;
    const pad = (n: number) => n.toString().padStart(2, '0');

    while (tempDue < today) {
      const dateStr = `${tempDue.getFullYear()}-${pad(tempDue.getMonth() + 1)}-${pad(tempDue.getDate())}`;
      const updatedVal = calculateOverdueValue(
        baseAmount,
        dateStr,
        "Atrasado",
        parseVal(loan.fineRate) || 2,
        parseVal(loan.moraInterestRate) || 1,
        parseVal(loan.amount)
      );

      missedInstallments.push({
        date: dateStr,
        original: baseAmount,
        updated: updatedVal,
      });

      totalOriginal += baseAmount;
      totalUpdated += updatedVal;

      // 🚀 FIX: Se for um Acordo, o atraso é apenas de 1 parcela (o valor total do acordo), então quebra o loop
      if (loan.status === "Acordo") break;

      count++;
      if (count >= remainingInstallments) break;
      if (count > 60) break;

      if (loan.frequency === "SEMANAL") tempDue.setDate(tempDue.getDate() + 7);
      else if (loan.frequency === "DIARIO") tempDue.setDate(tempDue.getDate() + 1);
      else tempDue.setMonth(tempDue.getMonth() + 1);
    }

    if (missedInstallments.length === 0 && realStatus === "Atrasado") {
      const dateStr = loan.nextDue.includes('T') ? loan.nextDue.split('T')[0] : loan.nextDue;
      const updatedVal = calculateOverdueValue(
        baseAmount,
        dateStr,
        "Atrasado",
        parseVal(loan.fineRate) || 2,
        parseVal(loan.moraInterestRate) || 1,
        parseVal(loan.amount)
      );
      missedInstallments.push({
        date: dateStr,
        original: baseAmount,
        updated: updatedVal,
      });
      totalOriginal += baseAmount;
      totalUpdated += updatedVal;
    }

    return { totalOriginal, totalUpdated, missedInstallments };
  };

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [loansData, clientsData] = await Promise.all([
        loanService.getAll(),
        clientService.getAll(),
      ]);

      // 🚀 FILTRO GLOBAL DA LISTA NEGRA: Remove os bloqueados da matemática de atraso
      const blockedNames = new Set((clientsData || []).filter(c => c.status === 'Bloqueado').map(c => c.name));
      const activeLoans = (loansData || []).filter(l => !blockedNames.has(l.client));

      setLoans(activeLoans); // <-- Agora só contratos de clientes "não bloqueados" vão para a conta!
      setClients(clientsData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- FUNÇÕES DO WHATSAPP ---
  const getInstanceToken = async (targetName: string, targetPhone: string): Promise<{ instanceName: string; apikey: string } | null> => {
    try {
      const response = await fetch(getApiUrl + "/api/instances/ver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: targetName, phone: targetPhone }),
      });
      if (!response.ok) return null;

      const data = await response.json();
      const list = Array.isArray(data) ? data : data.data || data.instances || [];

      if (list.length === 0) return null;

      const targetInstance = list.find(
        (inst: any) =>
          inst.instance?.instanceName?.toString().trim().toLowerCase() ===
          targetName.trim().toLowerCase(),
      );

      if (targetInstance?.instance?.instanceName && targetInstance?.instance?.apikey)
        return { instanceName: targetInstance.instance.instanceName, apikey: targetInstance.instance.apikey };

      const fallback = list.find((inst: any) => inst.instance?.status === "open");
      if (fallback?.instance?.instanceName && fallback?.instance?.apikey)
        return { instanceName: fallback.instance.instanceName, apikey: fallback.instance.apikey };

      return null;
    } catch (error) {
      console.error("❌ Erro fatal no getInstanceToken:", error);
      return null;
    }
  };

  const [editableMessage, setEditableMessage] = useState(""); 
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ loan: LoanExtended; snowball: any; } | null>(null);

  const getMessageText = async (name: string, lateDays: number, totalUpdated: number, dateVencimento: string, loan: LoanExtended, snowball?: any) => {
    try {
      const response = await fetch(getApiUrl + "/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delay: 1,
          name: name,
          LateDays: lateDays,
          updatedAmount: totalUpdated,
          dateVencimento: dateVencimento,
        }),
      });

      if (!response.ok) throw new Error("Erro na API");

      const data = await response.json();

      setEditableMessage(data.message || `Olá ${name.split(" ")[0]}, identificamos uma pendência de R$ ${formatMoney(totalUpdated)} referente ao seu contrato.`); 
      setPendingAction({ loan, snowball });
      setIsConfirmModalOpen(true);
      return data.message;
    } catch (error) {
      const baseMessage = `Olá ${name.split(" ")[0]}, identificamos uma pendência de R$ ${formatMoney(totalUpdated)} referente ao seu contrato CTR-${loan.id?.substring(0, 6).toUpperCase()}. Podemos agendar um pagamento para regularizar?`;
      setEditableMessage(baseMessage);
      setPendingAction({ loan, snowball });
      setIsConfirmModalOpen(true);
    }
  };

  const handleWhatsApp = async (loan: LoanExtended, snowball: any, msg: string) => {
    const client = clients.find((c) => c.name === loan.client);

    if (!client || !client.phone) {
      alert("❌ Erro: Telefone do cliente não encontrado.");
      return;
    }

    const cleanPhone = client.phone.replace(/\D/g, "");
    const firstName = loan.client.split(" ")[0];

    const companyName = localStorage.getItem("companyName") || "";
    const companyPhone = localStorage.getItem("companyPhone") || "";

    try {
      const instance = await getInstanceToken(companyName, companyPhone);

      if (!instance) {
        throw new Error("Instância WhatsApp não encontrada.");
      }
      
      await sendWhatsappApi(loan.client, client.phone, instance.instanceName, instance.apikey, msg);
      alert(`✅ Mensagem enviada com sucesso para ${firstName}!`);
    } catch (error: any) {
      if (error?.message === "WHATSAPP_DISCONNECTED") {
        alert("⚠️ WhatsApp desconectado!\n\nVá em Configurações → WhatsApp e reconecte o QR Code para voltar a enviar mensagens.");
        return;
      }
      console.warn("API Offline, usando link direto...");
      const url = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
    }
  };

  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let sumOverdue = 0;
    let sumRecoveredToday = 0;
    let sumRecoveredCapital = 0;
    let sumRecoveredInterest = 0;
    let overdueCount = 0;
    let payingCount = 0;

    loans.forEach((loan) => {
      if (loan.history && loan.history.length > 0) {
        loan.history.forEach((record) => {
          const payDate = new Date(record.date);
          payDate.setMinutes(payDate.getMinutes() + payDate.getTimezoneOffset());

          const type = record.type ? record.type.toLowerCase() : "";
          if (type.includes("abertura") || type.includes("empréstimo") || type.includes("contrato")) return;

          if (
            payDate.getDate() === today.getDate() &&
            payDate.getMonth() === today.getMonth() &&
            payDate.getFullYear() === today.getFullYear()
          ) {
            sumRecoveredToday += parseVal(record.amount);

            const instVal = parseVal(loan.installmentValue);
            const totalExpected = instVal * (parseVal(loan.installments) || 1);
            const capRatio = totalExpected > 0 ? parseVal(loan.amount) / totalExpected : 1;

            if (record.capitalPaid !== undefined && record.interestPaid !== undefined) {
              sumRecoveredCapital += parseVal(record.capitalPaid);
              sumRecoveredInterest += parseVal(record.interestPaid);
            } else {
              const calcCap = parseVal(record.amount) * capRatio;
              sumRecoveredCapital += calcCap;
              sumRecoveredInterest += parseVal(record.amount) - calcCap;
            }
            payingCount++;
          }
        });
      }

      if (loan.status === "Pago") return;

      const realStatus = getLoanRealStatus(loan);
      
      // 🚨 RODRIGO PONTO 2: Apenas 'Atrasado' soma no Card de Inadimplentes (Acordos NÃO somam)
      const isOverdue = realStatus === "Atrasado";

      if (isOverdue) {
        const snowball = getSnowballDetails(loan);
        if (snowball && snowball.totalUpdated > 0) {
          sumOverdue += snowball.totalUpdated;
          overdueCount++;
        }
      }
    });

    const eff = overdueCount > 0 ? Math.round((payingCount / (overdueCount + payingCount)) * 100) : sumRecoveredToday > 0 ? 100 : 0;

    setMetrics({ totalOverdue: sumOverdue, recoveredToday: sumRecoveredToday, recoveredCapital: sumRecoveredCapital, recoveredInterest: sumRecoveredInterest, efficiency: eff, count: overdueCount });
  }, [loans]);

  // 🚀 BUSCA INTELIGENTE DO RODRIGO: Sem acentos, prefixo primeiro, alfabético depois.
  const filteredOverdueWithSnowball = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdueList: LoanExtended[] = [];

    loans.forEach((l) => {
      if (l.status === "Pago" || l.status === "Quitado") return;
      const realStatus = getLoanRealStatus(l);
      
      // 🚨 Apenas 'Atrasado' entra na Tabela
      const isOverdue = realStatus === "Atrasado";

      if (isOverdue) {
        const snowball = getSnowballDetails(l);
        if (snowball && snowball.totalUpdated > 0) {
          const dueDate = parseLocalDate(l.nextDue);
          const oldestDate = snowball.missedInstallments.length > 0 ? parseLocalDate(snowball.missedInstallments[0].date) : dueDate;
          const diffTime = Math.abs(today.getTime() - oldestDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          overdueList.push({ ...l, snowball, diffDays });
        }
      }
    });

    const searchLower = normalizeString(searchTerm);
    
    // 1. Filtra a lista ignorando acentos
    const filteredList = overdueList.filter((l) => {
        const cNameNorm = normalizeString(l.client || '');
        return cNameNorm.includes(searchLower) || (l.id || "").toLowerCase().includes(searchLower);
    });

    // 2. Ordena de forma inteligente
    return filteredList.sort((a, b) => {
        if (!searchTerm) {
             return b.snowball.totalUpdated - a.snowball.totalUpdated;
        }

        const aClient = normalizeString(a.client || "");
        const bClient = normalizeString(b.client || "");
        
        const aStarts = aClient.startsWith(searchLower);
        const bStarts = bClient.startsWith(searchLower);
        
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        
        return aClient.localeCompare(bClient);
    });
  }, [loans, searchTerm]);

  const openDetails = (loan: any) => {
    setSelectedSnowball(loan);
    setIsModalOpen(true);
  };

  return (
    <Layout>
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            Cobrança de Inadimplentes
          </h2>
          <p className="text-slate-500">
            Gestão de contratos em atraso e recuperação (Efeito Bola de Neve).
          </p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 bg-white border border-gray-200 text-slate-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors shadow-sm font-bold">
          <RefreshCw className={isLoading ? "animate-spin" : ""} size={18} /> Atualizar
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-red-50 p-6 rounded-2xl border border-red-100 shadow-sm relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-red-600 font-bold text-sm uppercase tracking-wider">Total em Atraso (Atualizado)</span>
            <AlertTriangle className="text-red-500" size={24} />
          </div>
          <h3 className="text-3xl font-black text-slate-800">R$ {formatMoney(metrics.totalOverdue)}</h3>
          <p className="text-xs text-red-500 font-medium mt-1">Soma de todas as parcelas perdidas com multas</p>
        </div>

        <div className="bg-green-50 p-6 rounded-2xl border border-green-100 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-2">
              <span className="text-green-700 font-bold text-sm uppercase tracking-wider">Recuperado Hoje</span>
              <DollarSign className="text-green-600" size={24} />
            </div>
            <h3 className="text-3xl font-black text-slate-800">R$ {formatMoney(metrics.recoveredToday)}</h3>
          </div>
          <div className="flex flex-wrap gap-2 mt-3 text-[11px] font-bold">
            <span className="bg-white px-2 py-1 rounded shadow-sm text-slate-600 border border-green-200">Capital: R$ {formatMoney(metrics.recoveredCapital)}</span>
            <span className="bg-green-100 px-2 py-1 rounded shadow-sm text-green-800 border border-green-200">Lucro: R$ {formatMoney(metrics.recoveredInterest)}</span>
          </div>
        </div>

        <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-blue-700 font-bold text-sm uppercase tracking-wider">Eficiência de Contato</span>
            <MessageCircle className="text-blue-600" size={24} />
          </div>
          <h3 className="text-3xl font-black text-slate-800">{metrics.efficiency}%</h3>
          <div className="w-full bg-blue-200 rounded-full h-1.5 mt-3">
            <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: `${metrics.efficiency}%` }}></div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-50 bg-slate-50/30 flex justify-between items-center">
          <div className="relative w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input type="text" placeholder="Buscar cliente inadimplente..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-slate-900/5 transition-all font-bold text-slate-700" />
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Filter size={16} />
            <span className="font-bold">{filteredOverdueWithSnowball.length}</span> clientes em atraso
          </div>
        </div>

        <div className="overflow-visible min-h-[400px]">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                <th className="p-4">Cliente / Contrato</th>
                <th className="p-4">Atrasado Desde</th>
                <th className="p-4 text-center">Vencidas</th>
                <th className="p-4 text-right">Valor Inicial</th>
                <th className="p-4 text-right">Total c/ Multa</th>
                <th className="p-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredOverdueWithSnowball.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-400 italic">Nenhum contrato em atraso.</td></tr>
              ) : (
                filteredOverdueWithSnowball.map((loan) => (
                  <tr key={loan.id} className="hover:bg-red-50/30 transition-colors group">
                    <td className="p-4">
                      <div className="font-bold text-slate-800">{loan.client}</div>
                      {getNickname(clients.find(c => c.name === loan.client)?.observations) && (
                          <div className="text-[10px] font-bold text-blue-600 truncate max-w-[250px] mt-0.5">
                              {getNickname(clients.find(c => c.name === loan.client)?.observations)}
                          </div>
                      )}
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">ID: {loan.id}</div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2 text-red-600 font-bold text-sm">
                        <Calendar size={14} />
                        {loan.snowball.missedInstallments[0]?.date ? new Date(loan.snowball.missedInstallments[0].date + "T12:00:00").toLocaleDateString("pt-BR") : "-"}
                      </div>
                      <span className="text-[10px] text-slate-400 font-bold">{loan.diffDays} dias atrás</span>
                    </td>
                    <td className="p-4 text-center">
                      <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-black border border-red-200">{loan.snowball.missedInstallments.length}x</span>
                    </td>
                    <td className="p-4 text-right text-slate-500 font-bold">R$ {formatMoney(loan.snowball.totalOriginal)}</td>
                    <td className="p-4 text-right font-black text-slate-800 text-lg">R$ {formatMoney(loan.snowball.totalUpdated)}</td>
                    <td className="p-4 text-right flex items-center justify-end gap-2">
                      <button onClick={() => openDetails(loan)} className="p-2 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1 font-bold text-xs"><Eye size={16} /> Detalhes</button>
                      <button
                        onClick={() => getMessageText(loan.client, loan.diffDays, loan.snowball.totalUpdated, loan.nextDue, loan, loan.snowball)}
                        className="p-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors flex items-center gap-1 text-xs font-bold"
                        title="WhatsApp"
                      >
                        <MessageCircle size={18} /> Cobrar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Fatura de Inadimplência">
        {selectedSnowball && (
          <div className="space-y-6">
            <div className="bg-red-50 p-5 rounded-2xl border border-red-200 shadow-inner">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900 leading-none mb-1">{selectedSnowball.client}</h3>
                  {getNickname(clients.find(c => c.name === selectedSnowball.client)?.observations) && (
                      <p className="text-xs font-bold text-blue-800 mb-1">
                          {getNickname(clients.find(c => c.name === selectedSnowball.client)?.observations)}
                      </p>
                  )}
                  <p className="text-[10px] text-red-600 font-bold tracking-widest uppercase">Contrato #{selectedSnowball.id}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Dívida Total Atualizada</p>
                  <p className="text-3xl font-black text-red-700">R$ {formatMoney(selectedSnowball.snowball.totalUpdated)}</p>
                </div>
              </div>
              <div className="flex gap-4 border-t border-red-200/50 pt-4">
                <div className="flex-1 bg-white p-3 rounded-xl border border-red-100 text-center">
                  <span className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Parcelas</span>
                  <span className="text-lg font-black text-slate-800">{selectedSnowball.snowball.missedInstallments.length}</span>
                </div>
                <div className="flex-1 bg-white p-3 rounded-xl border border-red-100 text-center">
                  <span className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Original</span>
                  <span className="text-lg font-black text-slate-800">R$ {formatMoney(selectedSnowball.snowball.totalOriginal)}</span>
                </div>
                <div className="flex-1 bg-white p-3 rounded-xl border border-red-100 text-center">
                  <span className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Juros/Multa</span>
                  <span className="text-lg font-black text-red-600">+ R$ {formatMoney(selectedSnowball.snowball.totalUpdated - selectedSnowball.snowball.totalOriginal)}</span>
                </div>
              </div>
            </div>
            <div className="pt-2">
              <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2"><List size={16} /> Detalhamento Mês a Mês</h4>
              <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-100 text-[10px] uppercase text-slate-500">
                    <tr><th className="p-3">Vencimento</th><th className="p-3 text-right">Principal</th><th className="p-3 text-right text-red-500">Mora/Multa</th><th className="p-3 text-right font-black">Total</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {selectedSnowball.snowball.missedInstallments.map((inst: any, idx: number) => (
                        <tr key={idx} className="hover:bg-white transition-colors">
                          <td className="p-3 font-bold text-slate-700">{new Date(inst.date + "T12:00:00").toLocaleDateString("pt-BR")}</td>
                          <td className="p-3 text-right text-slate-500">R$ {formatMoney(inst.original)}</td>
                          <td className="p-3 text-right text-red-500 font-bold">+ R$ {formatMoney(inst.updated - inst.original)}</td>
                          <td className="p-3 text-right font-black text-slate-800">R$ {formatMoney(inst.updated)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-3 text-slate-600 font-bold hover:bg-slate-100 rounded-xl transition-all">Fechar</button>
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  getMessageText(selectedSnowball.client, selectedSnowball.diffDays, selectedSnowball.snowball.totalUpdated, selectedSnowball.nextDue, selectedSnowball, selectedSnowball.snowball);
                }}
                className="px-6 py-3 bg-[#25D366] text-white rounded-xl font-bold flex items-center gap-2 hover:bg-[#128C7E] transition-all shadow-lg"
              >
                <MessageCircle size={18} /> Cobrar via WhatsApp
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={isConfirmModalOpen} onClose={() => setIsConfirmModalOpen(false)} title="Confirmar Mensagem de Cobrança">
        <div className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
            <label className="block text-xs font-bold text-blue-700 uppercase mb-2">Mensagem que será enviada:</label>
            <textarea className="w-full h-40 p-3 rounded-lg border border-blue-200 focus:ring-2 focus:ring-blue-500 outline-none text-slate-700 text-sm" value={editableMessage} onChange={(e) => setEditableMessage(e.target.value)} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setIsConfirmModalOpen(false)} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-100 rounded-lg transition-all">Cancelar</button>
            <button className="px-6 py-2 bg-green-600 text-white rounded-lg font-bold flex items-center gap-2 hover:bg-green-700 shadow-md"
              onClick={() => {
                if (pendingAction) {
                  handleWhatsApp(pendingAction.loan, pendingAction.snowball, editableMessage);
                  setIsConfirmModalOpen(false);
                }
              }}
            >
              <MessageCircle size={18} /> Confirmar e Enviar
            </button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
};

export default Overdue;