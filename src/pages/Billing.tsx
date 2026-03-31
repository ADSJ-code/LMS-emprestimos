import { useState, useEffect, useMemo } from 'react';
import { 
  Search, Plus, AlertCircle, CheckCircle, Clock, Trash2,
  MoreVertical, Loader2, RefreshCw, ShieldAlert, ShieldCheck, 
  Calculator, FileText, Check, ChevronRight, DollarSign, 
  Printer, Eye, TrendingUp, TrendingDown, History, Download, Calendar, AlertTriangle, Info, PartyPopper, UserCheck,
  Percent, Landmark, CreditCard, Repeat, BellRing, X, FileSignature, Filter, MessageCircle, Users, Send, Home, Layers,
  Hash, Database, Edit
} from 'lucide-react';

import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

import { generateContractPDF, generatePromissoryPDF } from '../utils/generatePDF';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { calculateOverdueValue, formatMoney, calculateRealBalance, calculateInstallmentBreakdown, calculateCapitalBalance } from '../utils/finance';
import { loanService, clientService, affiliateService, settingsService, Loan, Client, PaymentRecord, Affiliate } from '../services/api';

interface LoanExtended extends Loan {
  diffDays: number;
  snowball: {
    totalOriginal: number;
    totalUpdated: number;
    missedInstallments: any[];
  };
}
type LoanFlowStep = 'closed' | 'form';

const getApiUrl = localStorage.getItem("getApiUrl") || "https://creditnow-prod-266321031136.us-central1.run.app";

const getInstanceToken = async (
   targetName: string,
   targetPhone: string,
 ): Promise<{ instanceName: string; apikey: string } | null> => {
   try {
     const response = await fetch(getApiUrl+ "/api/instances/ver", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ name: targetName, phone: targetPhone }),
     });

     if (!response.ok) {
       const errorText = await response.text();
       throw new Error(`Erro HTTP ${response.status}: ${errorText}`);
     }

     const data = await response.json();
     const list = Array.isArray(data) ? data : data.data || data.instances || [];

     if (list.length === 0) {
       return null;
     }

     const targetInstance = list.find((inst: any) =>
       inst.instance?.instanceName?.toString().trim().toLowerCase() ===
       targetName.trim().toLowerCase()
     );

     if (targetInstance?.instance?.instanceName && targetInstance?.instance?.apikey) {
       return { instanceName: targetInstance.instance.instanceName, apikey: targetInstance.instance.apikey };
     }

     const fallback = list.find((inst: any) => inst.instance?.status === "open");
     if (fallback?.instance?.instanceName && fallback?.instance?.apikey) {
       return { instanceName: fallback.instance.instanceName, apikey: fallback.instance.apikey };
     }

     return null;
   } catch (error) {
     return null;
   }
 };
 
const sendWhatsappApi = async (
  name: string,
  phone: string,
  contract: string,
  lateDays: number,
  updatedAmount: number,
  dateVencimento: string,
  companyName: string,
  token: string,
) => {
  const response = await fetch(getApiUrl+"/api/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userConectado: companyName,
      phone: phone,
      delay: 2,
      name: name,
      lateDays: lateDays,
      updatedAmount: updatedAmount,
      apiKey: token,
      dateVencimento: dateVencimento,
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

const Billing = () => {
  const [loanFlowStep, setLoanFlowStep] = useState<LoanFlowStep>('closed'); 
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isAgreementModalOpen, setIsAgreementModalOpen] = useState(false);
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);
  
  
  const [isEditContractModalOpen, setIsEditContractModalOpen] = useState(false);
  const [editContractData, setEditContractData] = useState<any>({});

  const [collectionDate, setCollectionDate] = useState(new Date().toISOString().split('T')[0]);

  const [detailTab, setDetailTab] = useState<'info' | 'schedule' | 'history'>('info');

  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  
  const [statusFilter, setStatusFilter] = useState<'Todos' | 'Em Dia' | 'Atrasado' | 'Quitado' | 'Acordo' | 'PagosNoPeriodo'>('Todos');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]); 

  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [isSimulating, setIsSimulating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [companySettings, setCompanySettings] = useState<any>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const s = await settingsService.get();
        setCompanySettings(s);
      } catch (err) { console.error("Erro ao carregar configurações", err); }
    };
    loadSettings();
  }, []);

  const [payDate, setPayDate] = useState(''); 
  const [payCapital, setPayCapital] = useState(''); 
  const [payInterest, setPayInterest] = useState(''); 
  const [payTotal, setPayTotal] = useState(0); 
  const [settleInterest, setSettleInterest] = useState(false);
  const [cycleAcc, setCycleAcc] = useState({ interest: 0, capital: 0 }); 

  const [agreementDate, setAgreementDate] = useState('');
  const [agreementValue, setAgreementValue] = useState('');

  const [availableClients, setAvailableClients] = useState<Client[]>([]);
  const [availableAffiliates, setAvailableAffiliates] = useState<Affiliate[]>([]);
  const [summary, setSummary] = useState({ today: 0, overdue: 0, received: 0 });
  const [loans, setLoans] = useState<Loan[]>([]);
  const [collectionLoans, setCollectionLoans] = useState<Loan[]>([]);
  const [todaysLoans, setTodaysLoans] = useState<Loan[]>([]);

  const [formData, setFormData] = useState({ 
      manualID: '', isMigration: false,
      initialPaidCapital: '', initialPaidInterest: '',
      manualInstallmentCapital: '', manualInstallmentInterest: '',
      client: '', amount: '', interestRate: '', installments: '', startDate: '',
      firstPaymentDate: '', frequency: 'MENSAL', fineRate: '', moraInterestRate: '', 
      clientBank: '', paymentMethod: '', interestType: 'PRICE', 
      hasGuarantor: false, guarantorName: '', guarantorCPF: '', guarantorAddress: '',
      guarantorHouseType: 'CASA', guarantorNumber: '', guarantorBlock: '', guarantorFloor: '',
      hasAffiliate: false, affiliateName: '', affiliateFee: '', affiliateNotes: '',
      isMultiDate: false, multiDates: [{ day: '', amount: '' }] as { day: string, amount: string }[]
  });
  
  useEffect(() => {
    if (formData.client && availableClients.length > 0) {
        const clientProfile = availableClients.find(c => c.name === formData.client);
        
        let pKey = '';
        let bName = '';

        if (clientProfile) {
            const obs = clientProfile.observations || '';
            const metaMatch = obs.match(/\[META:(.*?)\]/);
            if (metaMatch) {
                try {
                    const meta = JSON.parse(metaMatch[1]);
                    pKey = meta.pixKey || '';
                    bName = meta.bn || meta.bankName || '';
                } catch (e) {}
            } 
            if (!pKey) pKey = (clientProfile as any).pixKey || '';
            if (!bName) bName = (clientProfile as any).bankName || '';
        }

        const lastLoan = loans
          .filter(l => l.client === formData.client)
          .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];

        const defaultBank = bName || lastLoan?.clientBank || '';
        const defaultPix = pKey || lastLoan?.paymentMethod || '';

        setFormData(prev => ({
            ...prev,
            clientBank: defaultBank, 
            paymentMethod: defaultPix
        }));
    }
  }, [formData.client, availableClients, loans]);

  const filteredClientsForSelect = useMemo(() => {
      return availableClients.filter(c => 
        c.name.toLowerCase().includes(clientSearchTerm.toLowerCase()) ||
        c.cpf.includes(clientSearchTerm)
      );
  }, [availableClients, clientSearchTerm]);

  const formatDisplayDate = (dateString: string) => {
      if (!dateString) return '-';
      const cleanDate = dateString.split('T')[0];
      const [year, month, day] = cleanDate.split('-').map(Number);
      return new Date(year, month - 1, day).toLocaleDateString('pt-BR');
  };

  const handleWhatsApp = async (loan: LoanExtended, snowball: any) => {
    const confirmMessage = window.confirm(`Tem certeza que deseja enviar uma mensagem de cobrança para ${loan.client}?`);
    if (!confirmMessage) return;

    let companyName = localStorage.getItem("companyName") || "";
    let companyPhone = localStorage.getItem("companyPhone") || "";
    if (!companyName || !companyPhone) {
      try {
        const s = await settingsService.get();
        if (s?.company?.name) {
          companyName = s.company.name;
          localStorage.setItem("companyName", companyName);
        }
        if (s?.company?.phone) {
          companyPhone = s.company.phone.replace(/\D/g, "");
          localStorage.setItem("companyPhone", companyPhone);
        }
      } catch (_) {}
    }

    const client = availableClients.find((c) => c.name === loan.client);

    if (!client || !client.phone) {
      alert("❌ Erro: Telefone do cliente não encontrado.");
      return;
    }

    const cleanPhone = client.phone.replace(/\D/g, "");
    const firstName = loan.client.split(" ")[0];
    const contractCode = `CTR-${loan.id?.substring(0, 6).toUpperCase()}`;
    const diffDays = loan.diffDays || 0;
    const formattedDate = formatDisplayDate(loan.nextDue);

    try {
      const instance = await getInstanceToken(companyName, companyPhone);

      if (!instance) {
        throw new Error(`Instância WhatsApp não encontrada.`);
      }
      await sendWhatsappApi(
        client.name,
        cleanPhone,
        contractCode,
        diffDays,
        loan.installmentValue,
        formattedDate,
        instance.instanceName,
        instance.apikey,
      );
      alert(`✅ Mensagem enviada com sucesso para ${firstName}!`);
    } catch (error: any) {
      if (error?.message === "WHATSAPP_DISCONNECTED") {
        alert("⚠️ WhatsApp desconectado!\n\nVá em Configurações → WhatsApp e reconecte o QR Code para voltar a enviar mensagens.");
        return;
      }
      const message = `Olá, ${client.name}! Tudo bem? Passando para lembrar do vencimento da sua parcela no valor de R$ ${formatMoney(loan.installmentValue)} no dia ${formattedDate}. Qualquer dúvida, estamos à disposição!`;
      const url = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(message)}`;
      window.open(url, "_blank");
    }
  };

  const [simulation, setSimulation] = useState({ installment: 0, totalInterest: 0, totalPayable: 0, isValid: false });

  // --- MOTOR DE CÁLCULO TRAVADO E LINEAR ---
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
                    capitalPaidInThisCycle += (h.capitalPaid || 0);
                }
            });
        }

        const principalAtStartOfMonth = (loan.amount - (loan.totalPaidCapital || 0)) + capitalPaidInThisCycle;
        let periodRate = loan.interestRate / 100;
        if (loan.frequency === 'SEMANAL') periodRate /= 4;
        else if (loan.frequency === 'DIARIO') periodRate /= 30;

        const dynamicInterest = principalAtStartOfMonth * periodRate;
        let extraAcordo = 0;
        if (loan.status === 'Acordo' && (loan.agreementValue || 0) > 0) extraAcordo = loan.agreementValue || 0;
        
        return { interest: dynamicInterest + extraAcordo, capital: 0, total: dynamicInterest + extraAcordo };
        
    } else {
        const totalReceivable = loan.amount + (loan.projectedProfit || 0);
        const originalInstallments = Math.max(1, Math.round(totalReceivable / loan.installmentValue));
        const flatInterest = (loan.projectedProfit || 0) / originalInstallments;
        const flatCapital = loan.installmentValue - flatInterest;

        let extraAcordo = 0;
        if (loan.status === 'Acordo' && (loan.agreementValue || 0) > 0) extraAcordo = loan.agreementValue || 0;

        return { 
            interest: Math.max(0, flatInterest) + extraAcordo, 
            capital: Math.max(0, flatCapital), 
            total: loan.installmentValue + extraAcordo
        };
    }
  };

  useEffect(() => {
    const handleGlobalClick = () => setOpenMenuId(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  const fetchLoans = async () => {
    setIsLoadingList(true);
    try { 
      const [clientsData, loansData, affiliatesData] = await Promise.all([
          clientService.getAll(),
          loanService.getAll(),
          affiliateService.getAll().catch(() => []) 
      ]);
      setAvailableClients(clientsData || []); 
      setLoans(loansData || []);
      setAvailableAffiliates(affiliatesData || []);
    } catch (err) {} 
    finally { setIsLoadingList(false); }
  };

  useEffect(() => { 
      fetchLoans(); 
      const searchClient = sessionStorage.getItem('searchClient');
      if (searchClient) {
          setSearchTerm(searchClient);
          sessionStorage.removeItem('searchClient');
      }
  }, []);

  const getLoanRealStatus = (loan: Loan) => {
    if (loan.status === 'Pago' || loan.status === 'Quitado') return 'Quitado'; 
    if (loan.status === 'Acordo') return 'Acordo';
    const balance = loan.amount - (loan.totalPaidCapital || 0);
    if (balance <= 0.10) return 'Quitado'; 
    const today = new Date();
    const todayStr = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    const dueStr = loan.nextDue.split('T')[0];
    if (dueStr < todayStr) return 'Atrasado';
    return 'Em Dia';
  };

  const getLastPaymentDate = (loan: Loan) => {
      if (!loan.history || loan.history.length === 0) return '-';
      const paymentsOnly = loan.history.filter(h => h.amount > 0 && !h.type.toLowerCase().includes('abertura'));
      if (paymentsOnly.length === 0) return '-';
      const sorted = paymentsOnly.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const last = sorted[0];
      const dateObj = new Date(last.date);
      dateObj.setMinutes(dateObj.getMinutes() + dateObj.getTimezoneOffset());
      return dateObj.toLocaleDateString('pt-BR');
  }

 const handleMassMessage = async () => {
   if (selectedIds.length === 0) return;

   const confirmMass = window.confirm(
     `Você está prestes a abrir o WhatsApp para ${selectedIds.length} cliente(s).\n\nDeseja continuar? (O navegador pode bloquear se forem muitas abas, você precisará permitir pop-ups)`,
   );
   if (!confirmMass) return;

   const selectedLoansData = loans.filter((l) => selectedIds.includes(l.id));

   for (let i = 0; i < selectedLoansData.length; i++) {
     const loan = selectedLoansData[i];
     const client = availableClients.find((c) => c.name === loan.client);

     if (client && client.phone) {
       const cleanPhone = client.phone.replace(/\D/g, "");
       const formattedDate = formatDisplayDate(loan.nextDue);
       const status = getLoanRealStatus(loan);

       let message = `Olá, ${client.name}! Tudo bem? Passando para lembrar do vencimento da sua parcela no valor de R$ ${formatMoney(loan.installmentValue)} no dia ${formattedDate}. Qualquer dúvida, estamos à disposição!`;

       if (status === "Atrasado") {
         message = `Olá, ${client.name}! Consta em nosso sistema uma parcela em atraso referente ao dia ${formattedDate}. Por favor, entre em contato para regularizarmos a situação.`;
       }

       const url = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(message)}`;
       window.open(url, "_blank");

       await new Promise((resolve) => setTimeout(resolve, 800));
     }
   }
   setSelectedIds([]);
 };

  const renderSchedule = (loan: Loan) => {
      const historyPayments = (loan.history || []).filter(h => h.type === 'Parcela' || h.type === 'Amortização' || h.type === 'Juros');
      const isSimple = loan.interestType === 'SIMPLE';
      const totalOriginal = isSimple ? '∞' : loan.installments + historyPayments.length;

      const schedule = [];

      historyPayments.forEach((p, idx) => {
          const originalDateStr = p.originalDueDate ? `(Vencimento Original: ${formatDisplayDate(p.originalDueDate)})` : '';
          
          schedule.push({
              id: `paid-${idx}`, num: idx + 1, label: `Parcela ${idx + 1}${!isSimple ? ` de ${totalOriginal}` : ''}`,
              date: p.date, dateLabel: 'Pago em', amount: p.amount, status: 'Pago',
              note: originalDateStr
          });
      });

      if (loan.status !== 'Pago' && loan.status !== 'Quitado') {
          const [y, m, d] = loan.nextDue.split('T')[0].split('-').map(Number);
          const today = new Date();
          today.setHours(0,0,0,0);
          
          for (let i = 0; i < loan.installments; i++) {
              const stepDate = new Date(y, m - 1, d);
              if (loan.frequency === 'SEMANAL') stepDate.setDate(stepDate.getDate() + (7 * i));
              else if (loan.frequency === 'DIARIO') stepDate.setDate(stepDate.getDate() + (1 * i));
              else stepDate.setMonth(stepDate.getMonth() + (1 * i));

              const isFirst = i === 0;
              let status = 'Pendente';
              
              // BLINDAGEM: Garante que o valor inicial seja número
              let amountToDisplay = isSimple ? getSyncedBreakdown(loan).total : Number(loan.installmentValue || 0);
              let noteStr = '';

              if (stepDate < today) {
                  status = 'Atrasado';
                  const baseAmount = (isFirst && loan.status === 'Acordo') ? amountToDisplay + Number(loan.agreementValue || 0) : amountToDisplay;
                  const stepDateStr = stepDate.toISOString().split('T')[0];
                  
                  // BLINDAGEM MÁXIMA PARA O TYPESCRIPT: Envelopando todos os 4 campos matemáticos em Number()
                  amountToDisplay = calculateOverdueValue(
                      Number(baseAmount || 0), 
                      stepDateStr, 
                      'Atrasado', 
                      Number(loan.fineRate || 0), 
                      Number(loan.moraInterestRate || 0), 
                      Number(loan.amount || 0)
                  );
                  
              } else if (isFirst && loan.status === 'Acordo') {
                  status = 'Acordo';
                  amountToDisplay = amountToDisplay + Number(loan.agreementValue || 0);
                  
                  const lastAgreement = loan.history?.filter(h => h.type === 'Acordo').slice(-1)[0];
                  if (lastAgreement?.originalDueDate) {
                      noteStr = `Vencimento Original: ${formatDisplayDate(lastAgreement.originalDueDate)}`;
                  } else {
                      noteStr = `Acordo (+ R$ ${formatMoney(loan.agreementValue || 0)})`;
                  }
              }

              schedule.push({
                  id: `pend-${i}`, num: historyPayments.length + i + 1, label: `Parcela ${historyPayments.length + i + 1}${!isSimple ? ` de ${totalOriginal}` : ''}`,
                  date: stepDate.toISOString(), dateLabel: 'Vencimento', amount: amountToDisplay, status: status,
                  note: noteStr
              });
              if (isSimple && i > 11) break; 
          }
      }

      return (
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {schedule.map(item => (
                  <div key={item.id} className={`p-4 rounded-xl border flex items-center justify-between ${
                      item.status === 'Pago' ? 'bg-slate-50 border-slate-200 opacity-70' :
                      item.status === 'Atrasado' ? 'bg-red-50 border-red-200 shadow-sm' :
                      item.status === 'Acordo' ? 'bg-orange-50 border-orange-200 shadow-sm' : 'bg-white border-blue-100 shadow-sm'
                  }`}>
                      <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                              item.status === 'Pago' ? 'bg-slate-200 text-slate-500' : item.status === 'Atrasado' ? 'bg-red-100 text-red-600' :
                              item.status === 'Acordo' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'
                          }`}>{item.num}</div>
                          <div>
                              <p className={`font-bold text-sm ${item.status === 'Pago' ? 'text-slate-500' : 'text-slate-800'}`}>
                                  {item.label}
                                  {item.note && <span className="block text-[10px] text-blue-500 font-bold mt-0.5">{item.note}</span>}
                              </p>
                              <p className="text-[10px] text-slate-400 font-mono mt-0.5">{item.dateLabel}: {formatDisplayDate(item.date)}</p>
                          </div>
                      </div>
                      <div className="text-right">
                          <p className={`font-black text-sm ${
                              item.status === 'Atrasado' ? 'text-red-600' : item.status === 'Acordo' ? 'text-orange-600' :
                              item.status === 'Pago' ? 'text-slate-500' : 'text-slate-700'
                          }`}>R$ {formatMoney(item.amount)}</p>
                          <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                              item.status === 'Pago' ? 'bg-slate-200 text-slate-500' : item.status === 'Atrasado' ? 'bg-red-100 text-red-600' :
                              item.status === 'Acordo' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'
                          }`}>{item.status}</span>
                      </div>
                  </div>
              ))}
          </div>
      );
  };

  useEffect(() => {
    const today = new Date();
    const todayStr = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    
    const dueToday = loans.filter(l => {
       const dStr = l.nextDue.split('T')[0];
       return dStr === todayStr && l.status !== 'Pago' && l.status !== 'Quitado';
    });
    setTodaysLoans(dueToday);

    const targetStr = collectionDate;
    const list = loans.filter(l => l.nextDue.split('T')[0] === targetStr && l.status !== 'Pago' && l.status !== 'Quitado');
    setCollectionLoans(list);

    const totalOverdue = loans.reduce((acc, l) => {
      if (l.status === 'Pago' || l.status === 'Quitado') return acc;
      const realStatus = getLoanRealStatus(l);
      if (realStatus === 'Atrasado') {
          // BLINDAGEM PARA O TYPESCRIPT: Força número base
          const baseVal = l.interestType === 'SIMPLE' ? getSyncedBreakdown(l).total : Number(l.installmentValue || 0);
          
          const val = calculateOverdueValue(
              Number(baseVal || 0), 
              l.nextDue, 
              'Atrasado', 
              Number(l.fineRate || 0), 
              Number(l.moraInterestRate || 0), 
              Number(l.amount || 0)
          );
          return acc + val;
      }
      return acc;
    }, 0);
    
    const totalProfit = loans.reduce((acc, l) => acc + (l.totalPaidInterest || 0), 0);
    const totalTodayValue = dueToday.reduce((acc, l) => acc + (l.interestType === 'SIMPLE' ? getSyncedBreakdown(l).total : Number(l.installmentValue || 0)), 0);

    setSummary({ overdue: totalOverdue, received: totalProfit, today: totalTodayValue });
  }, [loans, collectionDate]);

// --- MATEMÁTICA REVERSA PARA CONTRATOS ANTIGOS (MIGRAÇÃO) ---
  useEffect(() => {
      if (!formData.isMigration) return;

      const amount = parseFloat(formData.amount) || 0;
      const manualJuros = parseFloat(formData.manualInstallmentInterest) || 0;

      if (amount > 0 && manualJuros > 0) {
          let taxPerPeriod = 0;
          taxPerPeriod = (manualJuros / amount) * 100;

          if (taxPerPeriod > 0) {
              let monthlyRate = taxPerPeriod;
              if (formData.frequency === 'SEMANAL') monthlyRate = taxPerPeriod * 4;
              else if (formData.frequency === 'DIARIO') monthlyRate = taxPerPeriod * 30;

              const formattedRate = monthlyRate.toFixed(2);
              
              if (formData.interestRate !== formattedRate) {
                  setFormData(prev => ({ ...prev, interestRate: formattedRate }));
              }
          }
      } else if (manualJuros === 0 && formData.interestRate !== '') {
          setFormData(prev => ({ ...prev, interestRate: '' }));
      }
  }, [
      formData.isMigration,
      formData.amount,
      formData.manualInstallmentInterest,
      formData.interestType,
      formData.frequency
  ]);

  // --- SIMULAÇÃO FINANCEIRA ---
  useEffect(() => {
    const amount = parseFloat(formData.amount) || 0; 
    const rateMonthly = parseFloat(formData.interestRate) || 0; 
    
    if (formData.isMigration) {
        const initCap = parseFloat(formData.initialPaidCapital) || 0;
        const mInt = parseFloat(formData.manualInstallmentInterest) || 0;
        const mCap = parseFloat(formData.manualInstallmentCapital) || 0;
        
        if (formData.interestType === 'SIMPLE') {
            const balance = Math.max(0, amount - initCap);
            let periodRate = rateMonthly / 100;
            if (formData.frequency === 'SEMANAL') periodRate /= 4;
            else if (formData.frequency === 'DIARIO') periodRate /= 30;

            const pmt = balance * periodRate;
                
            if (amount > 0 && formData.startDate) {
                setSimulation({ installment: pmt, totalInterest: 0, totalPayable: pmt + amount, isValid: true });
            } else {
                setSimulation({ installment: 0, totalInterest: 0, totalPayable: 0, isValid: false });
            }
        } else {
            const numInst = parseInt(formData.installments) || 0;
            const pmt = mCap + mInt;

            if (numInst > 0 && pmt > 0 && formData.startDate && amount > 0) {
                setSimulation({ installment: pmt, totalInterest: mInt * numInst, totalPayable: pmt * numInst, isValid: true });
            } else {
                setSimulation({ installment: 0, totalInterest: 0, totalPayable: 0, isValid: false });
            }
        }
        return;
    }

    const numInstallments = formData.interestType === 'SIMPLE' ? 1 : (parseInt(formData.installments) || 0);
    
    if (amount > 0 && numInstallments > 0 && rateMonthly >= 0 && formData.startDate) {
      setIsSimulating(true);
      const timeoutId = setTimeout(() => {
        let periodRate = rateMonthly / 100;
        
        if (formData.frequency === 'SEMANAL') periodRate = periodRate / 4;
        else if (formData.frequency === 'DIARIO') periodRate = periodRate / 30;

        let pmt = 0;
        let totalInt = 0;

        if (formData.interestType === 'SIMPLE') {
            pmt = amount * periodRate; 
            totalInt = pmt * numInstallments;
        } else {
            if (periodRate === 0) pmt = amount / numInstallments;
            else pmt = amount * ( (periodRate * Math.pow(1 + periodRate, numInstallments)) / (Math.pow(1 + periodRate, numInstallments) - 1) );
            totalInt = (pmt * numInstallments) - amount;
        }

        setSimulation({ 
            installment: pmt, totalInterest: totalInt, 
            totalPayable: pmt * numInstallments + (formData.interestType === 'SIMPLE' ? amount : 0), isValid: true 
        });
        setIsSimulating(false);
      }, 400);
      return () => clearTimeout(timeoutId);
    } else { 
        setSimulation({ installment: 0, totalInterest: 0, totalPayable: 0, isValid: false }); 
    }
  }, [formData.amount, formData.interestRate, formData.installments, formData.startDate, formData.interestType, formData.frequency, formData.isMigration, formData.manualInstallmentCapital, formData.manualInstallmentInterest, formData.initialPaidCapital, formData.initialPaidInterest]);

  // --- INTELIGÊNCIA MULTI-DATA: VALIDAÇÃO E DATA AUTOMÁTICA ---
  const isMultiDateInvalid = useMemo(() => {
    if (!formData.isMultiDate) return false;
    if (formData.isMigration) return false; 
    
    const sum = formData.multiDates.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
    return Math.abs(sum - simulation.installment) > 0.01;
  }, [formData.isMultiDate, formData.isMigration, formData.multiDates, simulation.installment]);
  
  useEffect(() => {
    if (formData.isMultiDate && formData.multiDates.length > 0) {
      const validDays = formData.multiDates
        .map(md => parseInt(md.day))
        .filter(d => !isNaN(d) && d > 0 && d <= 31);
      
      if (validDays.length > 0) {
        const maxDay = Math.max(...validDays);
        const baseDateStr = formData.startDate || new Date().toISOString().split('T')[0];
        const [year, month] = baseDateStr.split('-').map(Number);
        const newDate = new Date(year, month - 1, maxDay);
        const newDateStr = newDate.toISOString().split('T')[0];
        if (formData.firstPaymentDate !== newDateStr) {
          setFormData(prev => ({ ...prev, firstPaymentDate: newDateStr }));
        }
      }
    }
  }, [formData.isMultiDate, formData.multiDates, formData.startDate]);

  useEffect(() => {
      setSelectedIds([]);
  }, [searchTerm, statusFilter, filterStart, filterEnd]);

  const filteredLoans = useMemo(() => {
      return loans.filter(l => {
        const matchesSearch = (l.client || '').toLowerCase().includes(searchTerm.toLowerCase()) || (l.id || '').toLowerCase().includes(searchTerm.toLowerCase());
        const realStatus = getLoanRealStatus(l);
        let matchesStatus = true;
        if (statusFilter !== 'Todos') {
            if (statusFilter !== 'PagosNoPeriodo') matchesStatus = realStatus === statusFilter;
        }
        let matchesDate = true;
        if (filterStart && filterEnd) {
            if (statusFilter === 'PagosNoPeriodo') {
                if (!l.history) return false;
                matchesDate = l.history.some(h => {
                    if (h.amount <= 0 || h.type.toLowerCase().includes('abertura')) return false;
                    const hDate = h.date.split('T')[0];
                    return hDate >= filterStart && hDate <= filterEnd;
                });
            } else {
                const dueStr = l.nextDue.split('T')[0];
                matchesDate = dueStr >= filterStart && dueStr <= filterEnd;
            }
        } else if (statusFilter === 'PagosNoPeriodo') {
            matchesDate = false; 
        }
        return matchesSearch && matchesStatus && matchesDate;
      });
  }, [loans, searchTerm, statusFilter, filterStart, filterEnd]);

  const tableTotals = useMemo(() => {
      let capSum = 0;
      let intSum = 0;
      let expectedProfitSum = 0;
      let installmentSum = 0; // NOVA VARIÁVEL AQUI
      let count = 0;

      filteredLoans.forEach(loan => {
          if (selectedIds.includes(loan.id)) {
              intSum += (loan.totalPaidInterest || 0);
              const isSimple = loan.interestType === 'SIMPLE';
              const breakdown = getSyncedBreakdown(loan);
              
              // SOMA DA PARCELA FIXA
              installmentSum += isSimple ? breakdown.total : Number(loan.installmentValue || 0);
              
              if (filterStart && filterEnd && statusFilter !== 'PagosNoPeriodo') {
                  const dueDate = new Date(loan.nextDue.split('T')[0]);
                  const start = new Date(filterStart);
                  const end = new Date(filterEnd);
                  
                  if (dueDate >= start && dueDate <= end) {
                      capSum += breakdown.capital; 
                      expectedProfitSum += breakdown.interest;
                  }
              } else {
                  capSum += Math.max(0, loan.amount - (loan.totalPaidCapital || 0));
                  
                  if (isSimple) {
                      expectedProfitSum += breakdown.interest;
                  } else {
                      const totalExpected = loan.projectedProfit || ((loan.installmentValue * loan.installments) - loan.amount);
                      expectedProfitSum += Math.max(0, totalExpected - (loan.totalPaidInterest || 0));
                  }
              }
              count++;
          }
      });

      return { capital: capSum, interest: intSum, expectedProfit: expectedProfitSum, installment: installmentSum, count };
  }, [filteredLoans, selectedIds, filterStart, filterEnd, statusFilter]);
  const handleOpenPayment = (loan: Loan) => {
    setSelectedLoan(loan);
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    const localISOTime = (new Date(now.getTime() - offsetMs)).toISOString().slice(0, 16);
    setPayDate(localISOTime);

    const breakdown = getSyncedBreakdown(loan);
    const slices = (loan as any).multiDates || [];
    const status = getLoanRealStatus(loan);
    
    let totalPenalty = 0;
    if (status === 'Atrasado') {
        const fullOverdue = calculateOverdueValue(breakdown.total, loan.nextDue, 'Atrasado', Number(loan.fineRate || 0), Number(loan.moraInterestRate || 0), loan.amount);
        totalPenalty = fullOverdue - breakdown.total;
    }

    let autoCapital = '';
    let autoInterest = '';

    if (slices.length > 0) {
        const currentMonth = new Date(loan.nextDue).getMonth();
        const currentYear = new Date(loan.nextDue).getFullYear();
        
        const firstUnpaid = slices.find((s: any) => {
            return !(loan.history || []).some(h => {
                const hDue = h.originalDueDate ? new Date(h.originalDueDate) : new Date(h.date);
                return hDue.getMonth() === currentMonth && 
                       hDue.getFullYear() === currentYear && 
                       h.note?.includes(`Dia ${s.day}`);
            });
        });

        if (firstUnpaid) {
            const baseAmount = Number(firstUnpaid.amount) || 0;
            const ratio = baseAmount / (breakdown.total || 1);
            const sliceIntOriginal = breakdown.interest * ratio;
            const sliceCapOriginal = breakdown.capital * ratio;
            const slicePenalty = totalPenalty * ratio;

            autoCapital = sliceCapOriginal.toFixed(2);
            autoInterest = (sliceIntOriginal + slicePenalty).toFixed(2);
            (window as any).lastSelectedDay = firstUnpaid.day;
        }
    } else {
        autoCapital = breakdown.capital > 0 ? breakdown.capital.toFixed(2) : '';
        autoInterest = (breakdown.interest + totalPenalty) > 0 ? (breakdown.interest + totalPenalty).toFixed(2) : '';
    }

    setPayCapital(autoCapital);
    setPayInterest(autoInterest);
    setSettleInterest(false);

    let accInt = 0; let accCap = 0;
    if(loan.history) {
        const cycleStart = new Date(loan.nextDue);
        cycleStart.setMonth(cycleStart.getMonth() - 1);
        cycleStart.setHours(23, 59, 59, 999);
        for (let i = loan.history.length - 1; i >= 0; i--) {
            const h = loan.history[i];
            if (h.note?.includes('[CICLO COMPLETADO]') || h.type === 'Abertura') break;
            accInt += (h.interestPaid || 0);
            accCap += (h.capitalPaid || 0);
        }
    }
    setCycleAcc({ interest: accInt, capital: accCap });
    
    setIsDetailsOpen(false);
    setIsCollectionModalOpen(false);
    setIsPaymentModalOpen(true);
  };

  useEffect(() => {
      const c = parseFloat(payCapital) || 0;
      const i = parseFloat(payInterest) || 0;
      setPayTotal(c + i);
  }, [payCapital, payInterest]);

  const confirmPayment = async () => {
    if(!selectedLoan) return;

    const valCapital = parseFloat(payCapital) || 0;
    const valInterest = parseFloat(payInterest) || 0;
    const valTotal = valCapital + valInterest;
    if (valTotal < 0) { alert("Valor não pode ser negativo."); return; }

    const currentDebt = calculateCapitalBalance(selectedLoan);
    if (valCapital > (currentDebt + 0.05)) {
        const confirmFix = window.confirm(
            `⚠️ VALOR EXCEDENTE DETECTADO!\n\nO cliente deve apenas R$ ${formatMoney(currentDebt)} de Capital.\nVocê digitou R$ ${formatMoney(valCapital)}.\n\nDeseja ajustar automaticamente para quitar o contrato?`
        );
        if (confirmFix) {
            const excess = valCapital - currentDebt;
            setPayCapital(currentDebt.toFixed(2));
            setPayInterest((valInterest + excess).toFixed(2));
            return; 
        } else return; 
    }

    let updatedLoan = { ...selectedLoan };
    updatedLoan.totalPaidCapital = (updatedLoan.totalPaidCapital || 0) + valCapital;
    updatedLoan.totalPaidInterest = (updatedLoan.totalPaidInterest || 0) + valInterest;

    const balance = updatedLoan.amount - updatedLoan.totalPaidCapital;
    let noteText = `Baixa Manual. Ref: ${new Date(payDate).toLocaleString('pt-BR')}`;
    const originalDueStr = selectedLoan.nextDue; 
    const isSimple = selectedLoan.interestType === 'SIMPLE';

    const expectedInterest = getSyncedBreakdown(selectedLoan).interest;
    const totalRequiredInCycle = isSimple ? expectedInterest : selectedLoan.installmentValue;
    const totalAccumulatedInCycle = valTotal + cycleAcc.interest + cycleAcc.capital;
    
    let currentSliceDay = null;
    if ((window as any).lastSelectedDay) {
        currentSliceDay = (window as any).lastSelectedDay;
        noteText += ` [Pagamento Referente ao Dia ${currentSliceDay}]`;
        delete (window as any).lastSelectedDay;
    }

    let shouldAdvanceMonth = false;
    
    if (updatedLoan.multiDates && updatedLoan.multiDates.length > 0) {
        const currentMonth = new Date(originalDueStr).getMonth();
        const currentYear = new Date(originalDueStr).getFullYear();
        const paidDays = new Set<number>();
        
        if (updatedLoan.history) {
            updatedLoan.history.forEach(h => {
                const hDue = h.originalDueDate ? new Date(h.originalDueDate) : new Date(h.date);
                if (hDue.getMonth() === currentMonth && hDue.getFullYear() === currentYear) {
                    const match = h.note?.match(/Dia (\d+)/);
                    if (match) paidDays.add(Number(match[1]));
                }
            });
        }
        if (currentSliceDay !== null) paidDays.add(Number(currentSliceDay));
        shouldAdvanceMonth = paidDays.size >= updatedLoan.multiDates.length;
    } else {
        shouldAdvanceMonth = totalAccumulatedInCycle >= (totalRequiredInCycle - 1.0);
    }

    if (balance <= 0.10) {
        updatedLoan.status = 'Quitado';
        updatedLoan.installments = 0;
        if (isSimple) updatedLoan.installmentValue = 0;
        updatedLoan.totalPaidCapital = updatedLoan.amount;
        noteText += " [QUITAÇÃO TOTAL] [CICLO COMPLETADO]";
    } else {
        updatedLoan.status = 'Em Dia'; 
        
        if (shouldAdvanceMonth) {
             if (selectedLoan.status === 'Acordo') {
                 const startDate = new Date(selectedLoan.startDate);
                 startDate.setMinutes(startDate.getMinutes() + startDate.getTimezoneOffset());
                 const originalDay = startDate.getDate();
                 const payDateObj = new Date(payDate);
                 let nextMonth = payDateObj.getMonth() + 1;
                 let nextYear = payDateObj.getFullYear();
                 if (nextMonth > 11) { nextMonth = 0; nextYear++; }
                 const nextDueStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(originalDay).padStart(2, '0')}`;
                 updatedLoan.nextDue = nextDueStr;
                 updatedLoan.agreementValue = 0;
             } else {
                 const currentDue = new Date(updatedLoan.nextDue);
                 if (updatedLoan.frequency === 'SEMANAL') currentDue.setDate(currentDue.getDate() + 7);
                 else if (updatedLoan.frequency === 'DIARIO') currentDue.setDate(currentDue.getDate() + 1);
                 else currentDue.setMonth(currentDue.getMonth() + 1);
                 updatedLoan.nextDue = currentDue.toISOString().split('T')[0];
             }
             if (!isSimple) updatedLoan.installments = Math.max(0, (updatedLoan.installments || 0) - 1);
             noteText += " [CICLO COMPLETADO]";
        } else {
             updatedLoan.nextDue = originalDueStr;
             noteText += " [PAGAMENTO PARCIAL]";
        }

        if (isSimple && valCapital > 0) {
            let periodRate = updatedLoan.interestRate / 100;
            if (updatedLoan.frequency === 'SEMANAL') periodRate = periodRate / 4;
            else if (updatedLoan.frequency === 'DIARIO') periodRate = periodRate / 30;
            updatedLoan.installmentValue = balance * periodRate;

            if (updatedLoan.multiDates && updatedLoan.multiDates.length > 0) {
                const oldTotalSlices = updatedLoan.multiDates.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
                if (oldTotalSlices > 0) {
                    const newSlices = updatedLoan.multiDates.map(s => {
                        const ratio = (Number(s.amount) || 0) / oldTotalSlices;
                        return { ...s, amount: parseFloat((updatedLoan.installmentValue * ratio).toFixed(2)) };
                    });
                    const newTotal = newSlices.reduce((acc, s) => acc + s.amount, 0);
                    const diff = updatedLoan.installmentValue - newTotal;
                    if (diff !== 0) newSlices[newSlices.length - 1].amount = parseFloat((newSlices[newSlices.length - 1].amount + diff).toFixed(2));
                    updatedLoan.multiDates = newSlices;
                }
            }
        }
    }

    const newRecord: PaymentRecord = {
        date: new Date(payDate).toISOString(),
        amount: valTotal, capitalPaid: valCapital, interestPaid: valInterest,
        type: (valCapital > 0 && valInterest > 0) ? 'Parcela' : (valCapital > 0 ? 'Amortização' : 'Juros'),
        note: noteText, registeredAt: new Date().toISOString(),
        originalDueDate: originalDueStr 
    };

    updatedLoan.history = [...(selectedLoan.history || []), newRecord];

    try {
        await loanService.update(selectedLoan.id, updatedLoan, 'BAIXA DE PAGAMENTO', `Recebeu R$ ${valTotal.toFixed(2)} (Capital: R$ ${valCapital.toFixed(2)}, Juros: R$ ${valInterest.toFixed(2)}) do cliente ${selectedLoan.client}`);
        setLoans(prev => prev.map(l => l.id === updatedLoan.id ? updatedLoan : l));
        setIsPaymentModalOpen(false);
        setSelectedLoan(updatedLoan);
        setDetailTab('history');
        setIsDetailsOpen(true);
    } catch (err) { alert("Erro ao registrar."); }
  };

  const handleUndoLastPayment = async () => {
    if (!selectedLoan || !selectedLoan.history || selectedLoan.history.length === 0) return;

    const history = selectedLoan.history;
    const lastEntry = history[history.length - 1]; 

    const confirmUndo = window.confirm(`⚠️ ESTORNO DE REGISTRO\n\nDeseja desfazer o registro de ${lastEntry.type}?\n\nO vencimento voltará para: ${formatDisplayDate(lastEntry.originalDueDate || '')}`);
    if (!confirmUndo) return;

    let updatedLoan = { ...selectedLoan };
    updatedLoan.agreementValue = 0;
    updatedLoan.status = 'Em Dia'; 

    if (lastEntry.type !== 'Acordo') {
        updatedLoan.totalPaidCapital = Math.max(0, (updatedLoan.totalPaidCapital || 0) - (lastEntry.capitalPaid || 0));
        updatedLoan.totalPaidInterest = Math.max(0, (updatedLoan.totalPaidInterest || 0) - (lastEntry.interestPaid || 0));
        
        const isSimple = updatedLoan.interestType === 'SIMPLE';
        if (!isSimple && lastEntry.note?.includes('[CICLO COMPLETADO]')) updatedLoan.installments += 1;

        if (isSimple && (lastEntry.capitalPaid && lastEntry.capitalPaid > 0)) {
            const restoredBalance = updatedLoan.amount - updatedLoan.totalPaidCapital;
            let periodRate = updatedLoan.interestRate / 100;
            if (updatedLoan.frequency === 'SEMANAL') periodRate /= 4;
            else if (updatedLoan.frequency === 'DIARIO') periodRate /= 30;
            const oldInstallmentValue = updatedLoan.installmentValue || 1;
            const newInstallmentValue = restoredBalance * periodRate;

            if (updatedLoan.multiDates && updatedLoan.multiDates.length > 0) {
                const ratio = newInstallmentValue / oldInstallmentValue;
                updatedLoan.multiDates = updatedLoan.multiDates.map(md => ({
                    ...md, amount: Number((md.amount * ratio).toFixed(2))
                }));
            }
            updatedLoan.installmentValue = newInstallmentValue;
        }
    }

    if (lastEntry.originalDueDate) updatedLoan.nextDue = lastEntry.originalDueDate;
    updatedLoan.history = history.slice(0, -1);

    try {
        await loanService.update(selectedLoan.id, updatedLoan, 'ESTORNO DE REGISTRO', `Desfez o último registro de ${lastEntry.type} do cliente ${selectedLoan.client}.`);
        setLoans(prev => prev.map(l => l.id === updatedLoan.id ? updatedLoan : l));
        setSelectedLoan(updatedLoan);
    } catch (err) { alert("Erro ao sincronizar."); }
  };

  const handleOpenAgreement = (loan: Loan) => {
      setSelectedLoan(loan);
      setAgreementDate('');
      setAgreementValue(''); 
      setIsAgreementModalOpen(true);
      setOpenMenuId(null);
  };

  const confirmAgreement = async () => {
      if (!selectedLoan || !agreementDate || !agreementValue) return;
      let updatedLoan = { ...selectedLoan };
      
      const originalDateAntesDoAcordo = updatedLoan.nextDue;
      
      updatedLoan.status = 'Acordo';
      updatedLoan.nextDue = agreementDate;
      updatedLoan.agreementValue = parseFloat(agreementValue);
      
      const note = `ACORDO: Vencimento alterado de ${formatDisplayDate(originalDateAntesDoAcordo)} para ${formatDisplayDate(agreementDate)} com valor EXTRA de R$ ${formatMoney(parseFloat(agreementValue))}.`;
      
      updatedLoan.history = [...(selectedLoan.history || []), { 
          date: new Date().toISOString(), amount: 0, type: 'Acordo', note, capitalPaid: 0, interestPaid: 0,
          originalDueDate: originalDateAntesDoAcordo 
      }];
      
      try {
          await loanService.update(
              selectedLoan.id, 
              updatedLoan, 
              'NOVO ACORDO', 
              `Negociou com ${selectedLoan.client}. Vencimento alterado para ${formatDisplayDate(agreementDate)} com valor extra de R$ ${formatMoney(parseFloat(agreementValue))}.`
          );
          setLoans(prev => prev.map(l => l.id === updatedLoan.id ? updatedLoan : l));
          setIsAgreementModalOpen(false);
      } catch (e) { alert("Erro ao salvar acordo."); }
  };

const handleOpenEditContract = (loan: Loan) => {
      setSelectedLoan(loan);
      
      let displayInstallment = Number(loan.installmentValue || 0).toFixed(2);
      
      if (loan.interestType === 'SIMPLE') {
          let periodRate = loan.interestRate / 100;
          if (loan.frequency === 'SEMANAL') periodRate = periodRate / 4;
          else if (loan.frequency === 'DIARIO') periodRate = periodRate / 30;
          const currentBalance = Math.max(0, loan.amount - (loan.totalPaidCapital || 0));
          displayInstallment = (currentBalance * periodRate).toFixed(2);
      }

      setEditContractData({
          id: loan.id,
          amount: loan.amount.toString(),
          interestRate: loan.interestRate.toString(),
          installments: loan.interestType === 'SIMPLE' ? '1' : loan.installments.toString(),
          installmentValue: displayInstallment,
          startDate: loan.startDate ? loan.startDate.split('T')[0] : '',
          nextDue: loan.nextDue ? loan.nextDue.split('T')[0] : '',
          fineRate: (loan.fineRate || '').toString(),
          moraInterestRate: (loan.moraInterestRate || '').toString(),
          clientBank: loan.clientBank || '',
          paymentMethod: loan.paymentMethod || '',
          guarantorName: loan.guarantorName || '',
          guarantorCPF: loan.guarantorCPF || '',
          guarantorAddress: loan.guarantorAddress || ''
      });
      setIsEditContractModalOpen(true);
      setOpenMenuId(null);
  };

// Efeito para recalcular a parcela em tempo real durante a edição (Simples e Price)
  useEffect(() => {
      if (isEditContractModalOpen && selectedLoan) {
          const newAmount = parseFloat(editContractData.amount) || 0;
          const newRate = parseFloat(editContractData.interestRate) || 0;
          const newInstallments = parseInt(editContractData.installments) || 1;
          
          // BLINDAGEM: Só recalcula se o usuário alterar os dados base. 
          // Isso protege contratos migrados com valores de parcela customizados.
          const isSameAsOriginal = 
              newAmount === selectedLoan.amount && 
              newRate === selectedLoan.interestRate && 
              newInstallments === (selectedLoan.interestType === 'SIMPLE' ? 1 : selectedLoan.installments);

          if (isSameAsOriginal) return; 

          let periodRate = newRate / 100;
          if (selectedLoan.frequency === 'SEMANAL') periodRate = periodRate / 4;
          else if (selectedLoan.frequency === 'DIARIO') periodRate = periodRate / 30;

          let calculatedInstallment = 0;

          if (selectedLoan.interestType === 'SIMPLE') {
              const currentBalance = Math.max(0, newAmount - (selectedLoan.totalPaidCapital || 0));
              calculatedInstallment = currentBalance * periodRate;
          } else {
              // Fórmula PRICE
              if (periodRate === 0) {
                  calculatedInstallment = newAmount / newInstallments;
              } else {
                  calculatedInstallment = newAmount * ( (periodRate * Math.pow(1 + periodRate, newInstallments)) / (Math.pow(1 + periodRate, newInstallments) - 1) );
              }
          }

          // Corta para 2 casas decimais obrigatoriamente
          const newInstallmentValue = calculatedInstallment.toFixed(2);

          if (editContractData.installmentValue !== newInstallmentValue && calculatedInstallment > 0) {
              setEditContractData((prev: any) => ({ ...prev, installmentValue: newInstallmentValue }));
          }
      }
  }, [editContractData.amount, editContractData.interestRate, editContractData.installments, isEditContractModalOpen, selectedLoan]);
const confirmEditContract = async () => {
      if (!selectedLoan || !editContractData.id) return;
      
      if (editContractData.id !== selectedLoan.id && loans.some(l => l.id === editContractData.id)) {
          alert(`O ID ${editContractData.id} já existe em outro contrato.`);
          return;
      }
      
      const isSimple = selectedLoan.interestType === 'SIMPLE';
      const newAmount = parseFloat(editContractData.amount) || selectedLoan.amount;
      const newInterestRate = parseFloat(editContractData.interestRate) || selectedLoan.interestRate;
      
      let newInstallmentValue = parseFloat(editContractData.installmentValue) || selectedLoan.installmentValue;

      if (isSimple) {
          let periodRate = newInterestRate / 100;
          if (selectedLoan.frequency === 'SEMANAL') periodRate = periodRate / 4;
          else if (selectedLoan.frequency === 'DIARIO') periodRate = periodRate / 30;
          
          const currentBalance = Math.max(0, newAmount - (selectedLoan.totalPaidCapital || 0));
          newInstallmentValue = currentBalance * periodRate;
      }

      const updatedLoan = { 
          ...selectedLoan, 
          id: editContractData.id,
          amount: newAmount,
          interestRate: newInterestRate,
          installments: isSimple ? 1 : (parseInt(editContractData.installments) || selectedLoan.installments),
          installmentValue: newInstallmentValue,
          startDate: editContractData.startDate, 
          nextDue: editContractData.nextDue,
          fineRate: parseFloat(editContractData.fineRate) || 0,
          moraInterestRate: parseFloat(editContractData.moraInterestRate) || 0,
          clientBank: editContractData.clientBank,
          paymentMethod: editContractData.paymentMethod,
          guarantorName: editContractData.guarantorName,
          guarantorCPF: editContractData.guarantorCPF,
          guarantorAddress: editContractData.guarantorAddress
      };

      try {
          await loanService.update(
              selectedLoan.id,
              updatedLoan,
              'EDIÇÃO DE CONTRATO',
              `Ficha do contrato editada pelo painel.`
          );
          setLoans(prev => prev.map(l => l.id === selectedLoan.id ? updatedLoan : l));
          setIsEditContractModalOpen(false);
      } catch (e) {
          alert("Erro ao editar o contrato.");
      }
  };

  const handleExportExcel = async () => {
    const loansToExport = loans.filter(l => selectedIds.includes(l.id));

    if (loansToExport.length === 0) { 
        alert("Nenhum contrato selecionado. Por favor, marque as caixas (checkboxes) dos contratos que deseja exportar."); 
        return; 
    }
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Extrato de Recebimentos');
    
    worksheet.columns = [
        { header: 'Data da Baixa', key: 'paymentDate', width: 18 },
        { header: 'ID Contrato', key: 'id', width: 12 },
        { header: 'Cliente', key: 'client', width: 35 },
        { header: 'Tipo de Registro', key: 'type', width: 18 },
        { header: 'Valor Recebido Total', key: 'amount', width: 22 },
        { header: 'Capital (Amortizado)', key: 'capital', width: 20 },
        { header: 'Juros (Lucro)', key: 'interest', width: 20 },
        { header: 'Observação', key: 'note', width: 40 }
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    let hasRecords = false;

    loansToExport.forEach(loan => {
        if (loan.history && loan.history.length > 0) {
            loan.history.forEach(record => {
                if (record.amount > 0 || record.type === 'Abertura') {
                    hasRecords = true;
                    worksheet.addRow({
                        paymentDate: new Date(record.date).toLocaleDateString('pt-BR') + ' ' + new Date(record.date).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}),
                        id: loan.id, 
                        client: loan.client,
                        type: record.type,
                        amount: record.amount,
                        capital: record.capitalPaid || 0,
                        interest: record.interestPaid || 0,
                        note: record.note || '-'
                    });
                }
            });
        }
    });

    if (!hasRecords) {
        alert("Os contratos selecionados não possuem nenhum histórico de pagamento para gerar o extrato.");
        return;
    }

    const colunasMoeda = ['E', 'F', 'G'];
    colunasMoeda.forEach(col => { worksheet.getColumn(col).numFmt = '"R$" #,##0.00'; });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Extrato_Recebimentos_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`);
  };

  const toggleSelectAll = () => { if (selectedIds.length === filteredLoans.length) setSelectedIds([]); else setSelectedIds(filteredLoans.map(l => l.id)); };
  const toggleSelectOne = (id: string) => { setSelectedIds(prev => prev.includes(id) ? prev.filter(curr => curr !== id) : [...prev, id]); };
  
  const closeLoanFlow = () => {
      setLoanFlowStep('closed');
      setFormData({ 
        manualID: '', isMigration: false, 
        initialPaidCapital: '', initialPaidInterest: '',
        manualInstallmentCapital: '', manualInstallmentInterest: '',
        client: '', amount: '', interestRate: '', installments: '', startDate: '', firstPaymentDate: '', frequency: 'MENSAL', 
        fineRate: '', moraInterestRate: '', clientBank: '', paymentMethod: '', 
        interestType: 'PRICE', 
        hasGuarantor: false, guarantorName: '', guarantorCPF: '', guarantorAddress: '',
        guarantorHouseType: 'CASA', guarantorNumber: '', guarantorBlock: '', guarantorFloor: '',
        hasAffiliate: false, affiliateName: '', affiliateFee: '', affiliateNotes: '',
        isMultiDate: false, multiDates: [{ day: '', amount: '' }]
      });
  }

const handleFinalSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);

    try {
        let finalID = formData.manualID;

        if (!finalID) {
            const isPreContract = (document.getElementById('isPreContractCheckbox') as HTMLInputElement)?.checked;
            if (isPreContract) {
                let maxPreSeq = 0;
                loans.forEach(l => { 
                    const match = l.id.match(/^PRE-(\d+)/); 
                    if (match) { 
                        const seq = parseInt(match[1]); 
                        if(!isNaN(seq) && seq > maxPreSeq) maxPreSeq = seq; 
                    } 
                });
                finalID = `PRE-${(maxPreSeq + 1).toString().padStart(4, '0')}`;
            } else {
                let maxSeq = 0;
                loans.forEach(l => { 
                    const match = l.id.match(/^(\d+)$/); 
                    if (match) { 
                        const seq = parseInt(match[1]); 
                        if(!isNaN(seq) && seq > maxSeq) maxSeq = seq; 
                    } 
                });
                finalID = (maxSeq + 1).toString().padStart(4, '0');
            }
        }

        if (loans.some(l => l.id === finalID)) {
            alert(`O ID ${finalID} já está em uso por outro contrato.`);
            setIsSaving(false); return;
        }

        let nextDueDate = new Date(formData.firstPaymentDate || formData.startDate);
        if (!formData.firstPaymentDate) {
            if (formData.frequency === 'SEMANAL') nextDueDate.setDate(nextDueDate.getDate() + 7);
            else if (formData.frequency === 'DIARIO') nextDueDate.setDate(nextDueDate.getDate() + 1);
            else nextDueDate.setMonth(nextDueDate.getMonth() + 1);
        }

        let finalAmount = parseFloat(formData.amount) || 0;
        let finalInterestRate = parseFloat(formData.interestRate) || 0;
        let projectedProfit = 0;
        let finalInstallmentValue = 0;

        const isSimpleMode = formData.interestType === 'SIMPLE';
        const numInst = isSimpleMode ? 1 : (parseInt(formData.installments) || 1);

        if (formData.isMigration) {
            const initCap = parseFloat(formData.initialPaidCapital) || 0;
            const initInt = parseFloat(formData.initialPaidInterest) || 0;

            if (isSimpleMode) {
                 const balance = Math.max(0, finalAmount - initCap);
                 let periodRate = finalInterestRate / 100;
                 if (formData.frequency === 'SEMANAL') periodRate = periodRate / 4;
                 else if (formData.frequency === 'DIARIO') periodRate = periodRate / 30;
                 finalInstallmentValue = balance * periodRate;
                 projectedProfit = 0;
            } else {
                 const mCap = parseFloat(formData.manualInstallmentCapital) || 0;
                 const mInt = parseFloat(formData.manualInstallmentInterest) || 0;
                 finalInstallmentValue = mCap + mInt;
                 projectedProfit = (mInt * numInst) + initInt;
            }
        } else {
            finalInstallmentValue = simulation.installment;
            const totalReceivable = simulation.installment * numInst;
            projectedProfit = isSimpleMode ? totalReceivable : Math.max(0, totalReceivable - finalAmount);
        }

        const parseRate = (val: string) => { if (val === '') return 0; const num = parseFloat(val); return isNaN(num) ? 0 : num; };

        const fullGuarantorAddress = formData.hasGuarantor ? 
            `${formData.guarantorAddress}, nº ${formData.guarantorNumber}${formData.guarantorHouseType === 'APARTAMENTO' ? ` - Bloco ${formData.guarantorBlock}, Andar ${formData.guarantorFloor}` : ''}` 
            : '';

        const history: PaymentRecord[] = [
            { date: new Date().toISOString(), amount: finalAmount, type: 'Abertura', note: 'Empréstimo Concedido', registeredAt: new Date().toISOString() }
        ];

        if (formData.isMigration) {
            history.push({
                date: new Date().toISOString(),
                amount: (parseFloat(formData.initialPaidCapital) || 0) + (parseFloat(formData.initialPaidInterest) || 0),
                capitalPaid: parseFloat(formData.initialPaidCapital) || 0,
                interestPaid: parseFloat(formData.initialPaidInterest) || 0,
                type: 'Ajuste de Migração',
                note: 'Valores pagos antes da implantação do sistema.',
                registeredAt: new Date().toISOString()
            });
        }

const finalMultiDates = formData.isMultiDate ? formData.multiDates.map(md => {
            let amt = parseFloat(md.amount);
            
            // Se for migração, ajustamos as fatias para baterem com o finalInstallmentValue (o valor real do novo saldo)
            if (formData.isMigration && finalInstallmentValue > 0) {
                const totalManualMultiDates = formData.multiDates.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
                const ratio = finalInstallmentValue / (totalManualMultiDates || 1);
                amt = Number((amt * ratio).toFixed(2));
            }
            
            return {
                day: parseInt(md.day),
                amount: amt
            };
        }).filter(md => !isNaN(md.day) && !isNaN(md.amount)) : [];        const newLoan: Loan = {
            id: finalID, client: formData.client, amount: finalAmount, installments: numInst,
            interestRate: finalInterestRate, startDate: formData.startDate, nextDue: nextDueDate.toISOString().split('T')[0],
            status: 'Em Dia', installmentValue: finalInstallmentValue,
            fineRate: parseRate(formData.fineRate), moraInterestRate: parseRate(formData.moraInterestRate),
            clientBank: formData.clientBank, paymentMethod: formData.paymentMethod, justification: '',
            checklistAtApproval: [], 
            totalPaidCapital: formData.isMigration ? parseFloat(formData.initialPaidCapital) || 0 : 0,
            totalPaidInterest: formData.isMigration ? parseFloat(formData.initialPaidInterest) || 0 : 0,
            history: history, interestType: formData.interestType as 'PRICE' | 'SIMPLE', frequency: formData.frequency as 'MENSAL' | 'SEMANAL' | 'DIARIO', projectedProfit: projectedProfit,
            guarantorName: formData.hasGuarantor ? formData.guarantorName : '', 
            guarantorCPF: formData.hasGuarantor ? formData.guarantorCPF : '', 
            guarantorAddress: fullGuarantorAddress,
            affiliateName: formData.hasAffiliate ? formData.affiliateName : '', affiliateFee: formData.hasAffiliate ? parseFloat(formData.affiliateFee) : 0, affiliateNotes: formData.hasAffiliate ? formData.affiliateNotes : '',
            multiDates: finalMultiDates // ENVIANDO DATAS CORRETAMENTE
        };

        await loanService.create(newLoan as any);

        fetchLoans(); 
        closeLoanFlow();
    } catch (err) { 
        console.error(err);
        alert("Erro ao salvar o contrato."); 
    } finally { 
        setIsSaving(false); 
    }
  };

  const handleDelete = async (id: string) => { if (confirm('Deseja excluir?')) { try { await loanService.delete(id); fetchLoans(); setIsDetailsOpen(false); } catch (err) { alert("Erro ao excluir."); } } };

  return (
    <Layout>
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div><h2 className="text-2xl font-bold text-slate-800">Cobrança e Empréstimos</h2><p className="text-slate-500">Gestão financeira completa.</p></div>
        <div className="flex flex-wrap gap-2">
            <button onClick={() => setIsCollectionModalOpen(true)} className="flex items-center gap-2 bg-yellow-400 text-yellow-900 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-yellow-500 transition-colors shadow-lg shadow-yellow-400/20"><BellRing size={18} /> Cobrança</button>
            <button onClick={() => fetchLoans()} className="flex items-center gap-2 bg-white border border-gray-200 text-slate-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors font-bold shadow-sm"><RefreshCw className={isLoadingList ? "animate-spin" : ""} size={18} /></button>
            <button 
                onClick={() => setLoanFlowStep('form')} 
                className="flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 relative z-10"
            >
                <Plus size={20} /> Novo Contrato
            </button>
        </div>
      </header>

      <datalist id="bancos-sugestao">
          <option value="Itaú" />
          <option value="Bradesco" />
          <option value="Santander" />
          <option value="Nubank" />
          <option value="Inter" />
          <option value="Caixa Econômica" />
          <option value="Banco do Brasil" />
          <option value="C6 Bank" />
      </datalist>

      {isCollectionModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
             <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 border border-slate-200 relative z-[70]">
                 <div className="bg-slate-900 p-5 flex justify-between items-center">
                     <div className="flex items-center gap-2 text-white font-bold"><Calendar className="text-yellow-400" size={20}/> <span>Central de Cobrança</span></div>
                     <button onClick={() => setIsCollectionModalOpen(false)} className="text-white/50 hover:text-white transition-colors"><X size={24}/></button>
                 </div>
                 <div className="p-4 bg-slate-50 border-b border-slate-200">
                     <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Selecione a Data de Vencimento</label>
                     <input type="date" value={collectionDate} onChange={(e) => setCollectionDate(e.target.value)} className="w-full p-3 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"/>
                 </div>
                 <div className="p-4 max-h-[50vh] overflow-y-auto custom-scrollbar">
                     {collectionLoans.length === 0 ? (
                         <div className="text-center py-8">
                             <CheckCircle size={48} className="mx-auto text-green-500 mb-2 opacity-50"/>
                             <p className="text-slate-500 font-medium">Nenhum vencimento para esta data.</p>
                         </div>
                     ) : (
                         <div className="space-y-3">
                             <p className="text-xs font-bold uppercase text-slate-400 mb-2">Clientes para cobrar ({collectionLoans.length}):</p>
                             {collectionLoans.map(l => (
                                 <div key={l.id} className="flex justify-between items-center p-4 bg-white border border-slate-200 rounded-xl hover:bg-blue-50 hover:border-blue-300 transition-all cursor-pointer group shadow-sm" onClick={() => handleOpenPayment(l)}>
                                     <div className="flex items-center gap-3">
                                         <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold border border-slate-200">{l.client.charAt(0)}</div>
                                         <div>
                                             <p className="font-bold text-slate-800 text-sm group-hover:text-blue-700">{l.client}</p>
                                             <p className="text-[10px] text-slate-400 font-mono">Contrato: {l.id}</p>
                                         </div>
                                     </div>
                                     <div className="text-right">
                                         <p className="font-black text-green-600 text-sm">R$ {formatMoney(l.interestType === 'SIMPLE' ? getSyncedBreakdown(l).total : l.installmentValue)}</p>
                                         <p className="text-[10px] text-slate-400 uppercase font-bold">Cobrar</p>
                                     </div>
                                 </div>
                             ))}
                         </div>
                     )}
                 </div>
             </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-visible mb-8">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col gap-4 rounded-t-2xl">
          <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
              <div className="relative w-full xl:w-96">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                  <input type="text" placeholder="Buscar cliente..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500/20 transition-all shadow-sm"/>
              </div>
              <div className="flex gap-2 w-full xl:w-auto flex-wrap justify-end">
                  {selectedIds.length > 0 && (
                      <button onClick={handleMassMessage} className="flex items-center gap-2 bg-[#25D366] text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-[#128C7E] transition-colors shadow-lg shadow-green-900/10 animate-in fade-in zoom-in">
                          <Send size={18} /> Avisar Selecionados ({selectedIds.length})
                      </button>
                  )}

                  <select value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)} className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium outline-none cursor-pointer hover:bg-slate-50 transition-colors shadow-sm">
                      <option value="Todos">Todos</option>
                      <option value="Em Dia">Em Dia</option>
                      <option value="Atrasado">Atrasado</option>
                      <option value="Acordo">Em Acordo</option>
                      <option value="Quitado">Quitado (Finalizado)</option>
                      <option value="PagosNoPeriodo">Pagamentos no Período</option>
                  </select>

                  <button onClick={handleExportExcel} className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/10"><Download size={18} /> Exportar Selecionados</button>
              </div>
          </div>
          
          <div className="flex flex-wrap gap-4 items-end bg-white p-3 rounded-xl border border-slate-200 shadow-sm w-fit">
              <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Data Inicial</label>
                  <input type="date" value={filterStart} onChange={e => setFilterStart(e.target.value)} className="p-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"/>
              </div>
              <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Data Final</label>
                  <input type="date" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} className="p-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"/>
              </div>
              {(filterStart || filterEnd) && (
                  <button onClick={() => { setFilterStart(''); setFilterEnd(''); }} className="px-4 py-2 text-red-600 font-bold text-sm hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100">
                      Limpar
                  </button>
              )}
              {statusFilter === 'PagosNoPeriodo' && (!filterStart || !filterEnd) && (
                  <span className="text-xs text-orange-600 font-bold ml-2 bg-orange-50 px-3 py-2 rounded-lg border border-orange-200 animate-pulse">
                      ⚠️ Informe as datas para ver pagamentos.
                  </span>
              )}
          </div>
        </div>

        <div className="overflow-visible min-h-[400px]">
            <table className="w-full text-left">
            <thead>
                <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                    <th className="p-4 text-center w-10"><input type="checkbox" onChange={toggleSelectAll} checked={filteredLoans.length > 0 && selectedIds.length === filteredLoans.length} className="w-4 h-4 rounded border-gray-300 text-slate-900 cursor-pointer"/></th>
                    <th className="p-4">Cliente</th>
                    <th className="p-4 text-center">Parcelas</th>
                    <th className="p-4 text-center">Próx. Venc.</th>
                    <th className="p-4 text-center text-blue-600">Última Baixa</th>
                    <th className="p-4 text-right">Saldo Capital</th>
                    <th className="p-4 text-right text-green-600">Juros Pagos</th>
                    <th className="p-4 text-right text-slate-500">Parcela Fixa</th>
                    <th className="p-4 text-center">Status</th>
                    <th className="p-4 text-right">Ações</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
                {filteredLoans.length === 0 ? (<tr><td colSpan={10} className="p-8 text-center text-slate-400">Nenhum contrato encontrado.</td></tr>) : (filteredLoans.map(loan => {
                    const displayStatus = getLoanRealStatus(loan);
                    return (
                      <tr
                        key={loan.id}
                        className={`transition-colors group ${selectedIds.includes(loan.id) ? "bg-blue-50/50" : "hover:bg-slate-50/80"}`}
                      >
                        <td className="p-4 text-center">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(loan.id)}
                            onChange={() => toggleSelectOne(loan.id)}
                            className="w-4 h-4 rounded border-gray-300 text-slate-900 cursor-pointer"
                          />
                        </td>
                        <td className="p-4">
                          <div className="font-bold text-slate-800">
                            {loan.client}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {loan.id}
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold border border-slate-200">
                            {loan.installments}x
                          </span>
                        </td>
                        <td className="p-4 text-center">
                          <span
                            className={`font-bold text-sm ${displayStatus === "Atrasado" ? "text-red-600" : "text-slate-700"}`}
                          >
                            {formatDisplayDate(loan.nextDue)}
                          </span>
                        </td>

                        <td className="p-4 text-center text-sm font-bold text-blue-600">
                          {getLastPaymentDate(loan)}
                        </td>

                        <td className="p-4 text-right font-bold text-slate-700">
                          R${" "}
                          {formatMoney(
                            Math.max(
                              0,
                              loan.amount - (loan.totalPaidCapital || 0),
                            ),
                          )}
                        </td>

                        <td className="p-4 text-right font-bold text-green-600 bg-green-50/30 rounded">
                          R$ {formatMoney(loan.totalPaidInterest || 0)}
                        </td>
                        <td className="p-4 text-right font-bold text-slate-500">
                          R$ {formatMoney(loan.installmentValue)}
                        </td>

                        <td className="p-4 text-center">
                          <span
                            className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase shadow-sm ${
                              displayStatus === "Em Dia"
                                ? "bg-blue-50 text-blue-700 border border-blue-100"
                                : displayStatus === "Atrasado"
                                  ? "bg-red-50 text-red-700 border border-red-100"
                                  : displayStatus === "Acordo"
                                    ? "bg-orange-50 text-orange-700 border border-orange-100"
                                    : displayStatus === "Quitado"
                                      ? "bg-green-50 text-green-700 border border-green-100"
                                      : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {displayStatus}
                          </span>
                        </td>
                        <td className="p-4 text-right relative">
                          <button
                            onClick={() => {
                              const loanExt = loan as LoanExtended;
                              handleWhatsApp(loanExt, loanExt.snowball);
                            }}
                            className="p-2 bg-green-100 text-green-700 rounded-lg"
                            title="Whatsapp"
                          >
                            <MessageCircle size={18} />
                          </button>

                          <div className="relative inline-block text-left">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(
                                  openMenuId === loan.id ? null : loan.id,
                                );
                              }}
                              className={`p-2 rounded-lg transition-all ${openMenuId === loan.id ? "bg-slate-200 text-slate-900" : "text-slate-400 hover:text-slate-900 hover:bg-slate-100"}`}
                            >
                              <MoreVertical size={18} />
                            </button>
                            {openMenuId === loan.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-2xl border border-slate-100 z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right"
                              >
                                <div className="py-1">
                                  <button
                                    onClick={() => {
                                      setSelectedLoan(loan);
                                      setDetailTab("info");
                                      setIsDetailsOpen(true);
                                      setOpenMenuId(null);
                                    }}
                                    className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                  >
                                    <Eye size={16} className="text-blue-500" />{" "}
                                    Ver Detalhes
                                  </button>

                                  {displayStatus !== "Quitado" && (
                                    <>
                                      <button
                                        onClick={() => {
                                          handleOpenPayment(loan);
                                          setOpenMenuId(null);
                                        }}
                                        className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                      >
                                        <DollarSign
                                          size={16}
                                          className="text-green-600"
                                        />{" "}
                                        Registrar Baixa
                                      </button>
                                      <button
                                        onClick={() => {
                                          handleOpenAgreement(loan);
                                          setOpenMenuId(null);
                                        }}
                                        className="w-full text-left px-4 py-3 text-sm text-orange-700 hover:bg-orange-50 flex items-center gap-2"
                                      >
                                        <FileSignature size={16} /> Registrar
                                        Acordo
                                      </button>
                                    </>
                                  )}

                                  <button
                                    onClick={() => handleOpenEditContract(loan)}
                                    className="w-full text-left px-4 py-3 text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-2"
                                  >
                                    <Edit size={16} /> Editar Contrato
                                  </button>

                                  <div className="border-t border-slate-100 my-1"></div>
                                  <button
                                    onClick={() => {
                                      const c = availableClients.find(
                                        (cl) => cl.name === loan.client,
                                      );
                                      generateContractPDF(loan, c, companySettings);
                                      setOpenMenuId(null);
                                    }}
                                    className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                  >
                                    <Printer size={16} /> Contrato PDF
                                  </button>
                                  <button
                                    onClick={() => {
                                      const c = availableClients.find(
                                        (cl) => cl.name === loan.client,
                                      );
                                      generatePromissoryPDF(loan, c, companySettings);
                                      setOpenMenuId(null);
                                    }}
                                    className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                  >
                                    <FileText size={16} /> Promissórias
                                  </button>
                                  <div className="border-t border-slate-100 my-1"></div>
                                  <button
                                    onClick={() => {
                                      handleDelete(loan.id);
                                      setOpenMenuId(null);
                                    }}
                                    className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                  >
                                    <Trash2 size={16} /> Excluir
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                }))}
            </tbody>
            
            <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                <tr>
                    <td colSpan={5} className="p-4 text-right font-bold text-slate-500 uppercase tracking-widest text-xs">
                        Soma dos Selecionados ({tableTotals.count} contratos):
                    </td>
                    <td className="p-4 text-right font-black text-slate-800 text-lg" title="Soma do Saldo Devedor (Capital)">
                        R$ {formatMoney(tableTotals.capital)}
                    </td>
                    <td className="p-4 text-right font-black text-green-600 text-lg" title="Soma dos Juros já recebidos">
                        R$ {formatMoney(tableTotals.interest)}
                    </td>
                    <td className="p-4 text-right font-black text-slate-500 text-lg" title="Soma das Parcelas Fixas">
                        R$ {formatMoney(tableTotals.installment)}
                        <span className="block text-[9px] text-slate-400 font-bold mt-1 uppercase">Total Parcelas</span>
                    </td>
                    <td colSpan={2}></td>
                </tr>
            </tfoot>
            
            </table>
        </div>
      </div>

      <Modal isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Detalhes do Contrato">
        {selectedLoan && (
          <div className="space-y-6">
            <div className="flex border-b border-slate-200">
                <button onClick={() => setDetailTab('info')} className={`flex-1 pb-3 text-sm font-bold border-b-2 transition-all ${detailTab === 'info' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>Visão Geral</button>
                <button onClick={() => setDetailTab('schedule')} className={`flex-1 pb-3 text-sm font-bold border-b-2 transition-all ${detailTab === 'schedule' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>Cronograma</button>
                <button onClick={() => setDetailTab('history')} className={`flex-1 pb-3 text-sm font-bold border-b-2 transition-all ${detailTab === 'history' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>Extrato Financeiro</button>
            </div>
            
            {detailTab === 'info' ? (
                <>
                    <div className="bg-slate-900 p-6 rounded-2xl shadow-xl text-white relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10"><FileText size={64} /></div>
                        <h3 className="text-xl font-black mb-1">{selectedLoan.client}</h3>
                        <div className="flex gap-4 text-[10px] text-slate-400 font-mono uppercase tracking-widest mt-1"><span>ID: {selectedLoan.id}</span><span>•</span><span>Criado em: {formatDisplayDate(selectedLoan.startDate)}</span></div>
                        
                        <div className="mt-4 p-3 bg-slate-800/50 rounded-xl border border-slate-700 flex gap-4">
                            <div className="flex-1">
                                <span className="text-[10px] uppercase text-slate-400 font-bold block mb-1">Valor do Contrato</span>
                                <span className="text-sm font-bold text-blue-400">R$ {formatMoney(selectedLoan.amount)}</span>
                            </div>
                            <div className="w-px bg-slate-700"></div>
                            <div className="flex-1">
                                <span className="text-[10px] uppercase text-slate-400 font-bold block mb-1">Lucro Recebido Neste Contrato</span>
                                <span className="text-sm font-bold text-green-400">R$ {formatMoney(selectedLoan.totalPaidInterest || 0)}</span>
                            </div>
                        </div>

                        <div className="mt-6 flex gap-8">
                            <div><p className="text-[10px] uppercase text-slate-400 font-bold">Saldo Devedor (Deste Contrato)</p><p className="text-3xl font-bold text-white">R$ {formatMoney(calculateRealBalance(selectedLoan))}</p></div>
                            <div className="w-px bg-slate-700"></div>
                            <div>
                                <p className="text-[10px] uppercase text-slate-400 font-bold">Parcela Fixa</p>
                                <p className="text-2xl font-bold text-green-400">R$ {formatMoney(selectedLoan.interestType === 'SIMPLE' ? getSyncedBreakdown(selectedLoan).total : selectedLoan.installmentValue)}</p>
                                <div className="text-[10px] text-slate-400 mt-1 flex gap-3">
                                    <span>Juros do Mês: <b>R$ {formatMoney(getSyncedBreakdown(selectedLoan).interest)}</b></span>
                                </div>
                            </div>
                        </div>
                        <button onClick={() => handleWhatsApp(selectedLoan as LoanExtended, (selectedLoan as any).snowball)} className="mt-6 flex items-center gap-2 bg-[#25D366] text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-[#128C7E] transition-colors"><MessageCircle size={18}/> Chamar no WhatsApp</button>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-100">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2"><Info size={14}/> Ficha Técnica</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100"><span className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Modalidade</span><span className="text-xs font-bold text-slate-800 bg-white px-2 py-1 rounded border border-slate-200 inline-block">{selectedLoan.interestType === 'SIMPLE' ? 'Pag. Mínimo (Só Juros)' : 'Price / Linear'}</span></div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                <span className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1"><Repeat size={10}/> Periodicidade</span>
                                <span className="text-sm font-bold text-slate-800">{selectedLoan.frequency === 'DIARIO' ? 'Diário' : selectedLoan.frequency === 'SEMANAL' ? 'Semanal' : 'Mensal'}</span>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100"><span className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1"><Percent size={10}/> Taxa de Juros</span><span className="text-sm font-bold text-slate-800">{selectedLoan.interestRate}% a.m</span></div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100"><span className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1"><AlertTriangle size={10}/> Multa (Atraso)</span><span className="text-sm font-bold text-red-600">{selectedLoan.fineRate}%</span></div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100"><span className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1"><Clock size={10}/> Mora Diária</span><span className="text-sm font-bold text-red-600">{selectedLoan.moraInterestRate}% ao dia</span></div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100"><span className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1"><Landmark size={10}/> Banco</span><span className="text-sm font-bold text-slate-800 truncate" title={selectedLoan.clientBank}>{selectedLoan.clientBank || '-'}</span></div>
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100"><span className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1"><CreditCard size={10}/> Pagamento</span><span className="text-sm font-bold text-slate-800 truncate" title={selectedLoan.paymentMethod}>{selectedLoan.paymentMethod || '-'}</span></div>
                        </div>
                    </div>

                    {selectedLoan.guarantorName && (
                        <div className="mt-2 bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center gap-3">
                            <div className="bg-blue-100 p-2 rounded-full text-blue-600"><UserCheck size={18}/></div>
                            <div>
                                <span className="text-xs font-bold text-blue-400 uppercase block">Fiador Vinculado</span>
                                <span className="text-sm font-bold text-blue-900">{selectedLoan.guarantorName}</span>
                            </div>
                        </div>
                    )}
                </>
            ) : detailTab === 'schedule' ? (
                renderSchedule(selectedLoan)
            ) : (
                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {(!selectedLoan.history || selectedLoan.history.length === 0) ? (<div className="text-center py-10 text-slate-400 flex flex-col items-center"><History size={32} className="mb-2 opacity-50"/><p className="text-sm">Nenhum registro de pagamento encontrado.</p></div>) : (
                        <div className="relative border-l-2 border-slate-100 ml-3 space-y-6 py-2">
                            {selectedLoan.history.slice().reverse().map((record, idx) => {
                                const isOpening = record.type.toLowerCase().includes('abertura') || record.type.toLowerCase().includes('empréstimo');
                                const isAgreement = record.type.toLowerCase().includes('acordo');
                                return (
                                    <div key={idx} className="relative pl-6">
                                        <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white ${isOpening ? 'bg-green-500' : isAgreement ? 'bg-orange-500' : 'bg-blue-500'}`}></div>
                                        <div>
                                            <div className="flex justify-between items-start mb-1">
                                                <div className="flex flex-col items-start gap-1">
                                                    <p className="text-xs text-slate-400 font-mono">
                                                        {new Date(record.date).toLocaleDateString('pt-BR')} às {new Date(record.date).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}
                                                    </p>
                                                    
                                                    {record.originalDueDate && (
                                                        <span className="text-[10px] text-blue-700 font-black bg-blue-100 px-2 py-0.5 rounded border border-blue-200 uppercase tracking-tighter">
                                                            Vencimento Original: {formatDisplayDate(record.originalDueDate)}
                                                        </span>
                                                    )}

                                                    {idx === 0 && !isOpening && (
                                                        <button 
                                                            onClick={handleUndoLastPayment} 
                                                            className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded font-bold hover:bg-red-200 transition-colors flex items-center gap-1 mt-1 border border-red-200 shadow-sm"
                                                            title="Desfazer e estornar este registro"
                                                        >
                                                            <Trash2 size={10}/> Desfazer Registro
                                                        </button>
                                                    )}
                                                </div>
                                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${isOpening ? 'bg-blue-100 text-blue-700' : isAgreement ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>{record.type}</span>
                                            </div>
                                            
                                            {isAgreement ? (
                                                <div className="bg-orange-50 p-3 rounded-xl border border-orange-100 mt-2 shadow-inner">
                                                    <div className="flex justify-between items-center mb-1"><span className="text-xs font-bold text-orange-800">VALOR DO ACORDO:</span><span className="font-black text-orange-900">R$ {formatMoney(record.amount || 0)}</span></div>
                                                    {record.note && <p className="text-[10px] text-orange-700 font-medium mt-1 leading-tight">{record.note}</p>}
                                                </div>
                                            ) : (
                                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 mt-2 shadow-inner">
                                                    <div className="flex justify-between items-center mb-1 border-b border-slate-200 pb-1"><span className="text-xs font-bold text-slate-500">{isOpening ? 'VALOR CONCEDIDO:' : 'TOTAL PAGO:'}</span><span className="font-black text-slate-800">R$ {formatMoney(record.amount)}</span></div>
                                                    <div className="grid grid-cols-2 gap-2 mt-2"><div><span className="block text-[10px] uppercase text-slate-400 font-bold">Amortização</span><span className="text-xs font-bold text-slate-700">R$ {formatMoney(record.capitalPaid || 0)}</span></div><div><span className="block text-[10px] uppercase text-slate-400 font-bold">Lucro (Juros)</span><span className="text-xs font-bold text-green-600">R$ {formatMoney(record.interestPaid || 0)}</span></div></div>
                                                    {record.note && <p className="text-[10px] text-slate-400 italic mt-2 border-t border-slate-200 pt-1 leading-tight">{record.note}</p>}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
            
            <div className="flex flex-col gap-2 pt-4 border-t border-slate-100">
                {selectedLoan.status !== 'Pago' && selectedLoan.status !== 'Quitado' && (
                    <button onClick={() => { handleOpenPayment(selectedLoan); setIsDetailsOpen(false); }} className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-slate-800 transition-all shadow-lg"><DollarSign size={18} /> Registrar Novo Pagamento</button>
                )}
            </div>
          </div>
        )}
      </Modal>

      {/* --- O NOVO MODAL DE BAIXA FINANCEIRA COM FATIAS E MULTAS --- */}
      <Modal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} title="Baixa de Pagamento">
        {selectedLoan && (
            <div className="space-y-5">
            
            {(() => {
                const breakdown = getSyncedBreakdown(selectedLoan);
                const status = getLoanRealStatus(selectedLoan);
                let displayTotal = breakdown.total;
                
                if (status === 'Atrasado') {
                    displayTotal = calculateOverdueValue(breakdown.total, selectedLoan.nextDue, 'Atrasado', Number(selectedLoan.fineRate || 0), Number(selectedLoan.moraInterestRate || 0), selectedLoan.amount);
                }

                return (
                    <div className={`p-5 rounded-2xl shadow-xl text-white relative overflow-hidden ${status === 'Atrasado' ? 'bg-red-900' : 'bg-slate-900'}`}>
                        <div className="absolute top-0 right-0 p-4 opacity-10"><Database size={48} /></div>
                        <p className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-70">
                            {status === 'Atrasado' ? '⚠️ Vencimento em Atraso' : 'Próximo Vencimento em Aberto'}
                        </p>
                        <p className="text-2xl font-black">{formatDisplayDate(selectedLoan.nextDue)}</p>
                        <div className="flex justify-between mt-3 border-t border-white/10 pt-3">
                            <span className="text-xs opacity-70">Total Devido (c/ juros):</span>
                            <span className={`text-lg font-black ${status === 'Atrasado' ? 'text-red-400' : 'text-green-400'}`}>R$ {formatMoney(displayTotal)}</span>
                        </div>
                    </div>
                );
            })()}

            {((selectedLoan as any).multiDates && (selectedLoan as any).multiDates.length > 0) ? (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="bg-blue-600 p-1.5 rounded-lg text-white shadow-lg"><Layers size={16}/></div>
                        <h4 className="text-sm font-black text-blue-900 uppercase">Fatias do Mês Atual</h4>
                    </div>
                    <div className="space-y-2">
                        {(selectedLoan as any).multiDates.map((slice: any, idx: number) => {
                            const breakdown = getSyncedBreakdown(selectedLoan);
                            const status = getLoanRealStatus(selectedLoan);
                            const baseAmount = Number(slice.amount) || 0;
                            
                            let totalPenalty = 0;
                            if (status === 'Atrasado') {
                                const fullOverdue = calculateOverdueValue(breakdown.total, selectedLoan.nextDue, 'Atrasado', Number(selectedLoan.fineRate || 0), Number(selectedLoan.moraInterestRate || 0), selectedLoan.amount);
                                totalPenalty = fullOverdue - breakdown.total;
                            }

                            const ratio = baseAmount / (breakdown.total || 1);
                            const slicePenalty = totalPenalty * ratio;
                            const finalAmount = baseAmount + slicePenalty;

                            const sliceInt = (breakdown.interest * ratio) + slicePenalty;
                            const sliceCap = breakdown.capital * ratio;

                            const currentMonth = new Date(selectedLoan.nextDue).getMonth();
                            const currentYear = new Date(selectedLoan.nextDue).getFullYear();
                            
                            const isPaid = (selectedLoan.history || []).some(h => {
                                const hDue = h.originalDueDate ? new Date(h.originalDueDate) : new Date(h.date);
                                return hDue.getMonth() === currentMonth && 
                                       hDue.getFullYear() === currentYear && 
                                       h.note?.includes(`Dia ${slice.day}`);
                            });

                            const isSelected = (window as any).lastSelectedDay === slice.day;

                            return (
                                <div key={idx} className={`flex justify-between items-center p-3 border rounded-xl transition-all ${
                                    isPaid ? 'bg-green-50 border-green-200' : 
                                    isSelected ? 'bg-blue-600 border-blue-700 shadow-inner' : 'bg-white border-blue-100 hover:border-blue-400'
                                }`}>
                                    <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border ${
                                            isPaid ? 'bg-green-500 text-white border-green-600' : 
                                            isSelected ? 'bg-white text-blue-600' : 'bg-blue-50 text-blue-600 border-blue-100'
                                        }`}>
                                            {isPaid ? <Check size={14}/> : idx + 1}
                                        </div>
                                        <div>
                                            <p className={`text-[10px] font-black uppercase tracking-tighter ${
                                                isPaid ? 'text-green-600' : isSelected ? 'text-white' : 'text-blue-400'
                                            }`}>Dia {String(slice.day).padStart(2, '0')}</p>
                                            <p className={`text-sm font-black ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                                                R$ {formatMoney(finalAmount)}
                                                {slicePenalty > 0 && !isPaid && <span className="text-[9px] ml-2 text-red-400 font-bold bg-white/20 px-1 py-0.5 rounded">+ R$ {formatMoney(slicePenalty)}</span>}
                                            </p>
                                        </div>
                                    </div>
                                    {!isPaid && (
                                        <button 
                                            type="button"
                                            onClick={() => {
                                                setPayCapital(sliceCap.toFixed(2));
                                                setPayInterest(sliceInt.toFixed(2));
                                                (window as any).lastSelectedDay = slice.day;
                                                setLoans([...loans]);
                                            }}
                                            className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all ${
                                                isSelected ? 'bg-white text-blue-600' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md'
                                            }`}
                                        >
                                            {isSelected ? 'SELECIONADO' : 'SELECIONAR'}
                                        </button>
                                    )}
                                    {isPaid && <span className="text-[10px] font-black text-green-600 uppercase italic flex items-center gap-1"><CheckCircle size={12}/> Pago</span>}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center">
                    <p className="text-xs text-slate-500 italic">Este contrato não possui fatias de pagamento no cadastro.</p>
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Amortização</label>
                    <input type="number" step="0.01" value={payCapital} onChange={(e) => setPayCapital(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none font-black text-slate-700" placeholder="0.00"/>
                </div>
                <div>
                    <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Juros + Multa</label>
                    <input type="number" step="0.01" value={payInterest} onChange={(e) => setPayInterest(e.target.value)} className="w-full p-3 border border-green-200 rounded-xl outline-none font-black text-green-600 bg-green-50/30" placeholder="0.00"/>
                </div>
            </div>

            <div className="bg-slate-100 p-4 rounded-xl flex justify-between items-center shadow-inner">
                <span className="text-xs font-bold text-slate-500 uppercase">Total Selecionado:</span>
                <span className="text-xl font-black text-slate-900">R$ {formatMoney(Number(payCapital) + Number(payInterest))}</span>
            </div>

            <button onClick={confirmPayment} className="w-full py-4 bg-green-600 text-white rounded-2xl font-black hover:bg-green-700 transition-all shadow-xl flex items-center justify-center gap-2">
                <CheckCircle size={20}/> CONFIRMAR BAIXA NO SISTEMA
            </button>
            </div>
        )}
      </Modal>

      <Modal isOpen={isAgreementModalOpen} onClose={() => setIsAgreementModalOpen(false)} title="Registrar Acordo">
          <div className="space-y-5">
              <div className="bg-orange-50 border border-orange-200 p-4 rounded-xl">
                  <div className="flex items-center gap-2 text-orange-800 font-bold mb-2"><FileSignature size={20}/> Negociação Pontual</div>
                  <p className="text-xs text-orange-700">Este acordo alterará o vencimento e o status para "Em Acordo". O valor acordado será registrado, mas não haverá cobrança automática de juros adicionais neste período.</p>
              </div>
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nova Data de Vencimento</label><input type="date" value={agreementDate} onChange={e => setAgreementDate(e.target.value)} className="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-orange-500/20"/></div>
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Valor Acordado (R$)</label><input type="number" step="0.01" value={agreementValue} onChange={e => setAgreementValue(e.target.value)} className="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-orange-500/20 font-bold text-slate-800" placeholder=""/></div>
              <button onClick={confirmAgreement} className="w-full py-3 bg-orange-600 text-white font-bold rounded-xl hover:bg-orange-700 transition-all">Confirmar Acordo</button>
          </div>
      </Modal>

      {/* --- MEGA MODAL EDITAR CONTRATO --- */}
      <Modal isOpen={isEditContractModalOpen} onClose={() => setIsEditContractModalOpen(false)} title="Editar Ficha do Contrato">
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl mb-4">
                  <div className="flex items-center gap-2 text-blue-800 font-bold mb-1"><Edit size={18}/> Edição Completa</div>
                  <p className="text-xs text-blue-700">Modifique qualquer dado base do contrato. Estas alterações substituirão os dados originais no sistema e não gerarão um "Acordo" no extrato.</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">ID do Contrato</label><input type="text" value={editContractData.id} onChange={e => setEditContractData({...editContractData, id: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none font-bold text-slate-800"/></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Valor Emprestado Original (R$)</label><input type="number" step="0.01" value={editContractData.amount} onChange={e => setEditContractData({...editContractData, amount: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/></div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Taxa (%)</label><input type="number" step="0.01" value={editContractData.interestRate} onChange={e => setEditContractData({...editContractData, interestRate: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Parcelas</label><input type="number" value={selectedLoan?.interestType === 'SIMPLE' ? 1 : editContractData.installments} disabled={selectedLoan?.interestType === 'SIMPLE'} onChange={e => setEditContractData({...editContractData, installments: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none disabled:bg-slate-100 disabled:text-slate-400"/></div>
                  <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">Valor Parcela (R$)</label>
                      <input type="number" step="0.01" value={editContractData.installmentValue} disabled={selectedLoan?.interestType === 'SIMPLE'} onChange={e => setEditContractData({...editContractData, installmentValue: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none font-bold text-green-600 disabled:bg-slate-100"/>
                      {selectedLoan?.interestType === 'SIMPLE' && <span className="text-[9px] text-blue-500 mt-1 block leading-tight">Valor da parcela atualizado dinamicamente com base no Saldo Devedor.</span>}
                  </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Data da Operação</label><input type="date" value={editContractData.startDate} onChange={e => setEditContractData({...editContractData, startDate: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Próximo Vencimento</label><input type="date" value={editContractData.nextDue} onChange={e => setEditContractData({...editContractData, nextDue: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none font-bold text-slate-800"/></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Multa Atraso (%)</label><input type="number" step="0.01" value={editContractData.fineRate} onChange={e => setEditContractData({...editContractData, fineRate: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Mora Diária (%)</label><input type="number" step="0.01" value={editContractData.moraInterestRate} onChange={e => setEditContractData({...editContractData, moraInterestRate: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Banco do Cliente</label><input list="bancos-sugestao" value={editContractData.clientBank} onChange={e => setEditContractData({...editContractData, clientBank: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none" placeholder="Digite ou selecione o banco..."/></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Chave Pix/Conta</label><input type="text" value={editContractData.paymentMethod} onChange={e => setEditContractData({...editContractData, paymentMethod: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/></div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Dados do Fiador (Opcional)</label>
                  <div className="space-y-3">
                      <input type="text" placeholder="Nome do Fiador" value={editContractData.guarantorName} onChange={e => setEditContractData({...editContractData, guarantorName: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/>
                      <input type="text" placeholder="CPF do Fiador" value={editContractData.guarantorCPF} onChange={e => setEditContractData({...editContractData, guarantorCPF: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/>
                      <input type="text" placeholder="Endereço do Fiador" value={editContractData.guarantorAddress} onChange={e => setEditContractData({...editContractData, guarantorAddress: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/>
                  </div>
              </div>
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
              <button onClick={() => setIsEditContractModalOpen(false)} className="px-6 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-all">Cancelar</button>
              <button onClick={confirmEditContract} className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-900/20">
                  <CheckCircle size={18}/> Salvar Alterações
              </button>
          </div>
      </Modal>

      <Modal isOpen={loanFlowStep !== 'closed'} onClose={closeLoanFlow} title="Novo Empréstimo">
        <form onSubmit={handleFinalSave} className="space-y-6">
            <div className="space-y-4">
                
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <label className="flex items-center gap-2 text-xs font-bold uppercase text-slate-500 mb-2"><Search size={14}/> Cliente</label>
                    <input 
                        list="clients-datalist"
                        required
                        placeholder="Digite para buscar e selecione o cliente..."
                        value={formData.client}
                        onChange={e => setFormData({...formData, client: e.target.value})}
                        className="w-full p-3 border border-slate-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-slate-900/5 font-bold"
                        autoComplete="off"
                    />
                    <datalist id="clients-datalist">
                        {availableClients.map((c) => (<option key={c.id} value={c.name}>{c.name} ({c.cpf})</option>))}
                    </datalist>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <div className="flex justify-between items-end mb-1">
                             <label className="flex items-center gap-1 text-xs font-bold uppercase text-slate-500"><Hash size={12}/> ID do Contrato</label>
                             <div className="flex items-center gap-1 text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                                 <input type="checkbox" id="isPreContractCheckbox" className="w-3 h-3 text-orange-600 focus:ring-orange-500" />
                                 <label htmlFor="isPreContractCheckbox" className="text-[9px] font-black uppercase cursor-pointer">Gerar como Pré-Contrato</label>
                             </div>
                        </div>
                        <input value={formData.manualID} onChange={e => setFormData({...formData, manualID: e.target.value})} className="w-full p-2 border rounded-lg bg-white font-mono text-sm" placeholder="Deixe em branco p/ Automático"/>
                    </div>
                    <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Banco do Cliente</label>
                        <input list="bancos-sugestao" value={formData.clientBank} onChange={e => setFormData({...formData, clientBank: e.target.value})} className="w-full p-2 border rounded-lg bg-white" placeholder="Selecione ou digite..."/>
                    </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Chave PIX / Forma de Pagamento</label>
                    <input value={formData.paymentMethod} onChange={e => setFormData({...formData, paymentMethod: e.target.value})} className="w-full p-2 border rounded-lg bg-white" placeholder="Puxado automaticamente do cliente..."/>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Multa Atraso (%)</label><input type="number" step="0.1" value={formData.fineRate} onChange={e => setFormData({...formData, fineRate: e.target.value})} className="w-full p-2 border rounded-lg bg-white" placeholder="" /></div>
                    <div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Juros Mora Diária (%)</label><input type="number" step="0.01" value={formData.moraInterestRate} onChange={e => setFormData({...formData, moraInterestRate: e.target.value})} className="w-full p-2 border rounded-lg bg-white" placeholder="" /></div>
                </div>

                <div className={`p-3 border rounded-xl transition-all ${formData.isMigration ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center gap-2 mb-2">
                        <input type="checkbox" id="isMigration" checked={formData.isMigration} onChange={(e) => setFormData({...formData, isMigration: e.target.checked})} className={`w-5 h-5 rounded focus:ring-amber-500 ${formData.isMigration ? 'text-amber-600' : 'text-slate-500'}`} />
                        <label htmlFor="isMigration" className={`text-sm font-bold cursor-pointer flex items-center gap-2 ${formData.isMigration ? 'text-amber-800' : 'text-slate-600'}`}><Database size={16}/> É um contrato antigo (Migração)?</label>
                    </div>
                    {formData.isMigration && (
                        <div className="mt-3 animate-in zoom-in-95 border-t border-amber-200 pt-3">
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div><label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">Valor Original Emprestado (R$)</label><input required type="number" step="0.01" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white" placeholder="" /></div>
                                <div><label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">Taxa Registrada (%)</label><input required type="number" step="0.01" value={formData.interestRate} onChange={e => setFormData({...formData, interestRate: e.target.value})} className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white" placeholder="" /></div>
                            </div>
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div><label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">Capital Já Pago (R$)</label><input type="number" step="0.01" value={formData.initialPaidCapital} onChange={e => setFormData({...formData, initialPaidCapital: e.target.value})} className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white" placeholder="" /></div>
                                <div><label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">Juros Já Pagos (R$)</label><input type="number" step="0.01" value={formData.initialPaidInterest} onChange={e => setFormData({...formData, initialPaidInterest: e.target.value})} className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white" placeholder="" /></div>
                            </div>
                            
                            <div className="flex items-center gap-2 p-3 bg-white border border-amber-200 rounded-xl mb-3">
                                <input type="checkbox" id="interestTypeMig" checked={formData.interestType === 'SIMPLE'} onChange={(e) => setFormData({...formData, interestType: e.target.checked ? 'SIMPLE' : 'PRICE'})} className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500" />
                                <label htmlFor="interestTypeMig" className="text-sm font-bold text-amber-800 cursor-pointer">Pagamento Mínimo (Só Juros)</label>
                            </div>

                            <p className="text-[10px] font-bold text-amber-800 uppercase mb-2 mt-4 border-t border-amber-200 pt-2">Definir Parcelas Restantes Manualmente</p>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">Qtd. Parcelas Restantes</label>
                                    <input required type="number" value={formData.interestType === 'SIMPLE' ? 1 : formData.installments} disabled={formData.interestType === 'SIMPLE'} onChange={e => setFormData({...formData, installments: e.target.value})} className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white disabled:bg-amber-50 disabled:text-amber-400" placeholder="" />
                                </div>
                                
                                {formData.interestType !== 'SIMPLE' && (
                                    <div><label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">Capital / Parcela (R$)</label><input required type="number" step="0.01" value={formData.manualInstallmentCapital} onChange={e => setFormData({...formData, manualInstallmentCapital: e.target.value})} className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white" placeholder="" /></div>
                                )}
                                
                                <div className={formData.interestType === 'SIMPLE' ? 'col-span-2' : ''}>
                                    <label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">
                                        Juros / Parcela (R$)
                                        {formData.interestType === 'SIMPLE' && <span className="lowercase text-[8px] font-normal ml-1">(Será recalculado dincamicamente se pagar capital)</span>}
                                    </label>
                                    <input required type="number" step="0.01" value={formData.manualInstallmentInterest} onChange={e => setFormData({...formData, manualInstallmentInterest: e.target.value})} className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white" placeholder="" />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {!formData.isMigration && (
                    <>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="col-span-1"><label className="block text-xs font-bold uppercase text-slate-500 mb-2">Valor (R$)</label><input required type="number" step="0.01" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5" placeholder=""/></div>
                            <div className="col-span-1"><label className="block text-xs font-bold uppercase text-slate-500 mb-2">Taxa Mensal (%)</label><input required type="number" step="0.01" value={formData.interestRate} onChange={e => setFormData({...formData, interestRate: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5" placeholder=""/></div>
                            <div className="col-span-1"><label className="block text-xs font-bold uppercase text-slate-500 mb-2">Qtd. Parcelas</label><input required type="number" value={formData.interestType === 'SIMPLE' ? 1 : formData.installments} disabled={formData.interestType === 'SIMPLE'} onChange={e => setFormData({...formData, installments: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5 disabled:bg-slate-100 disabled:text-slate-400" placeholder=""/></div>
                        </div>
                        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl mb-4">
                            <input type="checkbox" id="interestType" checked={formData.interestType === 'SIMPLE'} onChange={(e) => setFormData({...formData, interestType: e.target.checked ? 'SIMPLE' : 'PRICE'})} className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500" />
                            <label htmlFor="interestType" className="text-sm font-bold text-blue-800 cursor-pointer">Pagamento Mínimo (Só Juros)</label>
                        </div>
                    </>
                )}

                {formData.frequency === 'MENSAL' && (
                    <div className="border-t border-slate-200 pt-4 mt-2">
                        <div className="flex items-center gap-2 mb-3">
                            <input type="checkbox" id="isMultiDate" checked={formData.isMultiDate} onChange={(e) => setFormData({...formData, isMultiDate: e.target.checked})} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500" />
                            <label htmlFor="isMultiDate" className="text-sm font-bold text-slate-700 cursor-pointer">Dividir Parcela em Múltiplas Datas (Multi-data)</label>
                        </div>
                        {formData.isMultiDate && (
                            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 animate-in slide-in-from-top-2">
                                <p className="text-xs text-slate-600 font-medium mb-2">Defina as datas para compor a parcela de <b>R$ {formatMoney(simulation.installment)}</b>.</p>
                                {formData.multiDates.map((md, index) => (
                                    <div key={index} className="flex items-center gap-2">
                                        <div className="flex-1">
                                            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Dia do Mês</label>
                                            <input type="number" min="1" max="31" value={md.day} onChange={(e) => {
                                                const newMd = [...formData.multiDates];
                                                newMd[index].day = e.target.value;
                                                setFormData({...formData, multiDates: newMd});
                                            }} className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white" placeholder="Ex: 10" />
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Valor (R$)</label>
                                            <input type="number" step="0.01" value={md.amount} onChange={(e) => {
                                                const newMd = [...formData.multiDates];
                                                newMd[index].amount = e.target.value;
                                                setFormData({...formData, multiDates: newMd});
                                            }} className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white" placeholder="Ex: 150.00" />
                                        </div>
                                        {index > 0 && (
                                            <button type="button" onClick={() => {
                                                const newMd = formData.multiDates.filter((_, i) => i !== index);
                                                setFormData({...formData, multiDates: newMd});
                                            }} className="mt-4 p-2 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16}/></button>
                                        )}
                                    </div>
                                ))}
                                {formData.multiDates.length < 5 && (
                                    <button type="button" onClick={() => setFormData({...formData, multiDates: [...formData.multiDates, {day: '', amount: ''}]})} className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1 mt-2"><Plus size={12}/> Adicionar Data</button>
                                )}
                            </div>
                        )}
                    </div>
                )}
                
                <div className="grid grid-cols-3 gap-4">
                    <div><label className="block text-xs font-bold uppercase text-slate-500 mb-2">{formData.isMigration ? 'Data Original (Criação)' : 'Data da Operação'}</label><input required type="date" value={formData.startDate} onChange={e => setFormData({...formData, startDate: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5" /></div>
                    <div><label className="block text-xs font-bold uppercase text-slate-500 mb-2">Periodicidade</label><div className="relative"><Repeat size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><select value={formData.frequency} onChange={e => setFormData({...formData, frequency: e.target.value})} className="w-full pl-10 p-3 border border-slate-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-slate-900/5"><option value="MENSAL">Mensal</option><option value="SEMANAL">Semanal</option><option value="DIARIO">Diário</option></select></div></div>
                    <div><label className="block text-xs font-bold uppercase text-slate-500 mb-2">{formData.isMigration ? 'Próximo Vencimento' : 'Primeiro Vencimento'}</label><input type="date" required={formData.isMigration} value={formData.firstPaymentDate} onChange={e => setFormData({...formData, firstPaymentDate: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5 text-sm" placeholder="Opcional" title="Deixe vazio para automático"/></div>
                </div>
                
                <div className="flex items-center gap-2 mt-4"><input type="checkbox" id="hasGuarantor" checked={formData.hasGuarantor} onChange={(e) => setFormData({...formData, hasGuarantor: e.target.checked})} className="w-4 h-4 rounded text-slate-900 focus:ring-slate-500"/><label htmlFor="hasGuarantor" className="text-sm font-bold text-slate-700 cursor-pointer">Adicionar Fiador (Opcional)</label></div>
                
                {formData.hasGuarantor && (
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 animate-in slide-in-from-top-2">
                        <div className="flex items-center gap-2 mb-2"><UserCheck size={18} className="text-slate-500"/><span className="text-xs font-bold uppercase text-slate-500">Dados do Fiador</span></div>
                        <input type="text" placeholder="Nome Completo do Fiador" value={formData.guarantorName} onChange={(e) => setFormData({...formData, guarantorName: e.target.value})} className="w-full p-2 border rounded-lg bg-white"/>
                        <input type="text" placeholder="CPF do Fiador" value={formData.guarantorCPF} onChange={(e) => setFormData({...formData, guarantorCPF: e.target.value})} className="w-full p-2 border rounded-lg bg-white"/>
                        
                        <div className="border-t border-slate-200 pt-3">
                            <div className="flex items-center gap-2 text-slate-400 mb-2"><Home size={14}/><span className="text-[10px] font-bold uppercase tracking-widest">Endereço de Citação</span></div>
                            <input type="text" placeholder="Rua / Avenida / Logradouro" value={formData.guarantorAddress} onChange={(e) => setFormData({...formData, guarantorAddress: e.target.value})} className="w-full p-2 border rounded-lg bg-white text-sm mb-3"/>
                            
                            <div className="grid grid-cols-3 gap-2">
                                <input type="text" placeholder="Nº" value={formData.guarantorNumber} onChange={(e) => setFormData({...formData, guarantorNumber: e.target.value})} className="w-full p-2 border rounded-lg bg-white text-sm"/>
                                <select value={formData.guarantorHouseType} onChange={e => setFormData({...formData, guarantorHouseType: e.target.value})} className="w-full p-2 border rounded-lg bg-white text-sm">
                                    <option value="CASA">Casa</option>
                                    <option value="APARTAMENTO">Apartamento</option>
                                </select>
                                {formData.guarantorHouseType === 'APARTAMENTO' && (
                                    <input type="text" placeholder="Bloco" value={formData.guarantorBlock} onChange={(e) => setFormData({...formData, guarantorBlock: e.target.value})} className="w-full p-2 border rounded-lg bg-white text-sm animate-in fade-in"/>
                                )}
                            </div>
                            {formData.guarantorHouseType === 'APARTAMENTO' && (
                                <div className="flex items-center gap-2 mt-2 animate-in slide-in-from-top-1">
                                    <Layers size={14} className="text-slate-400" />
                                    <input type="text" placeholder="Andar / Número do Apto" value={formData.guarantorFloor} onChange={(e) => setFormData({...formData, guarantorFloor: e.target.value})} className="w-full p-2 border rounded-lg bg-white text-sm"/>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-2 mt-2"><input type="checkbox" id="hasAffiliate" checked={formData.hasAffiliate} onChange={(e) => setFormData({...formData, hasAffiliate: e.target.checked})} className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"/><label htmlFor="hasAffiliate" className="text-sm font-bold text-slate-700 cursor-pointer">Houve indicação / Afiliado?</label></div>
                {formData.hasAffiliate && (
                    <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 space-y-3 animate-in slide-in-from-top-2">
                        <div className="flex items-center gap-2 mb-2"><Users size={18} className="text-indigo-500"/><span className="text-xs font-bold uppercase text-indigo-500">Dados da Comissão</span></div>
                        <select value={formData.affiliateName} onChange={(e) => setFormData({...formData, affiliateName: e.target.value})} className="w-full p-2 border border-indigo-200 rounded-lg bg-white outline-none">
                            <option value="">Selecione um parceiro cadastrado ou digite...</option>
                            {availableAffiliates.map(af => <option key={af.id} value={af.name}>{af.name}</option>)}
                        </select>
                        <input type="text" placeholder="Ou digite o nome do indicador..." value={formData.affiliateName} onChange={(e) => setFormData({...formData, affiliateName: e.target.value})} className="w-full p-2 border border-indigo-200 rounded-lg bg-white outline-none"/>
                        
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-[10px] uppercase font-bold text-indigo-400 mb-1">Valor a Pagar/Descontar (R$)</label>
                                <input type="number" step="0.01" placeholder="Ex: 50.00" value={formData.affiliateFee} onChange={(e) => setFormData({...formData, affiliateFee: e.target.value})} className="w-full p-2 border border-indigo-200 rounded-lg bg-white outline-none"/>
                            </div>
                            <div>
                                <label className="block text-[10px] uppercase font-bold text-indigo-400 mb-1">Observações</label>
                                <input type="text" placeholder="Ex: Descontado no Pix inicial" value={formData.affiliateNotes} onChange={(e) => setFormData({...formData, affiliateNotes: e.target.value})} className="w-full p-2 border border-indigo-200 rounded-lg bg-white outline-none"/>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 shadow-inner">
                <div className="flex items-center gap-2 mb-4 border-b border-slate-200 pb-3"><Calculator size={20} className="text-slate-800" /><h4 className="text-[12px] font-bold text-slate-800 uppercase tracking-widest">Simulação Financeira ({formData.isMigration ? 'Migração Manual' : formData.interestType === 'SIMPLE' ? 'Juros Simples' : 'Price'})</h4></div>
                {isSimulating ? (<div className="flex justify-center py-4"><Loader2 className="animate-spin text-slate-400" /></div>) : simulation.isValid ? (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center text-sm font-medium"><span className="text-slate-500">Montante Financiado:</span><span className="text-slate-900 font-bold">R$ {formatMoney(parseFloat(formData.amount) || 0)}</span></div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-slate-500 font-medium">
                                Parcela {formData.frequency === 'DIARIO' ? 'Diária' : formData.frequency === 'SEMANAL' ? 'Semanal' : 'Mensal'} ({formData.interestType === 'SIMPLE' ? 1 : formData.installments}x):
                            </span>
                            <span className="text-xl font-black text-green-600 bg-green-50 px-3 py-1 rounded-lg border border-green-100">R$ {formatMoney(simulation.installment)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm"><span className="text-slate-500 font-medium">Custo Total de Juros:</span><span className="text-red-600 font-bold">+ R$ {formatMoney(simulation.totalInterest)}</span></div>
                        
                        {formData.hasAffiliate && parseFloat(formData.affiliateFee || '0') > 0 && (
                            <div className="flex justify-between items-center text-sm pt-2 border-t border-slate-200">
                                <span className="text-indigo-500 font-medium">Lucro Líquido Estimado:</span>
                                <span className="text-indigo-700 font-bold">R$ {formatMoney(simulation.totalInterest - parseFloat(formData.affiliateFee))}</span>
                            </div>
                        )}
                    </div>
                ) : (<p className="text-center text-slate-400 text-xs py-4 font-medium italic">Preencha os campos obrigatórios...</p>)}
            </div>
            
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button type="button" onClick={closeLoanFlow} className="px-6 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-all">Cancelar</button>
              <button 
                type="submit" 
                disabled={!simulation.isValid || isSaving || isMultiDateInvalid} 
                className={`px-8 py-3 text-white rounded-xl flex items-center gap-2 font-bold shadow-xl transition-all ${
                  isMultiDateInvalid 
                    ? 'bg-slate-400 opacity-100 cursor-not-allowed' 
                    : 'bg-green-600 shadow-green-900/20 hover:bg-green-700 disabled:opacity-50'
                }`}
              >
                {isSaving ? <Loader2 className="animate-spin" size={18} /> : (isMultiDateInvalid ? <AlertCircle size={18} /> : <ShieldCheck size={18} />)}
                {isSaving ? 'Salvando...' : (isMultiDateInvalid && !formData.isMigration ? 'Soma das datas não bate' : 'Aprovar Contrato')}
              </button>
            </div>
        </form>
      </Modal>
    </Layout>
  );
};

export default Billing;