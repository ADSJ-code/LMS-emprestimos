import { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Search, Plus, AlertCircle, CheckCircle, Clock, Trash2,
  MoreVertical, Loader2, RefreshCw, ShieldAlert, ShieldCheck, 
  Calculator, FileText, Check, ChevronRight, DollarSign, 
  Printer, Eye, TrendingUp, TrendingDown, History, Download, Calendar, AlertTriangle, Info, PartyPopper, UserCheck,
  Percent, Landmark, CreditCard, Repeat, BellRing, X, FileSignature, Filter, MessageCircle, Users, Send, Home, Layers,
  Hash, Database, Edit, ChevronDown, ChevronUp
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
  // 🚀 LIMPADOR DE ACENTOS E CARACTERES ESPECIAIS
  const normalizeString = (str: string) => {
      return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  };

  const [loanFlowStep, setLoanFlowStep] = useState<LoanFlowStep>('closed');
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isAgreementModalOpen, setIsAgreementModalOpen] = useState(false);
  const [isCollectionModalOpen, setIsCollectionModalOpen] = useState(false);
  
  
  const [isEditContractModalOpen, setIsEditContractModalOpen] = useState(false);
  const [editContractData, setEditContractData] = useState<any>({});

  const [collectionDate, setCollectionDate] = useState(new Date().toISOString().split('T')[0]);
  const [collectionSearchTerm, setCollectionSearchTerm] = useState(''); // 🚀 Busca do Modal
  const [returnToModal, setReturnToModal] = useState<'collection' | null>(null); // 🚀 Efeito Bumerangue
  const [cycleMissing, setCycleMissing] = useState(0); // 🚀 O que falta para fechar a parcela
  const collectionScrollRef = useRef<number>(0); // 🚀 MEMÓRIA DE SCROLL DO RODRIGO

  const [detailTab, setDetailTab] = useState<'info' | 'schedule' | 'history'>('info');

  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  
  const [statusFilter, setStatusFilter] = useState<'Todos' | 'Em Dia' | 'Atrasado' | 'Quitado' | 'Acordo' | 'PagosNoPeriodo'>('Todos');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]); 
  const [showPaidLoans, setShowPaidLoans] = useState(false); // 🚀 Controle da Sanfona de Quitados

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

  // 🚀 NOVO ESTADO: Controlo manual para avanço do mês
  const [forceAdvanceMonth, setForceAdvanceMonth] = useState(false);
  // 🚀 NOVO ESTADO: Quitação com Desconto (Perdão de Juros)
  const [isDiscountSettlement, setIsDiscountSettlement] = useState(false);

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

  const [exactInterest, setExactInterest] = useState<number | null>(null);
  const [simulation, setSimulation] = useState({ installment: 0, totalInterest: 0, totalPayable: 0, isValid: false });
  // 🚀 LIMPADOR INTELIGENTE: Blindagem contra vírgulas brasileiras
  const parseVal = (v: any): number => {
      if (typeof v === 'number') return isNaN(v) ? 0 : v;
      if (!v) return 0;
      if (typeof v === 'string') return parseFloat(v.replace(/\./g, '').replace(',', '.')) || 0;
      return 0;
  };

  // --- MOTOR DE CÁLCULO TRAVADO E LINEAR ---
  const getSyncedBreakdown = (loan: Loan | null) => {
    if (!loan) return { interest: 0, capital: 0, total: 0 };

    const dueDate = new Date(loan.nextDue);
    const cycleStart = new Date(dueDate);
    cycleStart.setMonth(cycleStart.getMonth() - 1);
    cycleStart.setHours(23, 59, 59, 999);

    let capitalPaidInThisCycle = 0;
    if (loan.history) {
        loan.history.forEach(h => {
            const hDate = new Date(h.date);
            // 🚀 BLINDAGEM: Ignora "Ajuste de Migração" e "Abertura" no cálculo do ciclo!
            if (hDate > cycleStart && !h.note?.includes('[CICLO COMPLETADO]') && h.type !== 'Abertura' && h.type !== 'Ajuste de Migração') {
                capitalPaidInThisCycle += parseVal(h.capitalPaid);
            }
        });
    }

    const principalAtStartOfCycle = (parseVal(loan.amount) - parseVal(loan.totalPaidCapital)) + capitalPaidInThisCycle;
    
    if (loan.interestType === 'SIMPLE') {
        let periodRate = parseVal(loan.interestRate) / 100;
        if (loan.frequency === 'SEMANAL') periodRate /= 4;
        else if (loan.frequency === 'DIARIO') periodRate /= 30;

        const dynamicInterest = principalAtStartOfCycle * periodRate;
        let extraAcordo = 0;
        if (loan.status === 'Acordo' && parseVal(loan.agreementValue) > 0) extraAcordo = parseVal(loan.agreementValue);
        
        return { interest: dynamicInterest + extraAcordo, capital: 0, total: dynamicInterest + extraAcordo };
        
    } else {
        // 🚀 MATEMÁTICA PERFEITA PARA PRICE/LINEAR: Lê a dívida e divide pelas parcelas restantes!
        const activeInst = Math.max(1, loan.installments);
        const flatCapital = principalAtStartOfCycle / activeInst;
        const flatInterest = parseVal(loan.installmentValue) - flatCapital;

        let extraAcordo = 0;
        if (loan.status === 'Acordo' && parseVal(loan.agreementValue) > 0) extraAcordo = parseVal(loan.agreementValue);

        return { 
            interest: Math.max(0, flatInterest) + extraAcordo, 
            capital: Math.max(0, flatCapital), 
            total: parseVal(loan.installmentValue) + extraAcordo
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

      // 🚀 FILTRO GLOBAL DA LISTA NEGRA: Remove os clientes bloqueados da tela de faturamento e cobrança
      const blockedNames = new Set((clientsData || []).filter(c => c.status === 'Bloqueado').map(c => c.name));
      const cleanClients = (clientsData || []).filter(c => c.status !== 'Bloqueado');
      const cleanLoans = (loansData || []).filter(l => !blockedNames.has(l.client));

      setAvailableClients(cleanClients); // Oculta bloqueados do dropdown de Novo Contrato
      setLoans(cleanLoans); // Remove contratos de bloqueados da matemática de recebimento e cobrança
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

  // --- MOTOR INTELIGENTE DE STATUS BLINDADO CONTRA DATAS ---
 
  // 🚀 EXTRAÇÃO DE APELIDO: Limpa o JSON e mostra apenas a observação
  const getNickname = (obs?: string) => {
      if (!obs) return '';
      let clean = obs.split('[META:')[0].trim();
      // Limpa o rastro do bug antigo (chaves que ficaram salvas no banco)
      return clean.replace(/\}\]$/, '').trim();
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

  // 🚀 NOVA FUNÇÃO: Descobre qual a data da próxima fatia real que o cliente deve pagar
  const getDisplayNextDue = (loan: any) => {
      if (loan.status?.toLowerCase() === 'pago' || loan.status?.toLowerCase() === 'quitado') return loan.nextDue.includes('T') ? loan.nextDue.split('T')[0] : loan.nextDue;
      if (loan.status === 'Acordo') return loan.nextDue.includes('T') ? loan.nextDue.split('T')[0] : loan.nextDue;

      const validSlices = (loan.multiDates || []).filter((s: any) => s && s.day && !isNaN(Number(s.day)) && Number(s.day) > 0 && parseVal(s.amount) > 0);
      
      if (validSlices.length > 0) {
          const baseDue = parseLocalDate(loan.nextDue);
          const currentMonth = baseDue.getMonth();
          const currentYear = baseDue.getFullYear();
          const sortedSlices = [...validSlices].sort((a, b) => Number(a.day) - Number(b.day));
          
          let totalPaidInCycle = (loan.history || []).reduce((acc: any, h: any) => {
              const hDue = h.originalDueDate ? parseLocalDate(h.originalDueDate) : parseLocalDate(h.date);
              if (hDue.getMonth() === currentMonth && hDue.getFullYear() === currentYear && !h.type?.toLowerCase().includes('abertura')) {
                  return acc + parseVal(h.amount);
              }
              return acc;
          }, 0);

          for (const slice of sortedSlices) {
              const baseAmount = parseVal(slice.amount);
              if (totalPaidInCycle >= (baseAmount - 0.05)) {
                  totalPaidInCycle -= baseAmount;
              } else {
                  const sliceDate = new Date(currentYear, currentMonth, Number(slice.day));
                  return sliceDate.toISOString().split('T')[0];
              }
          }
      }
      return loan.nextDue.includes('T') ? loan.nextDue.split('T')[0] : loan.nextDue;
  };

  // --- MOTOR INTELIGENTE DE STATUS BLINDADO CONTRA DATAS E FATIAS FANTASMAS ---
  const getLoanRealStatus = (loan: Loan) => {
    if (loan.status?.toLowerCase() === 'pago' || loan.status?.toLowerCase() === 'quitado') return 'Quitado'; 
    
    const balance = parseVal(loan.amount) - parseVal(loan.totalPaidCapital);
    if (balance <= 0.10) return 'Quitado'; 
    
    // 🚀 FIX: Se não for Juros Simples e as parcelas chegaram a 0, está numericamente quitado!
    if (loan.interestType !== 'SIMPLE' && Number(loan.installments) <= 0) return 'Quitado';
    
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const dueLocalDate = parseLocalDate(loan.nextDue);

    if (loan.status === 'Acordo') {
        if (dueLocalDate < today) return 'Atrasado';
        return 'Acordo';
    }

    const validSlices = ((loan as any).multiDates || []).filter((s: any) => s && s.day && !isNaN(Number(s.day)) && Number(s.day) > 0 && parseVal(s.amount) > 0);

    if (validSlices.length > 0) {
        const currentMonth = dueLocalDate.getMonth();
        const currentYear = dueLocalDate.getFullYear();
        let hasLateSlice = false;

        let totalPaidInCycle = (loan.history || []).reduce((acc: number, h: any) => {
            const hDue = h.originalDueDate ? parseLocalDate(h.originalDueDate) : parseLocalDate(h.date);
            if (hDue.getMonth() === currentMonth && hDue.getFullYear() === currentYear && !h.type?.toLowerCase().includes('abertura')) {
                return acc + parseVal(h.amount);
            }
            return acc;
        }, 0);

        const sortedSlices = [...validSlices].sort((a, b) => Number(a.day) - Number(b.day));

        for (const slice of sortedSlices) {
            const baseAmount = parseVal(slice.amount);
            const sliceDate = new Date(currentYear, currentMonth, Number(slice.day));
            
            if (totalPaidInCycle >= (baseAmount - 0.05)) {
                totalPaidInCycle -= baseAmount;
            } else {
                if (sliceDate < today) {
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
      `Você está prestes a enviar mensagens SILENCIOSAS de cobrança via sistema para ${selectedIds.length} cliente(s).\n\nO envio fará pausas automáticas de alguns segundos entre cada cliente para evitar bloqueios do WhatsApp.\nDeseja iniciar o disparo?`
    );
    if (!confirmMass) return;

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

    const selectedLoansData = loans.filter((l) => selectedIds.includes(l.id));
    let successCount = 0;

    for (let i = 0; i < selectedLoansData.length; i++) {
      const loan = selectedLoansData[i];
      const client = availableClients.find((c) => c.name === loan.client);

      if (client && client.phone) {
        const cleanPhone = client.phone.replace(/\D/g, "");
        const contractCode = `CTR-${loan.id?.substring(0, 6).toUpperCase()}`;
        
        const breakdown = getSyncedBreakdown(loan);
        const status = getLoanRealStatus(loan);
        let finalAmount = breakdown.total;
        let lateDays = 0;
        
        if (status === 'Atrasado') {
            finalAmount = calculateOverdueValue(breakdown.total, loan.nextDue, 'Atrasado', Number(loan.fineRate || 0), Number(loan.moraInterestRate || 0), loan.amount);
            const due = new Date(loan.nextDue);
            const today = new Date();
            lateDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 3600 * 24));
        }

        const formattedDate = formatDisplayDate(loan.nextDue);

        try {
          const instance = await getInstanceToken(companyName, companyPhone);
          if (instance) {
              await sendWhatsappApi(
                client.name,
                cleanPhone,
                contractCode,
                lateDays,
                finalAmount,
                formattedDate,
                instance.instanceName,
                instance.apikey
              );
              successCount++;
              // Anti-ban delay: Pausa de 3 a 5 segundos silenciosamente
              await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
          } else {
              console.error("Instância do WhatsApp não encontrada.");
              break;
          }
        } catch (error: any) {
          console.error("Erro ao enviar para", client.name, error);
          if (error?.message === "WHATSAPP_DISCONNECTED") {
              alert("⚠️ WhatsApp desconectado! O disparo em massa foi interrompido.\nVá em Configurações e reconecte o QR Code.");
              break;
          }
        }
      }
    }
    
    alert(`✅ Disparo concluído! ${successCount} de ${selectedIds.length} mensagens enviadas via API.`);
    setSelectedIds([]);
  };

  const renderSchedule = (loan: Loan) => {
      const historyPayments = (loan.history || []).filter(h => h.type === 'Parcela' || h.type === 'Amortização' || h.type === 'Juros');
      const isSimple = loan.interestType === 'SIMPLE';
      
      // Só conta os ciclos realmente finalizados para avançar o número da parcela visual
      const completedCyclesCount = historyPayments.filter(h => h.note?.includes('[CICLO COMPLETADO]') || h.note?.includes('[QUITAÇÃO TOTAL]')).length;
      const totalOriginal = isSimple ? '∞' : (loan.installments + completedCyclesCount);

      const schedule: any[] = [];
      let currentCycle = 1;

      historyPayments.forEach((p, idx) => {
          const isPartial = p.note?.includes('[PAGAMENTO PARCIAL]');
          const completed = p.note?.includes('[CICLO COMPLETADO]') || p.note?.includes('[QUITAÇÃO TOTAL]');
          const originalDateStr = p.originalDueDate ? `(Ref: ${formatDisplayDate(p.originalDueDate)})` : '';
          
          schedule.push({
              id: `paid-${idx}`, 
              num: isPartial ? '◷' : '✓', 
              label: isPartial ? `Pagamento Parcial` : `Parcela ${currentCycle} ${!isSimple ? `de ${totalOriginal}` : ''}`,
              date: p.date, dateLabel: 'Pago em', amount: p.amount, status: 'Pago',
              note: originalDateStr
          });

          if (completed) currentCycle++; // Só avança a contagem se a parcela foi totalmente paga
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
              
              let amountToDisplay = isSimple ? getSyncedBreakdown(loan).total : Number(loan.installmentValue || 0);
              let noteStr = '';

              if (stepDate < today) {
                  status = 'Atrasado';
                  const baseAmount = (isFirst && loan.status === 'Acordo') ? amountToDisplay + Number(loan.agreementValue || 0) : amountToDisplay;
                  const stepDateStr = stepDate.toISOString().split('T')[0];
                  
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
                  id: `pend-${i}`, num: currentCycle + i, label: `Parcela ${currentCycle + i} ${!isSimple ? `de ${totalOriginal}` : ''}`,
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
                              <p className={`font-bold text-sm flex items-center gap-2 ${item.status === 'Pago' ? 'text-slate-500' : 'text-slate-800'}`}>
                                  {item.label}
                                  {item.label === 'Pagamento Parcial' && <span className="bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider">Parcial</span>}
                              </p>
                              {item.note && <span className="block text-[10px] text-blue-500 font-bold mt-0.5">{item.note}</span>}
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
       const dStr = getDisplayNextDue(l);
       return dStr === todayStr && l.status?.toLowerCase() !== 'pago' && l.status?.toLowerCase() !== 'quitado';
    });
    setTodaysLoans(dueToday);

    const targetStr = collectionDate;
    const list = loans.filter(l => getDisplayNextDue(l) === targetStr && l.status?.toLowerCase() !== 'pago' && l.status?.toLowerCase() !== 'quitado');
    setCollectionLoans(list);

    const totalOverdue = loans.reduce((acc, l) => {
      if (l.status === 'Pago' || l.status === 'Quitado') return acc;
      const realStatus = getLoanRealStatus(l);
      if (realStatus === 'Atrasado') {
          // 🚀 FIX: Usa o breakdown que já injeta o valor extra do acordo em todas as modalidades
          const baseVal = getSyncedBreakdown(l).total;
          
          const val = calculateOverdueValue(
              baseVal, 
              l.nextDue, 
              'Atrasado', 
              parseVal(l.fineRate), 
              parseVal(l.moraInterestRate), 
              parseVal(l.amount)
          );
          return acc + val;
      }
      return acc;
    }, 0);
    
    const totalProfit = loans.reduce((acc, l) => acc + (l.totalPaidInterest || 0), 0);
    const totalTodayValue = dueToday.reduce((acc, l) => acc + (l.interestType === 'SIMPLE' ? getSyncedBreakdown(l).total : Number(l.installmentValue || 0)), 0);

    setSummary({ overdue: totalOverdue, received: totalProfit, today: totalTodayValue });
  }, [loans, collectionDate]);

  // --- SIMULAÇÃO FINANCEIRA BLINDADA ---
  useEffect(() => {
    const amount = parseFloat(formData.amount) || 0; 
    const rateMonthly = parseFloat(formData.interestRate) || 0; 
    
    if (formData.isMigration) {
        const initCap = parseFloat(formData.initialPaidCapital) || 0;
        const mInt = parseFloat(formData.manualInstallmentInterest) || 0;
        const mCap = parseFloat(formData.manualInstallmentCapital) || 0;
        
        if (formData.interestType === 'SIMPLE') {
            const pmt = mInt; 
                
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

        if (exactInterest !== null && exactInterest > 0) {
            // 🚀 FIX RODRIGO: Se digitou juros manual, usa o valor absoluto cravado
            if (formData.interestType === 'SIMPLE') {
                pmt = exactInterest;
                totalInt = exactInterest * numInstallments;
            } else {
                pmt = (amount + exactInterest) / numInstallments;
                totalInt = exactInterest;
            }
        } else {
            if (formData.interestType === 'SIMPLE') {
                pmt = amount * periodRate; 
                totalInt = pmt * numInstallments;
            } else {
                if (periodRate === 0) pmt = amount / numInstallments;
                else pmt = amount * ( (periodRate * Math.pow(1 + periodRate, numInstallments)) / (Math.pow(1 + periodRate, numInstallments) - 1) );
                totalInt = (pmt * numInstallments) - amount;
            }
        }

        // 🚀 MATEMÁTICA ABSOLUTA: Arredondamento cravado em 2 casas decimais
        pmt = Math.round(pmt * 100) / 100;
        totalInt = Math.round(totalInt * 100) / 100;

        // 🚀 CORREÇÃO: O total a pagar agora usa o pmt exato da simulação
        const totalPayableCalc = Math.round((pmt * numInstallments + (formData.interestType === 'SIMPLE' ? amount : 0)) * 100) / 100;

        setSimulation({ 
            installment: pmt, 
            totalInterest: totalInt, 
            totalPayable: totalPayableCalc, 
            isValid: true 
        });
        setIsSimulating(false);
      }, 400);
      return () => clearTimeout(timeoutId);
    } else { 
        setSimulation({ installment: 0, totalInterest: 0, totalPayable: 0, isValid: false }); 
    }
  }, [formData.amount, formData.interestRate, formData.installments, formData.startDate, formData.interestType, formData.frequency, formData.isMigration, formData.manualInstallmentCapital, formData.manualInstallmentInterest, formData.initialPaidCapital, formData.initialPaidInterest, exactInterest]);
  // --- INTELIGÊNCIA MULTI-DATA: VALIDAÇÃO COM TOLERÂNCIA ---
  const isMultiDateInvalid = useMemo(() => {
    if (!formData.isMultiDate) return false;
    
    const sum = formData.multiDates.reduce((acc, curr) => acc + (parseFloat(curr.amount as any) || 0), 0);
    
    let expectedInstallment = simulation.installment;
    if (formData.isMigration) {
       const mCap = parseFloat(formData.manualInstallmentCapital) || 0;
       const mInt = parseFloat(formData.manualInstallmentInterest) || 0;
       expectedInstallment = formData.interestType === 'SIMPLE' ? mInt : (mCap + mInt);
    }
    
    // TOLERÂNCIA DE R$ 5,00 PARA NÃO TRAVAR O BOTÃO INJUSTAMENTE
    return Math.abs(sum - expectedInstallment) > 5.00;
  }, [formData.isMultiDate, formData.isMigration, formData.multiDates, simulation.installment, formData.manualInstallmentCapital, formData.manualInstallmentInterest, formData.interestType]);
  
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
  }, [searchTerm, statusFilter, filterStart, filterEnd, sortOrder]);
  
  // 🚀 BUSCA INTELIGENTE DO RODRIGO: Sem acentos, prefixo primeiro, alfabético depois.
  const filteredLoans = useMemo(() => {
      const searchLower = normalizeString(searchTerm);
      
      const filtered = loans.filter(l => {
        const cNameNorm = normalizeString(l.client || '');
        const matchesSearch = cNameNorm.includes(searchLower) || (l.id || '').toLowerCase().includes(searchLower);
        const realStatus = getLoanRealStatus(l);
        let matchesStatus = true;
        
        if (statusFilter !== 'Todos') {
            if (statusFilter !== 'PagosNoPeriodo') matchesStatus = realStatus === statusFilter;
        }
        
        let matchesDate = true;
        if (filterStart && filterEnd) {
            if (statusFilter === 'PagosNoPeriodo') {
                if (!l.history) return false;
                // 🚀 FIX: Para "Pagos no Período", exige que o pagamento tenha ocorrido no mês 
                // AND que a referência desse pagamento pertença ao mês filtrado.
                matchesDate = l.history.some(h => {
                    if (h.amount <= 0 || h.type.toLowerCase().includes('abertura') || h.type === 'Acordo') return false;
                    
                    // Converte para string absoluta YYYY-MM-DD para não bugar com fuso horário
                    const hDate = new Date(h.date).toISOString().split('T')[0];
                    const refDate = h.originalDueDate ? new Date(h.originalDueDate).toISOString().split('T')[0] : hDate;
                    
                    const paidInPeriod = hDate >= filterStart && hDate <= filterEnd;
                    const refInPeriod = refDate >= filterStart && refDate <= filterEnd;
                    
                    return paidInPeriod && refInPeriod;
                });
            } else {
                // Filtro normal pelas fatias
                const dueStr = getDisplayNextDue(l);
                matchesDate = dueStr >= filterStart && dueStr <= filterEnd;
            }
        } else if (statusFilter === 'PagosNoPeriodo') {
            matchesDate = false; 
        }
        return matchesSearch && matchesStatus && matchesDate;
      });

      return filtered.sort((a, b) => {
          if (searchTerm) {
              const aClient = normalizeString(a.client || '');
              const bClient = normalizeString(b.client || '');
              const aStarts = aClient.startsWith(searchLower);
              const bStarts = bClient.startsWith(searchLower);
              
              if (aStarts && !bStarts) return -1;
              if (!aStarts && bStarts) return 1;
              return aClient.localeCompare(bClient);
          }
          
          const timeA = (a.history && a.history.length > 0 && a.history[0].registeredAt) ? new Date(a.history[0].registeredAt).getTime() : new Date(a.startDate).getTime();
          const timeB = (b.history && b.history.length > 0 && b.history[0].registeredAt) ? new Date(b.history[0].registeredAt).getTime() : new Date(b.startDate).getTime();
          
          return sortOrder === 'newest' ? timeB - timeA : timeA - timeB;
      });
  }, [loans, searchTerm, statusFilter, filterStart, filterEnd, sortOrder]);
  
  const tableTotals = useMemo(() => {
      let capSum = 0;
      let intSum = 0;
      let expectedProfitSum = 0;
      let installmentSum = 0; 
      let count = 0;

      filteredLoans.forEach(loan => {
          if (selectedIds.includes(loan.id)) {
              const isSimple = loan.interestType === 'SIMPLE';
              const breakdown = getSyncedBreakdown(loan);
              
              installmentSum += breakdown.total; 

              // 🚀 FIX: Isola tanto os Juros quanto o Capital APENAS do período filtrado para o rodapé
              if (filterStart && filterEnd && statusFilter === 'PagosNoPeriodo' && loan.history) {
                  let periodIntSum = 0;
                  let periodCapSum = 0; 
                  loan.history.forEach((h: any) => {
                      const hDate = new Date(h.date).toISOString().split('T')[0];
                      const refDate = h.originalDueDate ? new Date(h.originalDueDate).toISOString().split('T')[0] : hDate;
                      
                      const paidInPeriod = hDate >= filterStart && hDate <= filterEnd;
                      const refInPeriod = refDate >= filterStart && refDate <= filterEnd;

                      if (paidInPeriod && refInPeriod && !h.type.toLowerCase().includes('abertura') && h.type !== 'Acordo') {
                          periodIntSum += (h.interestPaid || 0);
                          periodCapSum += (h.capitalPaid || 0);
                      }
                  });
                  intSum += periodIntSum;
                  capSum += periodCapSum; // Soma apenas o capital amortizado no mês
              } else {
                  intSum += (loan.totalPaidInterest || 0);
                  capSum += Math.max(0, loan.amount - (loan.totalPaidCapital || 0)); // Saldo devedor normal
              }

              if (!isSimple) {
                  const totalExpected = loan.projectedProfit || ((loan.installmentValue * loan.installments) - loan.amount);
                  expectedProfitSum += Math.max(0, totalExpected - (loan.totalPaidInterest || 0));
              } else {
                  expectedProfitSum += breakdown.interest;
              }
              count++;
          }
      });

      return { capital: capSum, interest: intSum, expectedProfit: expectedProfitSum, installment: installmentSum, count };
  }, [filteredLoans, selectedIds, filterStart, filterEnd, statusFilter]);

  // --- MOTOR INTELIGENTE DE BAIXA DE FATIAS E PARCIAIS ---
  const handleOpenPayment = (loan: Loan) => {
    setSelectedLoan(loan);
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    const localISOTime = (new Date(now.getTime() - offsetMs)).toISOString().slice(0, 16);
    setPayDate(localISOTime);

    const breakdown = getSyncedBreakdown(loan);
    const slices = (loan as any).multiDates || [];
    const status = getLoanRealStatus(loan);

    // 🚀 FIX 1: O sistema agora olha PRIMEIRO o que o cliente já pagou de picadinho no ciclo atual
    let accInt = 0; let accCap = 0;
    if(loan.history) {
        for (let i = loan.history.length - 1; i >= 0; i--) {
            const h = loan.history[i];
            // 🚀 BLINDAGEM: Trava a leitura no Ajuste de Migração para não engolir o Capital Inicial
            if (h.note?.includes('[CICLO COMPLETADO]') || h.type === 'Abertura' || h.type === 'Ajuste de Migração') break;
            accInt += (h.interestPaid || 0);
            accCap += (h.capitalPaid || 0);
        }
    }
    setCycleAcc({ interest: accInt, capital: accCap });
    
    let autoCapital = '';
    let autoInterest = '';
    let totalPenalty = 0;

    const currentMonth = new Date(loan.nextDue).getMonth();
    const currentYear = new Date(loan.nextDue).getFullYear();
    const today = new Date();
    today.setHours(0,0,0,0);

    if (slices.length > 0) {
        let targetSlice = null;
        let targetRemaining = 0;
        let targetSliceTotal = 0;
        let targetRatio = 0;
        let targetPenalty = 0;

        for (const s of slices) {
            const baseAmount = Number(s.amount) || 0;
            const ratio = baseAmount / (breakdown.total || 1);
            
            const slicePaidAmount = (loan.history || []).reduce((acc, h) => {
                const hDue = h.originalDueDate ? new Date(h.originalDueDate) : new Date(h.date);
                if (hDue.getMonth() === currentMonth && hDue.getFullYear() === currentYear && h.note?.includes(`Dia ${s.day}`)) {
                    return acc + h.amount;
                }
                return acc;
            }, 0);

            const isPaid = slicePaidAmount >= (baseAmount - 0.05);
            let slicePenalty = 0;
            const sliceDate = new Date(currentYear, currentMonth, Number(s.day));
            
            if (!isPaid && sliceDate < today && loan.status !== 'Pago' && loan.status !== 'Quitado') {
                const sliceOverdue = calculateOverdueValue(baseAmount, sliceDate.toISOString().split('T')[0], 'Atrasado', Number(loan.fineRate || 0), Number(loan.moraInterestRate || 0), loan.amount * ratio);
                slicePenalty = sliceOverdue - baseAmount;
            }
            
            const sliceTotal = baseAmount + slicePenalty;

            if (slicePaidAmount < (sliceTotal - 0.05) && !targetSlice) {
                targetSlice = s;
                targetRemaining = sliceTotal - slicePaidAmount;
                targetSliceTotal = sliceTotal;
                targetRatio = ratio;
                targetPenalty = slicePenalty;
            }
        }

        if (targetSlice) {
            const remRatio = targetRemaining / targetSliceTotal; 
            const sliceIntOriginal = breakdown.interest * targetRatio;
            const sliceCapOriginal = breakdown.capital * targetRatio;

            const remainingCapitalDebt = Math.max(0, loan.amount - (loan.totalPaidCapital || 0));
            let autoCap = sliceCapOriginal * remRatio;
            
            if (autoCap > remainingCapitalDebt) autoCap = remainingCapitalDebt;
            
            const expectedTotal = targetRemaining;
            const autoInt = expectedTotal - autoCap;

            autoCapital = autoCap.toFixed(2);
            autoInterest = autoInt.toFixed(2);
            (window as any).lastSelectedDay = targetSlice.day;
        }
    } else {
        if (status === 'Atrasado') {
            const fullOverdue = calculateOverdueValue(breakdown.total, loan.nextDue, 'Atrasado', Number(loan.fineRate || 0), Number(loan.moraInterestRate || 0), loan.amount);
            totalPenalty = fullOverdue - breakdown.total;
        }
        // 🚀 FIX 2: Subtrai o que o cara JÁ PAGOU da sugestão na tela. Não cobra o valor cheio de novo!
        const remainingCap = Math.max(0, breakdown.capital - accCap);
        const remainingInt = Math.max(0, (breakdown.interest + totalPenalty) - accInt);

        autoCapital = remainingCap > 0 ? remainingCap.toFixed(2) : '';
        autoInterest = remainingInt > 0 ? remainingInt.toFixed(2) : '';
    }

    setPayCapital(autoCapital);
    setPayInterest(autoInterest);
    setSettleInterest(false);
    setIsDiscountSettlement(false); // 🚀 Limpa a checkbox de Desconto ao abrir novo modal
    
    // 🚀 FIX 3: Base do CycleMissing blindada para considerar Acordos extras.
    const expectedInterest = breakdown.interest;
    const requiredTotal = loan.interestType === 'SIMPLE' ? expectedInterest : breakdown.total;
    const accumulatedTotal = loan.interestType === 'SIMPLE' ? accInt : (accInt + accCap);
    setCycleMissing(Math.max(0, requiredTotal - accumulatedTotal));

    setForceAdvanceMonth(false);
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

    // 🚀 LÓGICA INTELIGENTE DE AVANÇO DE MÊS + CAIXA DE SELEÇÃO MANUAL
    let shouldAdvanceMonth = false;
    
    if (forceAdvanceMonth) {
        shouldAdvanceMonth = true;
        noteText += " [AVANÇO MANUAL]";
    } else {
        // 🚀 FIX: Agora só avança se o valor pago AGORA bater com o que faltava na parcela
        const paidNow = isSimple ? valInterest : valTotal;
        shouldAdvanceMonth = paidNow >= (cycleMissing - 0.10); // Tolerância de centavos
    }

    // 🚀 LÓGICA DE QUITAÇÃO COM DESCONTO
    if (isDiscountSettlement) {
        updatedLoan.status = 'Quitado';
        updatedLoan.installments = 0;
        if (isSimple) updatedLoan.installmentValue = 0;
        // Perdoa o capital restante que ele não digitou no modal
        updatedLoan.totalPaidCapital = updatedLoan.amount; 
        
        const missedProfit = (updatedLoan.projectedProfit || 0) - updatedLoan.totalPaidInterest;
        noteText += ` [QUITAÇÃO COM DESCONTO] Perdão de Juros: R$ ${formatMoney(Math.max(0, missedProfit))}`;
    } else if (balance <= 0.10) {
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
                 
                 if (!isSimple) {
                     updatedLoan.installments = (updatedLoan.installments || 0) - 1;
                     
                     // 🚀 TRAVA DO INFINITO (R$ ∞): Se "rolou a dívida" e sobrou capital, a parcela NUNCA pode ser zero!
                     if (balance > 0.10 && updatedLoan.installments <= 0) {
                         updatedLoan.installments = 1; 
                     } else if (balance <= 0.10 && updatedLoan.installments <= 0) {
                         updatedLoan.status = 'Quitado';
                         updatedLoan.installments = 0;
                     }
                 }
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
        
        // 🚀 BUMERANGUE: Retorna pro Modal de Cobrança se ele veio de lá!
        if (returnToModal === 'collection') {
            setIsCollectionModalOpen(true);
            setReturnToModal(null);
        } else {
            setSelectedLoan(updatedLoan);
            setDetailTab('history');
            setIsDetailsOpen(true);
        }
    } catch (err) { alert("Erro ao registrar."); }
  };

  const handleUndoLastPayment = async () => {
    if (!selectedLoan || !selectedLoan.history || selectedLoan.history.length === 0) return;

    const history = selectedLoan.history;
    const lastEntry = history[history.length - 1]; 

    const confirmUndo = window.confirm(
        `⚠️ ESTORNO DE REGISTRO\n\n` +
        `Deseja desfazer o registro de ${lastEntry.type}?\n\n` +
        `O vencimento voltará para: ${formatDisplayDate(lastEntry.originalDueDate || '')}`
    );

    if (!confirmUndo) return;

    let updatedLoan = { ...selectedLoan };

    updatedLoan.agreementValue = 0;
    updatedLoan.status = 'Em Dia'; 

    if (lastEntry.type !== 'Acordo') {
        updatedLoan.totalPaidCapital = Math.max(0, (updatedLoan.totalPaidCapital || 0) - (lastEntry.capitalPaid || 0));
        updatedLoan.totalPaidInterest = Math.max(0, (updatedLoan.totalPaidInterest || 0) - (lastEntry.interestPaid || 0));
        
        const isSimple = updatedLoan.interestType === 'SIMPLE';
        
        // RECUPERAÇÃO DO NÚMERO DE PARCELAS
        if (!isSimple) {
            if (lastEntry.note?.includes('[QUITAÇÃO TOTAL]')) {
                 const totalReceivable = updatedLoan.amount + (updatedLoan.projectedProfit || 0);
                 const originalInstallments = Math.max(1, Math.round(totalReceivable / updatedLoan.installmentValue));
                 const cyclesPaidBeforeThis = history.filter(h => h.note?.includes('[CICLO COMPLETADO]') && h.date !== lastEntry.date).length;
                 updatedLoan.installments = Math.max(1, originalInstallments - cyclesPaidBeforeThis);
            } else if (lastEntry.note?.includes('[CICLO COMPLETADO]')) {
                 updatedLoan.installments += 1;
            }
        }

        if (isSimple && (lastEntry.capitalPaid && lastEntry.capitalPaid > 0)) {
            const restoredBalance = updatedLoan.amount - updatedLoan.totalPaidCapital;
            let periodRate = updatedLoan.interestRate / 100;
            if (updatedLoan.frequency === 'SEMANAL') periodRate = periodRate / 4;
            else if (updatedLoan.frequency === 'DIARIO') periodRate = periodRate / 30;
            updatedLoan.installmentValue = restoredBalance * periodRate;
        }
    }

    if (lastEntry.originalDueDate) {
        updatedLoan.nextDue = lastEntry.originalDueDate;
    }

    updatedLoan.history = history.slice(0, -1);

    try {
        await loanService.update(
            selectedLoan.id, 
            updatedLoan, 
            'ESTORNO DE REGISTRO', 
            `Desfez o último registro de ${lastEntry.type} do cliente ${selectedLoan.client}.`
        );
        setLoans(prev => prev.map(l => l.id === updatedLoan.id ? updatedLoan : l));
        setSelectedLoan(updatedLoan);
    } catch (err) {
        alert("Erro ao sincronizar com o servidor.");
    }
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
              guarantorAddress: loan.guarantorAddress || '',
              multiDates: loan.multiDates ? [...loan.multiDates] : [], // 🚀 FIX: Carrega as fatias existentes do banco para a tela
              editReason: '' // 🚀 NOVO: Campo para registrar o motivo da edição
            });
            setIsEditContractModalOpen(true);
            setOpenMenuId(null);
        };

  const confirmEditContract = async () => {
      if (!selectedLoan || !editContractData.id) return;
      
      if (editContractData.id !== selectedLoan.id && loans.some(l => l.id === editContractData.id)) {
          alert(`O ID ${editContractData.id} já existe em outro contrato.`);
          return;
      }
      
      const isSimple = selectedLoan.interestType === 'SIMPLE';
      const newAmount = parseFloat(editContractData.amount) || selectedLoan.amount;
      const newInterestRate = parseFloat(editContractData.interestRate) || selectedLoan.interestRate;
      // 🚀 TRAVA DO INFINITO: Garante que o divisor será no mínimo 1
      const numInst = isSimple ? 1 : Math.max(1, (parseInt(editContractData.installments) || selectedLoan.installments));
      
      // 🚀 MATEMÁTICA BLINDADA: O sistema recalcula o valor exato da parcela na hora de salvar usando o SALDO DEVEDOR!
      let newInstallmentValue = 0;
      let periodRate = newInterestRate / 100;
      if (selectedLoan.frequency === 'SEMANAL') periodRate = periodRate / 4;
      else if (selectedLoan.frequency === 'DIARIO') periodRate = periodRate / 30;

      const currentBalance = Math.max(0, newAmount - (selectedLoan.totalPaidCapital || 0));

      if (isSimple) {
          newInstallmentValue = currentBalance * periodRate;
      } else {
          if (periodRate === 0) newInstallmentValue = currentBalance / numInst;
          else newInstallmentValue = currentBalance * ((periodRate * Math.pow(1 + periodRate, numInst)) / (Math.pow(1 + periodRate, numInst) - 1));
      }
      
      newInstallmentValue = Math.round(newInstallmentValue * 100) / 100;

      let newProjectedProfit = selectedLoan.projectedProfit;
      if (!isSimple) {
          newProjectedProfit = Math.max(0, (newInstallmentValue * numInst) - newAmount);
      }

      // 🚀 FIX: Limpa e prepara as fatias editadas garantindo que são números válidos
      const finalMultiDates = (editContractData.multiDates || []).map((md: any) => ({
          day: parseInt(md.day),
          amount: parseFloat(md.amount)
      })).filter((md: any) => !isNaN(md.day) && !isNaN(md.amount));

      const updatedLoan = { 
          ...selectedLoan, 
          id: editContractData.id,
          amount: newAmount,
          interestRate: newInterestRate,
          installments: isSimple ? 1 : (parseInt(editContractData.installments) || selectedLoan.installments),
          installmentValue: newInstallmentValue,
          projectedProfit: newProjectedProfit,
          startDate: editContractData.startDate, 
          nextDue: editContractData.nextDue,
          fineRate: parseFloat(editContractData.fineRate) || 0,
          moraInterestRate: parseFloat(editContractData.moraInterestRate) || 0,
          clientBank: editContractData.clientBank,
          paymentMethod: editContractData.paymentMethod,
          guarantorName: editContractData.guarantorName,
          guarantorCPF: editContractData.guarantorCPF,
          guarantorAddress: editContractData.guarantorAddress,
          multiDates: finalMultiDates // 🚀 FIX: Salva as novas fatias editadas
      };

      try {
          // 🚀 FIX: Grava o motivo da edição no extrato financeiro para controle do Rodrigo
          const logMessage = editContractData.editReason 
              ? `Ficha do contrato editada pelo painel. Motivo: ${editContractData.editReason}` 
              : `Ficha do contrato editada pelo painel.`;

          await loanService.update(
              selectedLoan.id,
              updatedLoan,
              'EDIÇÃO DE CONTRATO',
              logMessage
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
        { header: 'CPF', key: 'cpf', width: 18 },
        { header: 'Endereço Completo', key: 'address', width: 50 },
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
        // Cruzando dados com a base de clientes para puxar CPF e Endereço
        const clientData = availableClients.find(c => c.name === loan.client);
        let cpfStr = clientData?.cpf || '-';
        let addressStr = '-';

        if (clientData) {
            const addrParts = [];
            if (clientData.address) addrParts.push(clientData.address);
            if (clientData.number) addrParts.push(clientData.number);
            if ((clientData as any).block) addrParts.push(`BLOCO ${(clientData as any).block}`);
            if ((clientData as any).floor) addrParts.push(`APTO ${(clientData as any).floor}`);
            if ((clientData as any).neighborhood) addrParts.push((clientData as any).neighborhood);
            if (clientData.city) addrParts.push(clientData.city);
            if (clientData.state) addrParts.push(clientData.state);
            if (clientData.cep) addrParts.push(`CEP: ${clientData.cep}`);
            
            if (addrParts.length > 0) {
                addressStr = addrParts.join(", ");
            }
        }

        if (loan.history && loan.history.length > 0) {
            loan.history.forEach(record => {
                // 🚀 FIX: Trava da exportação limpa baseada no Filtro de Datas de Pagos no Período
                let shouldExport = false;
                
                if (filterStart && filterEnd && statusFilter === 'PagosNoPeriodo') {
                    const hDate = new Date(record.date).toISOString().split('T')[0];
                    const refDate = record.originalDueDate ? new Date(record.originalDueDate).toISOString().split('T')[0] : hDate;
                    
                    const paidInPeriod = hDate >= filterStart && hDate <= filterEnd;
                    const refInPeriod = refDate >= filterStart && refDate <= filterEnd;
                    
                    // Exige que cumpra a competência e o caixa. Ignora Abertura e Acordo.
                    if (paidInPeriod && refInPeriod && record.amount > 0 && !record.type.toLowerCase().includes('abertura') && record.type !== 'Acordo') {
                        shouldExport = true;
                    }
                } else {
                    // Comportamento normal para visões gerais
                    if (record.amount > 0 || record.type === 'Abertura') {
                        shouldExport = true;
                    }
                }

                if (shouldExport) {
                    hasRecords = true;
                    worksheet.addRow({
                        paymentDate: new Date(record.date).toLocaleDateString('pt-BR') + ' ' + new Date(record.date).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'}),
                        id: loan.id, 
                        client: loan.client,
                        cpf: cpfStr,
                        address: addressStr,
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

    const colunasMoeda = ['G', 'H', 'I']; // Ajustado devido à inserção das colunas CPF (D) e Endereço (E)
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

    // --- TRAVA DE SEGURANÇA: SOMA DAS FATIAS ---
    if (formData.isMultiDate && formData.multiDates && formData.multiDates.length > 0) {
      const totalSlices = formData.multiDates.reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
      
      let expectedInstallment = simulation.installment;
      if (formData.isMigration) {
         const mCap = parseFloat(formData.manualInstallmentCapital) || 0;
         const mInt = parseFloat(formData.manualInstallmentInterest) || 0;
         expectedInstallment = formData.interestType === 'SIMPLE' ? mInt : (mCap + mInt);
      }

      const diff = Math.abs(totalSlices - expectedInstallment);
      
      // Nova tolerância de R$ 5,00 para proteger arredondamentos
      if (diff > 5.00) { 
        alert(`❌ ERRO DE VALOR: A soma das fatias (R$ ${formatMoney(totalSlices)}) não coincide com o valor da parcela exigida (R$ ${formatMoney(expectedInstallment)}).\n\nAjuste os valores antes de aprovar.`);
        return;
      }
    }

    setIsSaving(true);

    try {
        const selectedClientObj = availableClients.find(c => 
            c.name.trim().toLowerCase() === formData.client.trim().toLowerCase()
        );
        
        if (!selectedClientObj) {
            alert("❌ ERRO: Cliente não encontrado. Certifique-se de selecionar um nome da lista de sugestões.");
            setIsSaving(false);
            return;
        }

        let finalID = formData.manualID;

        // PADRÃO DE ID ANUAL (001/2026)
        if (!finalID) {
            const year = new Date().getFullYear();
            const yearLoans = loans.filter(l => l.id.endsWith(`/${year}`));
            let maxSeq = 0;
            yearLoans.forEach(l => { 
                const parts = l.id.split('/'); 
                if(parts.length === 2) { 
                    const seq = parseInt(parts[0]); 
                    if(!isNaN(seq) && seq > maxSeq) maxSeq = seq; 
                } 
            });
            finalID = `${(maxSeq + 1).toString().padStart(3, '0')}/${year}`;
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
                 finalInstallmentValue = parseFloat(formData.manualInstallmentInterest) || 0;
                 projectedProfit = 0;
            } else {
                 const mCap = parseFloat(formData.manualInstallmentCapital) || 0;
                 const mInt = parseFloat(formData.manualInstallmentInterest) || 0;
                 // 🚀 BLINDAGEM MIGRACAO: Trava arredondamento na parcela fixa
                 finalInstallmentValue = Math.round((mCap + mInt) * 100) / 100;
                 projectedProfit = Math.round(((mInt * numInst) + initInt) * 100) / 100;
            }
        } else {
            // 🚀 AQUI ESTAVA O BUG: Agora cravamos 100% o valor que o simulador calculou e arredondou
            finalInstallmentValue = simulation.installment;
            const totalReceivable = Math.round((simulation.installment * numInst) * 100) / 100;
            
            projectedProfit = isSimpleMode 
                ? totalReceivable 
                : Math.max(0, totalReceivable - finalAmount);
            
            projectedProfit = Math.round(projectedProfit * 100) / 100;
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
            let amt = parseFloat(md.amount as any);
            
            if (formData.isMigration && finalInstallmentValue > 0) {
                const totalManualMultiDates = formData.multiDates.reduce((acc, curr) => acc + (parseFloat(curr.amount as any) || 0), 0);
                const ratio = finalInstallmentValue / (totalManualMultiDates || 1);
                amt = Number((amt * ratio).toFixed(2));
            }
            
            return {
                day: parseInt(md.day as any),
                amount: amt
            };
        }).filter(md => !isNaN(md.day) && !isNaN(md.amount)) : [];        

        const newLoan: any = { 
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
            multiDates: finalMultiDates 
        };

        await loanService.create(newLoan as any);

        fetchLoans(); 
        closeLoanFlow();
        alert("✅ Contrato aprovado e salvo com sucesso!");
    } catch (err) { 
        console.error(err);
        alert("Erro ao salvar o contrato."); 
    } finally { 
        setIsSaving(false); 
    }
};

  const handleDelete = async (id: string) => { if (confirm('Deseja excluir?')) { try { await loanService.delete(id); fetchLoans(); setIsDetailsOpen(false); } catch (err) { alert("Erro ao excluir."); } } };

  // 🚀 MOTOR DE SCROLL BUMERANGUE: Devolve a tela para onde o Rodrigo estava!
  useEffect(() => {
      if (isCollectionModalOpen && collectionScrollRef.current > 0) {
          const timer = setTimeout(() => {
              const scrollableDiv = document.querySelector('.collection-scroll-container');
              if (scrollableDiv) {
                  scrollableDiv.scrollTop = collectionScrollRef.current;
              }
          }, 150);
          return () => clearTimeout(timer);
      } else if (!isCollectionModalOpen && returnToModal !== 'collection') {
          collectionScrollRef.current = 0;
      }
  }, [isCollectionModalOpen, collectionLoans, returnToModal]);

  // 🚀 SEPARADOR DE CONTRATOS PARA LIMPAR POLUIÇÃO VISUAL
  const activeLoans = filteredLoans.filter(loan => getLoanRealStatus(loan) !== 'Quitado');
  const paidLoans = filteredLoans.filter(loan => getLoanRealStatus(loan) === 'Quitado');

  const renderLoanRow = (loan: any) => {
      const displayStatus = getLoanRealStatus(loan);
      const uniqueKey = loan._id || loan.id || Math.random().toString();
      
      let displayInterestPaid = loan.totalPaidInterest || 0;
      if (filterStart && filterEnd && statusFilter === 'PagosNoPeriodo' && loan.history) {
          displayInterestPaid = 0;
          loan.history.forEach((h: any) => {
              const hDate = h.date.split('T')[0];
              const refDate = h.originalDueDate ? h.originalDueDate.split('T')[0] : hDate;
              const paidInPeriod = hDate >= filterStart && hDate <= filterEnd;
              const refInPeriod = refDate >= filterStart && refDate <= filterEnd;

              if (paidInPeriod && refInPeriod && !h.type.toLowerCase().includes('abertura')) {
                  displayInterestPaid += (h.interestPaid || 0);
              }
          });
      }

      return (
        <tr key={uniqueKey} className={`transition-colors group ${selectedIds.includes(loan.id) ? "bg-blue-50/50" : "hover:bg-slate-50/80"}`}>
          <td className="p-4 text-center">
            <input type="checkbox" checked={selectedIds.includes(loan.id)} onChange={() => toggleSelectOne(loan.id)} className="w-4 h-4 rounded border-gray-300 text-slate-900 cursor-pointer" />
          </td>
          <td className="p-4">
            <div className="font-bold text-slate-800">{loan.client}</div>
            {getNickname(availableClients.find(c => c.name === loan.client)?.observations) && (
                <div className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full inline-block mt-0.5 mb-1 w-fit truncate max-w-[200px]" title={getNickname(availableClients.find(c => c.name === loan.client)?.observations)}>
                  {getNickname(availableClients.find(c => c.name === loan.client)?.observations)}
                </div>
            )}
            <div className="text-[10px] font-mono text-slate-400">{loan.id}</div>
          </td>
          <td className="p-4 text-center">
            <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold border border-slate-200">{loan.installments}x</span>
          </td>
          <td className="p-4 text-center">
            <span className={`font-bold text-sm ${displayStatus === "Atrasado" ? "text-red-600" : "text-slate-700"}`}>
              {formatDisplayDate(getDisplayNextDue(loan))}
            </span>
          </td>
          <td className="p-4 text-center text-sm font-bold text-blue-600">{getLastPaymentDate(loan)}</td>
          <td className="p-4 text-right font-bold text-slate-700">
            R$ {formatMoney(Math.max(0, loan.amount - (loan.totalPaidCapital || 0)))}
          </td>
          <td className="p-4 text-right font-bold text-green-600 bg-green-50/30 rounded">
            R$ {formatMoney(displayInterestPaid)}
          </td>
          <td className="p-4 text-right font-bold text-slate-500">
            R$ {formatMoney(loan.installmentValue)}
          </td>
          <td className="p-4 text-center">
            <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase shadow-sm ${
                displayStatus === "Em Dia" ? "bg-blue-50 text-blue-700 border border-blue-100"
              : displayStatus === "Atrasado" ? "bg-red-50 text-red-700 border border-red-100"
              : displayStatus === "Acordo" ? "bg-orange-50 text-orange-700 border border-orange-100"
              : displayStatus === "Quitado" ? "bg-green-50 text-green-700 border border-green-100"
              : "bg-gray-100 text-gray-500"
            }`}>
              {displayStatus}
            </span>
          </td>
          <td className="p-4 text-right relative">
            <button onClick={() => handleWhatsApp(loan as LoanExtended, (loan as any).snowball)} className="p-2 bg-green-100 text-green-700 rounded-lg mr-2" title="Whatsapp">
              <MessageCircle size={18} />
            </button>
            <div className="relative inline-block text-left">
              <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === loan.id ? null : loan.id); }} className={`p-2 rounded-lg transition-all ${openMenuId === loan.id ? "bg-slate-200 text-slate-900" : "text-slate-400 hover:text-slate-900 hover:bg-slate-100"}`}>
                <MoreVertical size={18} />
              </button>
              {openMenuId === loan.id && (
                <div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-2xl border border-slate-100 z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                  <div className="py-1">
                    <button onClick={() => { setSelectedLoan(loan); setDetailTab("info"); setIsDetailsOpen(true); setOpenMenuId(null); }} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                      <Eye size={16} className="text-blue-500" /> Ver Detalhes
                    </button>
                    {displayStatus !== "Quitado" && (
                      <>
                        <button onClick={() => { handleOpenPayment(loan); setOpenMenuId(null); }} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                          <DollarSign size={16} className="text-green-600" /> Registrar Baixa
                        </button>
                        <button onClick={() => { handleOpenAgreement(loan); setOpenMenuId(null); }} className="w-full text-left px-4 py-3 text-sm text-orange-700 hover:bg-orange-50 flex items-center gap-2">
                          <FileSignature size={16} /> Registrar Acordo
                        </button>
                      </>
                    )}
                    <button onClick={() => handleOpenEditContract(loan)} className="w-full text-left px-4 py-3 text-sm text-blue-600 hover:bg-blue-50 flex items-center gap-2">
                      <Edit size={16} /> Editar Contrato
                    </button>
                    <div className="border-t border-slate-100 my-1"></div>
                    <button onClick={() => { const c = availableClients.find((cl) => cl.name === loan.client); generateContractPDF(loan, c, companySettings); setOpenMenuId(null); }} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                      <Printer size={16} /> Contrato PDF
                    </button>
                    <button onClick={() => { const c = availableClients.find((cl) => cl.name === loan.client); generatePromissoryPDF(loan, c, companySettings); setOpenMenuId(null); }} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                      <FileText size={16} /> Promissórias
                    </button>
                    <div className="border-t border-slate-100 my-1"></div>
                    <button onClick={() => { handleDelete(loan.id); setOpenMenuId(null); }} className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                      <Trash2 size={16} /> Excluir
                    </button>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      );
  };

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
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-6 px-4 pb-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
             <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh] overflow-hidden animate-in slide-in-from-top-4 duration-300 border border-slate-200 relative z-[70] ring-1 ring-black/5 mt-0 sm:mt-2">
                 <div className="bg-slate-900 p-5 flex justify-between items-center shrink-0">
                     <div className="flex items-center gap-3 text-white font-bold">
                         <div className="bg-yellow-400/20 p-2 rounded-lg">
                             <Calendar className="text-yellow-400" size={20}/>
                         </div>
                         <span>Central de Cobrança</span>
                     </div>
                     <button onClick={() => setIsCollectionModalOpen(false)} className="text-white/50 hover:text-white hover:bg-white/10 p-2 rounded-full transition-all"><X size={20}/></button>
                 </div>
                 <div className="p-5 bg-slate-50/80 border-b border-slate-100 flex flex-col gap-3 shrink-0">
                     <div>
                         <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Data de Referência</label>
                         <input type="date" value={collectionDate} onChange={(e) => setCollectionDate(e.target.value)} className="w-full p-3.5 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-yellow-400/30 focus:border-yellow-400 transition-all shadow-sm bg-white"/>
                     </div>
                     <div className="relative">
                         <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                         <input type="text" placeholder="Buscar cliente ou contrato..." value={collectionSearchTerm} onChange={(e) => setCollectionSearchTerm(e.target.value)} className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-yellow-400/30 transition-all bg-white shadow-sm"/>
                     </div>
                 </div>
                 {/* 🚀 O segredo está aqui: flex-1 forçará a lista a consumir o espaço interno corretamente! */}
                 <div className="p-5 flex-1 overflow-y-auto custom-scrollbar collection-scroll-container bg-white">
                                 {collectionLoans.length === 0 ? (
                                     <div className="text-center py-10">
                                         <div className="bg-green-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3">
                                             <CheckCircle size={32} className="text-green-500"/>
                                         </div>
                                         <p className="text-slate-800 font-bold">Tudo limpo por aqui!</p>
                                         <p className="text-slate-400 text-xs mt-1">Nenhum vencimento pendente para esta data.</p>
                                     </div>
                                 ) : (
                                     <div className="space-y-4">
                                         <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Clientes para cobrar hoje ({collectionLoans.length} contratos):</p>
                                         {(() => {
                                             // 🚀 APLICA A BUSCA E DEPOIS AGRUPA POR CLIENTE
                                             const filteredCollection = collectionLoans.filter(l => 
                                                 l.client.toLowerCase().includes(collectionSearchTerm.toLowerCase()) || 
                                                 l.id.includes(collectionSearchTerm)
                                             );
                                             const grouped: Record<string, { total: number, loans: Loan[] }> = {};
                                             filteredCollection.forEach(l => {
                                                 if (!grouped[l.client]) grouped[l.client] = { total: 0, loans: [] };
                                                 
                                                 // Calcula valor da parcela/fatia exato para o dia
                                                 let amt = 0;
                                                 const validSlices = (l as any).multiDates?.filter((s: any) => s && s.day && !isNaN(Number(s.day)) && Number(s.day) > 0 && parseVal(s.amount) > 0) || [];
                                                 if (validSlices.length > 0 && l.status !== 'Acordo') {
                                                     const targetDay = Number(collectionDate.split('-')[2]);
                                                     const slice = validSlices.find((s:any) => Number(s.day) === targetDay);
                                                     if (slice) amt = parseVal(slice.amount);
                                                     else amt = getSyncedBreakdown(l).total; // Fallback seguro
                                                 } else {
                                                     amt = getSyncedBreakdown(l).total; // 🚀 FIX: Cobre PRICE, SIMPLE e soma o Acordo Extra
                                                 }
                                                 
                                                 grouped[l.client].total += amt;
                                                 grouped[l.client].loans.push(l);
                                             });

                                             return Object.entries(grouped).map(([clientName, data]) => (
                                                 <div key={clientName} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:border-yellow-400 transition-all">
                                                     <div className="p-4 bg-slate-50/50 flex justify-between items-center border-b border-slate-100">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center text-white font-black text-sm shadow-md">{clientName.charAt(0)}</div>
                                                            <div>
                                                                <p className="font-bold text-slate-800">{clientName}</p>
                                                                {getNickname(availableClients.find(c => c.name === clientName)?.observations) && (
                                                                    <p className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full inline-block mt-0.5 truncate max-w-[150px]">
                                                                        {getNickname(availableClients.find(c => c.name === clientName)?.observations)}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Total no Dia</p>
                                                            <p className="font-black text-slate-800 text-lg">R$ {formatMoney(data.total)}</p>
                                                        </div>
                                                     </div>
                                                     <div className="p-2 divide-y divide-slate-50">
                                                         {data.loans.map(l => {
                                                             // Valor individual deste contrato na listagem
                                                             let cAmt = 0;
                                                             const validSlices = (l as any).multiDates?.filter((s: any) => s && s.day && !isNaN(Number(s.day)) && Number(s.day) > 0 && parseVal(s.amount) > 0) || [];
                                                             if (validSlices.length > 0 && l.status !== 'Acordo') {
                                                                 const targetDay = Number(collectionDate.split('-')[2]);
                                                                 const slice = validSlices.find((s:any) => Number(s.day) === targetDay);
                                                                 if (slice) cAmt = parseVal(slice.amount);
                                                                 else cAmt = getSyncedBreakdown(l).total;
                                                             } else {
                                                                 cAmt = getSyncedBreakdown(l).total; // 🚀 FIX: Cobre PRICE, SIMPLE e Acordo Extra
                                                             }

                                                             return (
                                                             <div key={l.id} className="flex justify-between items-center p-3 hover:bg-yellow-50 rounded-xl cursor-pointer group transition-colors" onClick={(e) => { 
                                                                 // 🚀 CAPTURA O SCROLL ATUAL DA CAIXA
                                                                 const scrollableDiv = e.currentTarget.closest('.collection-scroll-container');
                                                                 if (scrollableDiv) collectionScrollRef.current = scrollableDiv.scrollTop;
                                                                 
                                                                 setReturnToModal('collection'); 
                                                                 setIsCollectionModalOpen(false); 
                                                                 handleOpenPayment(l); 
                                                             }}>
                                                                 <div>
                                                                     <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest group-hover:text-yellow-700 transition-colors">Contrato: {l.id}</p>
                                                                     <p className="text-xs font-black text-slate-700 mt-0.5">R$ {formatMoney(cAmt)}</p>
                                                                 </div>
                                                                 <span className="text-[9px] uppercase font-bold bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg shadow-sm group-hover:bg-yellow-400 group-hover:text-yellow-900 group-hover:border-yellow-400 transition-all">Abrir Fatura ➔</span>
                                                             </div>
                                                         )})}
                                                     </div>
                                                 </div>
                                             ));
                                         })()}
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

                  <select value={sortOrder} onChange={(e: any) => setSortOrder(e.target.value)} className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium outline-none cursor-pointer hover:bg-slate-50 transition-colors shadow-sm">
                      <option value="newest">Mais Recentes</option>
                      <option value="oldest">Mais Antigos</option>
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
                {filteredLoans.length === 0 ? (
                    <tr><td colSpan={10} className="p-8 text-center text-slate-400">Nenhum contrato encontrado.</td></tr>
                ) : (
                    <>
                        {/* 1. CONTRATOS ATIVOS SEMPRE NO TOPO */}
                        {activeLoans.map(loan => renderLoanRow(loan))}

                        {/* 2. GAVETA DOS QUITADOS (SANFONA) */}
                        {paidLoans.length > 0 && statusFilter !== 'Quitado' && (
                            <tr 
                                className="bg-slate-100/50 hover:bg-slate-100 cursor-pointer transition-colors" 
                                onClick={() => setShowPaidLoans(!showPaidLoans)}
                            >
                                <td colSpan={10} className="p-4 text-center text-slate-500 font-bold text-xs uppercase tracking-widest border-y border-slate-200">
                                    {showPaidLoans ? <ChevronUp size={16} className="inline mr-2 -mt-0.5"/> : <ChevronDown size={16} className="inline mr-2 -mt-0.5"/>}
                                    {showPaidLoans ? 'Ocultar' : 'Mostrar'} {paidLoans.length} Contrato(s) Quitado(s) / Histórico
                                </td>
                            </tr>
                        )}

                        {/* 3. CONTRATOS QUITADOS (ABRE QUANDO CLICA NA GAVETA) */}
                        {(showPaidLoans || statusFilter === 'Quitado') && paidLoans.map(loan => renderLoanRow(loan))}
                    </>
                )}
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
                        <h3 className="text-xl font-black mb-0">{selectedLoan.client}</h3>
                        {getNickname(availableClients.find(c => c.name === selectedLoan.client)?.observations) && (
                            <p className="text-xs font-medium text-blue-300 mb-1">
                                {getNickname(availableClients.find(c => c.name === selectedLoan.client)?.observations)}
                            </p>
                        )}
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
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100"><span className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1"><Percent size={10}/> Taxa de Juros</span><span className="text-sm font-bold text-slate-800">{Number(selectedLoan.interestRate).toFixed(2)}% a.m</span></div>
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
            
            {/* STATUS DA PARCELA COM MULTA - REDESIGN LIGHT/CLEAN */}
            {(() => {
                const breakdown = getSyncedBreakdown(selectedLoan);
                const status = getLoanRealStatus(selectedLoan);
                let displayTotal = breakdown.total;
                let isFatiaAtrasada = false;
                let bannerDateStr = selectedLoan.nextDue;
                
                const slices = (selectedLoan as any).multiDates || [];
                
                if (slices.length > 0) {
                    const currentMonth = new Date(selectedLoan.nextDue).getMonth();
                    const currentYear = new Date(selectedLoan.nextDue).getFullYear();
                    const today = new Date();
                    today.setHours(0,0,0,0);
                    
                    let totalSlicesCalc = 0;
                    let firstOverdueSliceDate: string | null = null;
                    
                    for (const slice of slices) {
                        const baseAmount = Number(slice.amount) || 0;
                        const sliceDate = new Date(currentYear, currentMonth, Number(slice.day));
                        
                        const slicePaidAmount = (selectedLoan.history || []).reduce((acc, h) => {
                            const hDue = h.originalDueDate ? new Date(h.originalDueDate) : new Date(h.date);
                            if (hDue.getMonth() === currentMonth && hDue.getFullYear() === currentYear && h.note?.includes(`Dia ${slice.day}`)) {
                                return acc + h.amount;
                            }
                            return acc;
                        }, 0);

                        const isPaid = slicePaidAmount >= (baseAmount - 0.05);
                        let slicePenalty = 0;
                        
                        if (!isPaid && sliceDate < today && selectedLoan.status !== 'Pago' && selectedLoan.status !== 'Quitado') {
                            isFatiaAtrasada = true;
                            if (!firstOverdueSliceDate) {
                                firstOverdueSliceDate = sliceDate.toISOString().split('T')[0];
                            }
                            const ratio = baseAmount / (breakdown.total || 1);
                            const sliceOverdue = calculateOverdueValue(baseAmount, sliceDate.toISOString().split('T')[0], 'Atrasado', Number(selectedLoan.fineRate || 0), Number(selectedLoan.moraInterestRate || 0), selectedLoan.amount * ratio);
                            slicePenalty = sliceOverdue - baseAmount;
                        }
                        
                        totalSlicesCalc += Math.max(0, (baseAmount + slicePenalty) - slicePaidAmount);
                    }
                    displayTotal = totalSlicesCalc;
                    if (firstOverdueSliceDate) bannerDateStr = firstOverdueSliceDate;
                } else if (status === 'Atrasado') {
                    displayTotal = calculateOverdueValue(breakdown.total, selectedLoan.nextDue, 'Atrasado', Number(selectedLoan.fineRate || 0), Number(selectedLoan.moraInterestRate || 0), selectedLoan.amount);
                }

                const showAtraso = (slices.length > 0) ? isFatiaAtrasada : (status === 'Atrasado');

                return (
                    <div className={`p-5 rounded-2xl shadow-sm border relative overflow-hidden ${showAtraso ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                        <div className={`absolute top-0 right-0 p-4 opacity-10 ${showAtraso ? 'text-red-900' : 'text-slate-900'}`}><Database size={48} /></div>
                        
                        <div className="flex items-center gap-2 mb-1">
                            {showAtraso && <AlertTriangle size={16} className="text-red-600" />}
                            <p className={`text-[10px] font-black uppercase tracking-widest ${showAtraso ? 'text-red-600' : 'text-slate-500'}`}>
                                {showAtraso ? (slices.length > 0 ? 'Fatia em Atraso' : 'Vencimento em Atraso') : 'Próximo Vencimento em Aberto'}
                            </p>
                        </div>
                        
                        <p className={`text-2xl font-black ${showAtraso ? 'text-red-900' : 'text-slate-800'}`}>
                            {formatDisplayDate(bannerDateStr)}
                        </p>
                        
                        <div className={`flex justify-between items-center mt-3 border-t pt-3 ${showAtraso ? 'border-red-200' : 'border-slate-200'}`}>
                            <span className={`text-xs font-bold uppercase ${showAtraso ? 'text-red-500' : 'text-slate-500'}`}>Total Restante Devido:</span>
                            <span className={`text-xl font-black ${showAtraso ? 'text-red-700' : 'text-green-600'}`}>R$ {formatMoney(displayTotal)}</span>
                        </div>
                    </div>
                );
            })()}

            {/* LISTAGEM DE FATIAS COM MULTA PROPORCIONAL E PAGAMENTO PARCIAL - REDESIGN ALTO CONTRASTE */}
            {((selectedLoan as any).multiDates && (selectedLoan as any).multiDates.length > 0) ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="bg-slate-800 p-1.5 rounded-lg text-white shadow-sm"><Layers size={16}/></div>
                        <h4 className="text-sm font-black text-slate-800 uppercase tracking-wide">Fatias do Mês Atual</h4>
                    </div>
                    <div className="space-y-3">
                        {(selectedLoan as any).multiDates.map((slice: any, idx: number) => {
                            const breakdown = getSyncedBreakdown(selectedLoan);
                            const baseAmount = Number(slice.amount) || 0;
                            const currentMonth = new Date(selectedLoan.nextDue).getMonth();
                            const currentYear = new Date(selectedLoan.nextDue).getFullYear();
                            const today = new Date();
                            today.setHours(0,0,0,0);
                            const sliceDate = new Date(currentYear, currentMonth, Number(slice.day));
                            
                            const slicePaidAmount = (selectedLoan.history || []).reduce((acc, h) => {
                                const hDue = h.originalDueDate ? new Date(h.originalDueDate) : new Date(h.date);
                                if (hDue.getMonth() === currentMonth && hDue.getFullYear() === currentYear && h.note?.includes(`Dia ${slice.day}`)) {
                                    return acc + h.amount;
                                }
                                return acc;
                            }, 0);

                            const isPaid = slicePaidAmount >= (baseAmount - 0.05);
                            let slicePenalty = 0;
                            
                            if (!isPaid && sliceDate < today && selectedLoan.status !== 'Pago' && selectedLoan.status !== 'Quitado') {
                                const ratio = baseAmount / (breakdown.total || 1);
                                const sliceOverdue = calculateOverdueValue(baseAmount, sliceDate.toISOString().split('T')[0], 'Atrasado', Number(selectedLoan.fineRate || 0), Number(selectedLoan.moraInterestRate || 0), selectedLoan.amount * ratio);
                                slicePenalty = sliceOverdue - baseAmount;
                            }
                            
                            const finalAmount = baseAmount + slicePenalty;
                            const remainingToPay = Math.max(0, finalAmount - slicePaidAmount);
                            const isSelected = (window as any).lastSelectedDay === slice.day;

                            return (
                                <div key={idx} className={`flex justify-between items-center p-4 border rounded-xl transition-all ${
                                    isPaid ? 'bg-green-50 border-green-200 opacity-80' : 
                                    isSelected ? 'bg-blue-50 border-blue-500 shadow-md ring-1 ring-blue-500' : 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'
                                }`}>
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm border-2 ${
                                            isPaid ? 'bg-green-100 text-green-600 border-green-200' : 
                                            isSelected ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-100 text-slate-500 border-slate-200'
                                        }`}>
                                            {isPaid ? <Check size={16}/> : idx + 1}
                                        </div>
                                        <div>
                                            <p className={`text-[11px] font-black uppercase tracking-wider mb-0.5 ${
                                                isPaid ? 'text-green-600' : isSelected ? 'text-blue-700' : 'text-slate-500'
                                            }`}>Vencimento: Dia {String(slice.day).padStart(2, '0')}</p>
                                            
                                            <div className="flex items-center flex-wrap gap-2">
                                                <p className={`text-base font-black ${
                                                    isPaid ? 'text-green-700 line-through opacity-70' : 
                                                    isSelected ? 'text-blue-900' : 'text-slate-900'
                                                }`}>
                                                    R$ {formatMoney(remainingToPay > 0 ? remainingToPay : finalAmount)}
                                                </p>
                                                
                                                {slicePaidAmount > 0 && !isPaid && (
                                                    <span className="text-[10px] text-orange-700 font-bold bg-orange-100 border border-orange-200 px-2 py-0.5 rounded-full shadow-sm">
                                                        Já pago: R$ {formatMoney(slicePaidAmount)}
                                                    </span>
                                                )}
                                                {slicePenalty > 0 && !isPaid && (
                                                    <span className="text-[10px] text-red-600 font-bold bg-red-100 border border-red-200 px-2 py-0.5 rounded-full shadow-sm">
                                                        + Multa inclusa
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    {!isPaid && (
                                        <button 
                                            type="button"
                                            onClick={() => {
                                                const remRatio = remainingToPay / finalAmount;
                                                const ratio = baseAmount / (breakdown.total || 1);
                                                const sliceCapOriginal = breakdown.capital * ratio;
                                                const sliceIntOriginal = breakdown.interest * ratio;
                                                
                                                setPayCapital((sliceCapOriginal * remRatio).toFixed(2));
                                                setPayInterest(((sliceIntOriginal + slicePenalty) * remRatio).toFixed(2));
                                                (window as any).lastSelectedDay = slice.day;
                                                setLoans([...loans]);
                                            }}
                                            className={`px-5 py-2.5 rounded-xl text-xs font-black transition-all ${
                                                isSelected 
                                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' 
                                                    : 'bg-slate-900 text-white hover:bg-slate-800 shadow-md'
                                            }`}
                                        >
                                            {isSelected ? 'SELECIONADO ✓' : 'SELECIONAR'}
                                        </button>
                                    )}
                                    {isPaid && <span className="text-xs font-black text-green-600 uppercase flex items-center gap-1.5 bg-green-100 px-3 py-1.5 rounded-lg border border-green-200"><CheckCircle size={14}/> Quitado</span>}
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

            <div className="mb-1 mt-4">
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Data da Baixa (Pagamento)</label>
                <input type="datetime-local" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none font-bold text-slate-700 focus:ring-2 focus:ring-blue-500/20"/>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Amortização</label>
                    <input type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={payCapital} onChange={(e) => setPayCapital(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none font-black text-slate-700 focus:ring-2 focus:ring-blue-500/20 transition-all" placeholder="0.00"/>
                </div>
                <div>
                    <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Juros + Multa</label>
                    <input type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={payInterest} onChange={(e) => setPayInterest(e.target.value)} className="w-full p-3 border border-green-200 rounded-xl outline-none font-black text-green-700 bg-green-50/50 focus:ring-2 focus:ring-green-500/20 transition-all" placeholder="0.00"/>
                </div>
            </div>

            {/* 🚀 A CHAVE MÁGICA: QUITAÇÃO COM DESCONTO */}
            <div className="flex items-center gap-2 p-3 bg-purple-50 border border-purple-200 rounded-xl">
                <input 
                    type="checkbox" 
                    id="isDiscountSettlement" 
                    checked={isDiscountSettlement} 
                    onChange={(e) => setIsDiscountSettlement(e.target.checked)} 
                    className="w-5 h-5 rounded text-purple-600 focus:ring-purple-500 cursor-pointer" 
                />
                <label htmlFor="isDiscountSettlement" className="text-sm font-bold text-purple-800 cursor-pointer leading-tight">
                    Quitação com Desconto (Perdoar o resto dos juros e finalizar contrato)
                </label>
            </div>

            <div className="bg-slate-100 border border-slate-200 p-4 rounded-xl flex justify-between items-center shadow-inner">
                <span className="text-xs font-bold text-slate-500 uppercase">Total Selecionado:</span>
                <span className="text-xl font-black text-slate-900">R$ {formatMoney(Number(payCapital) + Number(payInterest))}</span>
            </div>

            {/* 🚀 BANNER INTELIGENTE: Calcula ao vivo o que o cliente está digitando na tela */}
            {cycleMissing > 0 && !forceAdvanceMonth && (
                (() => {
                    const paidNowDynamic = selectedLoan?.interestType === 'SIMPLE' ? (parseFloat(payInterest) || 0) : (parseFloat(payCapital) || 0) + (parseFloat(payInterest) || 0);
                    const remainingToClose = Math.max(0, cycleMissing - paidNowDynamic);
                    const willAdvance = paidNowDynamic >= (cycleMissing - 0.05);

                    return (
                        <div className={`mt-2 p-3 rounded-xl border flex items-center justify-between text-sm transition-colors ${
                            willAdvance 
                            ? 'bg-green-50 border-green-200 text-green-800' 
                            : 'bg-orange-50 border-orange-200 text-orange-800'
                        }`}>
                            <span className="font-bold flex items-center gap-1.5">
                                {willAdvance ? <CheckCircle size={16}/> : <AlertCircle size={16}/>}
                                {willAdvance ? 'Parcela será concluída:' : 'Restará para fechar parcela:'}
                            </span>
                            <span className="font-black">R$ {formatMoney(remainingToClose)}</span>
                        </div>
                    );
                })()
            )}

            {/* 🚀 CHECKBOX PARA AVANÇAR O MÊS MANUALMENTE */}
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                <input 
                    type="checkbox" 
                    id="forceAdvanceMonth" 
                    checked={forceAdvanceMonth} 
                    onChange={(e) => setForceAdvanceMonth(e.target.checked)} 
                    className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer" 
                />
                <label htmlFor="forceAdvanceMonth" className="text-sm font-bold text-blue-800 cursor-pointer leading-tight">
                    Forçar conclusão deste ciclo e avançar data para o próximo vencimento.
                </label>
            </div>

            <button onClick={confirmPayment} className="w-full py-4 bg-green-600 text-white rounded-2xl font-black hover:bg-green-700 transition-all shadow-xl shadow-green-900/20 flex items-center justify-center gap-2 text-sm uppercase tracking-wide">
                <CheckCircle size={20}/> Confirmar Baixa no Sistema
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
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Valor Acordado (R$)</label><input type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={agreementValue} onChange={e => setAgreementValue(e.target.value)} className="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-orange-500/20 font-bold text-slate-800" placeholder=""/></div>
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
              
              <div className="mb-4">
                  <label className="block text-xs font-bold text-slate-500 mb-1">ID do Contrato</label>
                  <input type="text" value={editContractData.id} onChange={e => setEditContractData({...editContractData, id: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none font-bold text-slate-800"/>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-2">Valor (R$)</label>
                      <input type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={editContractData.amount} onChange={e => {
                          const newAmtStr = e.target.value;
                          setEditContractData((prev: any) => {
                              const newAmtNum = parseFloat(newAmtStr) || 0;
                              const rateNum = parseFloat(prev.interestRate) || 0;
                              const inst = selectedLoan?.interestType === 'SIMPLE' ? 1 : (parseInt(prev.installments) || 1);
                              let periodRate = rateNum / 100;
                              if (selectedLoan?.frequency === 'SEMANAL') periodRate /= 4;
                              if (selectedLoan?.frequency === 'DIARIO') periodRate /= 30;
                              let calcInst = 0;
                              const currentBalance = Math.max(0, newAmtNum - (selectedLoan?.totalPaidCapital || 0));
                              if (selectedLoan?.interestType === 'SIMPLE') calcInst = currentBalance * periodRate;
                              else {
                                  if (periodRate === 0) calcInst = currentBalance / inst;
                                  else calcInst = currentBalance * ((periodRate * Math.pow(1 + periodRate, inst)) / (Math.pow(1 + periodRate, inst) - 1));
                              }
                              return { ...prev, amount: newAmtStr, installmentValue: calcInst > 0 ? (Math.round(calcInst * 100) / 100).toFixed(2) : '' };
                          });
                      }} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5"/>
                  </div>
                  <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-2">Taxa Mensal (%)</label>
                      <input type="number" onWheel={(e) => e.currentTarget.blur()} step="any" value={editContractData.interestRate} onChange={e => {
                          const newRateStr = e.target.value;
                          setEditContractData((prev: any) => {
                              const newRateNum = parseFloat(newRateStr) || 0;
                              const amt = parseFloat(prev.amount) || 0;
                              const inst = selectedLoan?.interestType === 'SIMPLE' ? 1 : (parseInt(prev.installments) || 1);
                              let periodRate = newRateNum / 100;
                              if (selectedLoan?.frequency === 'SEMANAL') periodRate /= 4;
                              if (selectedLoan?.frequency === 'DIARIO') periodRate /= 30;
                              let calcInst = 0;
                              const currentBalance = Math.max(0, amt - (selectedLoan?.totalPaidCapital || 0));
                              if (selectedLoan?.interestType === 'SIMPLE') calcInst = currentBalance * periodRate;
                              else {
                                  if (periodRate === 0) calcInst = currentBalance / inst;
                                  else calcInst = currentBalance * ((periodRate * Math.pow(1 + periodRate, inst)) / (Math.pow(1 + periodRate, inst) - 1));
                              }
                              return { ...prev, interestRate: newRateStr, installmentValue: calcInst > 0 ? (Math.round(calcInst * 100) / 100).toFixed(2) : '' };
                          });
                      }} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5"/>
                  </div>
                  <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-2">Qtd. Parcelas</label>
                      <input type="number" onWheel={(e) => e.currentTarget.blur()} value={selectedLoan?.interestType === 'SIMPLE' ? 1 : editContractData.installments} disabled={selectedLoan?.interestType === 'SIMPLE'} onChange={e => {
                          const newInstStr = e.target.value;
                          setEditContractData((prev: any) => {
                              const amt = parseFloat(prev.amount) || 0;
                              const rateNum = parseFloat(prev.interestRate) || 0;
                              const inst = selectedLoan?.interestType === 'SIMPLE' ? 1 : (parseInt(newInstStr) || 1);
                              let periodRate = rateNum / 100;
                              if (selectedLoan?.frequency === 'SEMANAL') periodRate /= 4;
                              if (selectedLoan?.frequency === 'DIARIO') periodRate /= 30;
                              let calcInst = 0;
                              const currentBalance = Math.max(0, amt - (selectedLoan?.totalPaidCapital || 0));
                              if (selectedLoan?.interestType === 'SIMPLE') calcInst = currentBalance * periodRate;
                              else {
                                  if (periodRate === 0) calcInst = currentBalance / inst;
                                  else calcInst = currentBalance * ((periodRate * Math.pow(1 + periodRate, inst)) / (Math.pow(1 + periodRate, inst) - 1));
                              }
                              return { ...prev, installments: newInstStr, installmentValue: calcInst > 0 ? (Math.round(calcInst * 100) / 100).toFixed(2) : '' };
                          });
                      }} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5 disabled:bg-slate-100 disabled:text-slate-400"/>
                  </div>
                  <div>
                      <label className="block text-[10px] font-bold uppercase text-blue-600 mb-2">Valor Parcela (R$)</label>
                      <input 
                          type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" 
                          value={editContractData.installmentValue || ''} 
                          onChange={e => {
                              const val = e.target.value;
                              setEditContractData((prev: any) => {
                                  if (val === '') return { ...prev, installmentValue: val };
                                  
                                  const pmtTarget = parseFloat(val) || 0;
                                  const cap = Math.max(0, (parseFloat(prev.amount) || 0) - (selectedLoan?.totalPaidCapital || 0));
                                  const parcelas = selectedLoan?.interestType === 'SIMPLE' ? 1 : (parseInt(prev.installments) || 1);

                                  if (cap > 0 && pmtTarget > 0) {
                                      let bestRate = 0;
                                      if (selectedLoan?.interestType === 'SIMPLE') {
                                          bestRate = (pmtTarget / cap) * 100;
                                      } else {
                                          // Motor de Busca Binária
                                          let low = 0.0, high = 100.0;
                                          for (let i = 0; i < 60; i++) {
                                              let mid = (low + high) / 2;
                                              let r = mid / 100;
                                              let pmt = cap * ((r * Math.pow(1 + r, parcelas)) / (Math.pow(1 + r, parcelas) - 1));
                                              if (pmt < pmtTarget) low = mid; else high = mid;
                                              bestRate = mid;
                                          }
                                      }
                                      
                                      if (selectedLoan?.frequency === 'SEMANAL') bestRate *= 4;
                                      if (selectedLoan?.frequency === 'DIARIO') bestRate *= 30;
                                      if (bestRate < 0.000001) bestRate = 0;
                                      
                                      return { ...prev, installmentValue: val, interestRate: String(bestRate) };
                                  }
                                  return { ...prev, installmentValue: val };
                              });
                          }} 
                          className="w-full p-3 border border-blue-300 rounded-xl outline-none font-black text-blue-700 bg-white focus:ring-2 focus:ring-blue-500/20 shadow-sm transition-all"
                          placeholder="Ex: 150.00"
                      />
                  </div>
              </div>

              <div className="grid grid-cols-1 p-4 bg-blue-50 border border-blue-200 rounded-xl shadow-inner mb-4">
                  <div>
                      <label className="block text-[10px] font-black uppercase text-blue-700 mb-1 leading-tight">Juros Total Desejado (R$) - Opcional</label>
                      <input 
                          type="number" 
                          onWheel={(e) => e.currentTarget.blur()} 
                          step="0.01" 
                          placeholder="Ex: 410.00 (O sistema calcula a % exata para você)"
                          onChange={e => {
                              const val = e.target.value;
                              if (val === '') return;
                              
                              const jurosTarget = parseFloat(val) || 0;
                              const cap = Math.max(0, (parseFloat(editContractData.amount) || 0) - (selectedLoan?.totalPaidCapital || 0));
                              const parcelas = selectedLoan?.interestType === 'SIMPLE' ? 1 : (parseInt(editContractData.installments) || 1);

                              if (cap > 0 && jurosTarget >= 0) {
                                  let bestRate = 0;
                                  if (selectedLoan?.interestType === 'SIMPLE' || parcelas === 1) {
                                      bestRate = (jurosTarget / cap) * 100;
                                  } else {
                                      // Motor de Busca Binária
                                      let low = 0.0, high = 100.0;
                                      for (let i = 0; i < 60; i++) {
                                          let mid = (low + high) / 2;
                                          let r = mid / 100;
                                          let pmt = cap * ((r * Math.pow(1 + r, parcelas)) / (Math.pow(1 + r, parcelas) - 1));
                                          let totalInt = (pmt * parcelas) - cap;
                                          if (totalInt < jurosTarget) low = mid; else high = mid;
                                          bestRate = mid;
                                      }
                                  }
                                  
                                  if (selectedLoan?.frequency === 'SEMANAL') bestRate *= 4;
                                  if (selectedLoan?.frequency === 'DIARIO') bestRate *= 30;
                                  if (bestRate < 0.000001) bestRate = 0;
                                  
                                  const formattedRate = bestRate;
                                  
                                  setEditContractData((prev: any) => {
                                      let periodRate = formattedRate / 100;
                                      if (selectedLoan?.frequency === 'SEMANAL') periodRate /= 4;
                                      if (selectedLoan?.frequency === 'DIARIO') periodRate /= 30;
                                      
                                      let calcInst = 0;
                                      if (selectedLoan?.interestType === 'SIMPLE') calcInst = Math.max(0, cap - (selectedLoan?.totalPaidCapital || 0)) * periodRate;
                                      else {
                                          if (periodRate === 0) calcInst = cap / parcelas;
                                          else calcInst = cap * ((periodRate * Math.pow(1 + periodRate, parcelas)) / (Math.pow(1 + periodRate, parcelas) - 1));
                                      }
                                      
                                      return { ...prev, interestRate: String(formattedRate), installmentValue: calcInst > 0 ? (Math.round(calcInst * 100) / 100).toFixed(2) : '' };
                                  });
                              }
                          }} 
                          className="w-full p-3 border border-blue-300 rounded-xl outline-none font-black text-blue-700 bg-white focus:ring-2 focus:ring-blue-500/20 shadow-sm" 
                      />
                  </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Data da Operação</label><input type="date" value={editContractData.startDate} onChange={e => setEditContractData({...editContractData, startDate: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Próximo Vencimento</label><input type="date" value={editContractData.nextDue} onChange={e => setEditContractData({...editContractData, nextDue: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none font-bold text-slate-800"/></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Multa Atraso (%)</label><input type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={editContractData.fineRate} onChange={e => setEditContractData({...editContractData, fineRate: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Mora Diária (%)</label><input type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={editContractData.moraInterestRate} onChange={e => setEditContractData({...editContractData, moraInterestRate: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/></div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">Banco do Cliente</label><input list="bancos-sugestao" value={editContractData.clientBank} onChange={e => setEditContractData({...editContractData, clientBank: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none" placeholder="Digite ou selecione o banco..."/></div>
                  <div>
                      <div className="flex justify-between items-end mb-1">
                          <label className="block text-xs font-bold text-slate-500">Chave Pix/Conta</label>
                          <select 
                              onChange={(e) => {
                                  const c = availableClients.find(cl => cl.name === selectedLoan?.client);
                                  const val = e.target.value;
                                  if (val === 'cpf' && c?.cpf) setEditContractData((f: any) => ({...f, paymentMethod: c.cpf}));
                                  else if (val === 'phone' && c?.phone) setEditContractData((f: any) => ({...f, paymentMethod: c.phone}));
                                  else if (val === 'email' && c?.email) setEditContractData((f: any) => ({...f, paymentMethod: c.email}));
                                  else if (val === 'aleatoria') setEditContractData((f: any) => ({...f, paymentMethod: 'Chave Aleatória: '}));
                                  else if (val === 'cnpj') setEditContractData((f: any) => ({...f, paymentMethod: 'CNPJ: '}));
                                  else if (val === 'conta') setEditContractData((f: any) => ({...f, paymentMethod: 'Agência e Conta: '}));
                                  e.target.value = ""; 
                              }}
                              className="text-[9px] p-1 border border-blue-200 rounded text-blue-700 font-bold outline-none cursor-pointer"
                          >
                              <option value="">Puxar dados...</option>
                              <option value="cpf">CPF</option>
                              <option value="phone">Celular</option>
                              <option value="email">E-mail</option>
                              <option value="aleatoria">Aleatória</option>
                              <option value="cnpj">CNPJ</option>
                              <option value="conta">Conta</option>
                          </select>
                      </div>
                      <input type="text" value={editContractData.paymentMethod} onChange={e => setEditContractData({...editContractData, paymentMethod: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/>
                  </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Fatias de Pagamento (Multi-Data)</label>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                      {(editContractData.multiDates || []).map((slice: any, idx: number) => (
                           <div key={idx} className="flex items-center gap-2">
                               <div className="flex-1">
                                   <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Dia</label>
                                   <input type="number" onWheel={(e) => e.currentTarget.blur()} min="1" max="31" value={slice.day} onChange={(e) => {
                                       const newMd = [...editContractData.multiDates];
                                       newMd[idx].day = e.target.value;
                                       setEditContractData({...editContractData, multiDates: newMd});
                                   }} className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white" />
                               </div>
                               <div className="flex-1">
                                   <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Valor (R$)</label>
                                   <input type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={slice.amount} onChange={(e) => {
                                       const newMd = [...editContractData.multiDates];
                                       newMd[idx].amount = e.target.value;
                                       setEditContractData({...editContractData, multiDates: newMd});
                                   }} className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white" />
                               </div>
                               <button type="button" onClick={() => {
                                   const newMd = editContractData.multiDates.filter((_:any, i:number) => i !== idx);
                                   setEditContractData({...editContractData, multiDates: newMd});
                               }} className="mt-4 p-2 text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={16}/></button>
                           </div>
                      ))}
                      {editContractData.multiDates?.length < 15 && (
                          <button type="button" onClick={() => {
                              const currentMd = editContractData.multiDates || [];
                              setEditContractData({...editContractData, multiDates: [...currentMd, {day: '', amount: ''}]});
                          }} className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1 mt-2"><Plus size={12}/> Adicionar Fatia</button>
                      )}
                  </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                  <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Dados do Fiador (Opcional)</label>
                  <div className="space-y-3">
                      <input type="text" placeholder="Nome do Fiador" value={editContractData.guarantorName} onChange={e => setEditContractData({...editContractData, guarantorName: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/>
                      <input type="text" placeholder="CPF do Fiador" value={editContractData.guarantorCPF} onChange={e => setEditContractData({...editContractData, guarantorCPF: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/>
                          <input type="text" placeholder="Endereço do Fiador" value={editContractData.guarantorAddress} onChange={e => setEditContractData({...editContractData, guarantorAddress: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none"/>
                      </div>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                      <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Motivo da Edição / Observações (Uso Interno)</label>
                      <textarea 
                          value={editContractData.editReason || ''} 
                          onChange={e => setEditContractData({...editContractData, editReason: e.target.value})} 
                          className="w-full p-3 h-20 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-sm resize-none" 
                          placeholder="Ex: Acrescentado R$ 90,00 na fatia do dia 20 a pedido do cliente..."
                      />
                      <p className="text-[10px] text-slate-400 mt-1">Essa observação ficará salva no Histórico (Extrato Financeiro) do contrato para auditoria.</p>
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
                        {availableClients.filter(c => c.status !== 'Bloqueado').map((c) => (<option key={c.id} value={c.name}>{c.name} ({c.cpf})</option>))}
                    </datalist>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <div className="flex justify-between items-end mb-1">
                             <label className="flex items-center gap-1 text-xs font-bold uppercase text-slate-500"><Hash size={12}/> ID do Contrato</label>
                        </div>
                        <input value={formData.manualID} onChange={e => setFormData({...formData, manualID: e.target.value})} className="w-full p-2 border rounded-lg bg-white font-mono text-sm" placeholder="Deixe em branco p/ Automático"/>
                    </div>
                    <div>
                        <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Banco do Cliente</label>
                        <select 
                            value={["Itaú", "Bradesco", "Santander", "Nubank", "Inter", "Caixa Econômica", "Banco do Brasil", "C6 Bank", "PagBank", "Mercado Pago", ""].includes(formData.clientBank) ? formData.clientBank : "Outro"} 
                            onChange={e => setFormData({...formData, clientBank: e.target.value === 'Outro' ? '' : e.target.value})} 
                            className="w-full p-2 border rounded-lg bg-white text-sm"
                        >
                            <option value="">Selecione o Banco...</option>
                            <option value="Itaú">Itaú</option>
                            <option value="Bradesco">Bradesco</option>
                            <option value="Santander">Santander</option>
                            <option value="Nubank">Nubank</option>
                            <option value="Inter">Banco Inter</option>
                            <option value="Caixa Econômica">Caixa Econômica</option>
                            <option value="Banco do Brasil">Banco do Brasil</option>
                            <option value="C6 Bank">C6 Bank</option>
                            <option value="PagBank">PagBank</option>
                            <option value="Mercado Pago">Mercado Pago</option>
                            <option value="Outro">Outro banco...</option>
                        </select>
                        {(!["Itaú", "Bradesco", "Santander", "Nubank", "Inter", "Caixa Econômica", "Banco do Brasil", "C6 Bank", "PagBank", "Mercado Pago", ""].includes(formData.clientBank) || formData.clientBank === "Outro") && (
                            <input 
                                type="text" 
                                placeholder="Digite o nome do banco" 
                                value={formData.clientBank} 
                                onChange={e => setFormData({...formData, clientBank: e.target.value})} 
                                className="w-full mt-2 p-2 border border-slate-200 rounded-lg bg-white text-sm animate-in fade-in"
                            />
                        )}
                    </div>
                </div>

                {/* --- DROPDOWN INTELIGENTE PARA PUXAR CHAVE PIX --- */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className="flex justify-between items-end mb-2">
                        <label className="block text-xs font-bold uppercase text-slate-500">Chave PIX / Pagamento</label>
                        {formData.client && (
                            <select 
                                onChange={(e) => {
                                    const c = availableClients.find(cl => cl.name === formData.client);
                                    const val = e.target.value;
                                    if (val === 'cpf' && c?.cpf) setFormData(f => ({...f, paymentMethod: c.cpf}));
                                    else if (val === 'phone' && c?.phone) setFormData(f => ({...f, paymentMethod: c.phone}));
                                    else if (val === 'email' && c?.email) setFormData(f => ({...f, paymentMethod: c.email}));
                                    else if (val === 'aleatoria') setFormData(f => ({...f, paymentMethod: 'Chave Aleatória: '}));
                                    else if (val === 'cnpj') setFormData(f => ({...f, paymentMethod: 'CNPJ: '}));
                                    else if (val === 'conta') setFormData(f => ({...f, paymentMethod: 'Agência e Conta: '}));
                                    e.target.value = ""; 
                                }}
                                className="text-[10px] p-1.5 border border-blue-200 rounded-md bg-white text-blue-700 font-bold outline-none cursor-pointer shadow-sm"
                            >
                                <option value="">Puxar dados...</option>
                                <option value="cpf">Puxar CPF</option>
                                <option value="phone">Puxar Celular</option>
                                <option value="email">Puxar E-mail</option>
                                <option value="aleatoria">Chave Aleatória</option>
                                <option value="cnpj">Usar CNPJ</option>
                                <option value="conta">Agência e Conta</option>
                            </select>
                        )}
                    </div>
                    <input value={formData.paymentMethod} onChange={e => setFormData({...formData, paymentMethod: e.target.value})} className="w-full p-2 border rounded-lg bg-white" placeholder="Selecione acima ou digite aqui..."/>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Multa Atraso (%)</label><input type="number" onWheel={(e) => e.currentTarget.blur()} step="0.1" value={formData.fineRate} onChange={e => setFormData({...formData, fineRate: e.target.value})} className="w-full p-2 border rounded-lg bg-white" placeholder="" /></div>
                    <div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Juros Mora Diária (%)</label><input type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={formData.moraInterestRate} onChange={e => setFormData({...formData, moraInterestRate: e.target.value})} className="w-full p-2 border rounded-lg bg-white" placeholder="" /></div>
                </div>

                <div className={`p-3 border rounded-xl transition-all ${formData.isMigration ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center gap-2 mb-2">
                        <input type="checkbox" id="isMigration" checked={formData.isMigration} onChange={(e) => setFormData({...formData, isMigration: e.target.checked})} className={`w-5 h-5 rounded focus:ring-amber-500 ${formData.isMigration ? 'text-amber-600' : 'text-slate-500'}`} />
                        <label htmlFor="isMigration" className={`text-sm font-bold cursor-pointer flex items-center gap-2 ${formData.isMigration ? 'text-amber-800' : 'text-slate-600'}`}><Database size={16}/> É um contrato antigo (Migração)?</label>
                    </div>
                    {formData.isMigration && (
                        <div className="mt-3 animate-in zoom-in-95 border-t border-amber-200 pt-3">
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div><label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">Valor Original Emprestado (R$)</label><input required type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white" placeholder="" /></div>
                                <div>
                                    <label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">Taxa Registrada (%)</label>
                                    <input 
                                        required 
                                        type="number" 
                                        onWheel={(e) => e.currentTarget.blur()} 
                                        step="any" 
                                        value={formData.interestRate} 
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setFormData(prev => {
                                                const amount = parseFloat(prev.amount) || 0;
                                                const initCap = parseFloat(prev.initialPaidCapital) || 0;
                                                const balance = Math.max(0, amount - initCap);
                                                let autoJuros = prev.manualInstallmentInterest;
                                                const rateNum = parseFloat(val) || 0;

                                                if (balance > 0) {
                                                    let periodRate = rateNum / 100;
                                                    if (prev.frequency === 'SEMANAL') periodRate /= 4;
                                                    else if (prev.frequency === 'DIARIO') periodRate /= 30;

                                                    if (prev.interestType === 'SIMPLE') {
                                                        autoJuros = (balance * periodRate).toFixed(2);
                                                    } else {
                                                        const numInst = parseInt(prev.installments) || 1;
                                                        const mCap = parseFloat(prev.manualInstallmentCapital) || 0;
                                                        let pmt = 0;
                                                        if (periodRate === 0) pmt = balance / numInst;
                                                        else pmt = balance * ( (periodRate * Math.pow(1 + periodRate, numInst)) / (Math.pow(1 + periodRate, numInst) - 1) );
                                                        autoJuros = Math.max(0, pmt - mCap).toFixed(2);
                                                    }
                                                }
                                                return { ...prev, interestRate: val, manualInstallmentInterest: autoJuros };
                                            });
                                        }} 
                                        className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-500/20 outline-none transition-all" 
                                        placeholder="" 
                                    />
                                </div>                            </div>
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div><label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">Capital Já Pago (R$)</label><input type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={formData.initialPaidCapital} onChange={e => setFormData({...formData, initialPaidCapital: e.target.value})} className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white" placeholder="" /></div>
                                <div><label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">Juros Já Pagos (R$)</label><input type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={formData.initialPaidInterest} onChange={e => setFormData({...formData, initialPaidInterest: e.target.value})} className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white" placeholder="" /></div>
                            </div>
                            
                            <div className="flex items-center gap-2 p-3 bg-white border border-amber-200 rounded-xl mb-3">
                                <input type="checkbox" id="interestTypeMig" checked={formData.interestType === 'SIMPLE'} onChange={(e) => setFormData({...formData, interestType: e.target.checked ? 'SIMPLE' : 'PRICE'})} className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500" />
                                <label htmlFor="interestTypeMig" className="text-sm font-bold text-amber-800 cursor-pointer">Pagamento Mínimo (Só Juros)</label>
                            </div>

                            <p className="text-[10px] font-bold text-amber-800 uppercase mb-2 mt-4 border-t border-amber-200 pt-2">Definir Parcelas Restantes Manualmente</p>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">Qtd. Parcelas Restantes</label>
                                    <input required type="number" onWheel={(e) => e.currentTarget.blur()} value={formData.interestType === 'SIMPLE' ? 1 : formData.installments} disabled={formData.interestType === 'SIMPLE'} onChange={e => setFormData({...formData, installments: e.target.value})} className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white disabled:bg-amber-50 disabled:text-amber-400" placeholder="" />
                                </div>
                                
                                {formData.interestType !== 'SIMPLE' && (
                                    <div><label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">Capital / Parcela (R$)</label><input required type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={formData.manualInstallmentCapital} onChange={e => setFormData({...formData, manualInstallmentCapital: e.target.value})} className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white" placeholder="" /></div>
                                )}
                                
                                <div className={formData.interestType === 'SIMPLE' ? 'col-span-2' : ''}>
                                    <label className="block text-[10px] uppercase font-bold text-amber-700 mb-1">
                                        Juros / Parcela (R$)
                                        {formData.interestType === 'SIMPLE' && <span className="lowercase text-[8px] font-normal ml-1">(Será recalculado se amortizar capital)</span>}
                                    </label>
                                    <input 
                                        required 
                                        type="number" 
                                        onWheel={(e) => e.currentTarget.blur()} 
                                        step="0.01" 
                                        value={formData.manualInstallmentInterest} 
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setFormData(prev => {
                                                const amount = parseFloat(prev.amount) || 0;
                                                const initCap = parseFloat(prev.initialPaidCapital) || 0;
                                                const balance = Math.max(0, amount - initCap);
                                                let autoRate = prev.interestRate;
                                                const newJuros = parseFloat(val) || 0;

                                                if (balance > 0 && newJuros > 0) {
                                                    if (prev.interestType === 'SIMPLE') {
                                                        let rate = (newJuros / balance) * 100;
                                                        if (prev.frequency === 'SEMANAL') rate *= 4;
                                                        if (prev.frequency === 'DIARIO') rate *= 30;
                                                        autoRate = String(rate);
                                                    } else {
                                                        const numInst = parseInt(prev.installments) || 1;
                                                        const mCap = parseFloat(prev.manualInstallmentCapital) || 0;
                                                        const targetPmt = mCap + newJuros;
                                                        
                                                        let low = 0.0;
                                                        let high = 100.0; 
                                                        let bestRate = 0;
                                                        for (let i = 0; i < 60; i++) {
                                                            let mid = (low + high) / 2;
                                                            let r = mid / 100;
                                                            let pmt = balance * ((r * Math.pow(1 + r, numInst)) / (Math.pow(1 + r, numInst) - 1));
                                                            if (pmt < targetPmt) low = mid;
                                                            else high = mid;
                                                            bestRate = mid;
                                                        }
                                                        if (prev.frequency === 'SEMANAL') bestRate *= 4;
                                                        if (prev.frequency === 'DIARIO') bestRate *= 30;
                                                        // FIX: Previne notação científica (e-17)
                                                        if (bestRate < 0.000001) bestRate = 0;
                                                        autoRate = String(bestRate);                                                    }
                                                }
                                                return { ...prev, manualInstallmentInterest: val, interestRate: autoRate };
                                            });
                                        }} 
                                        className="w-full p-2 border border-amber-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-500/20 outline-none transition-all" 
                                        placeholder="" 
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {!formData.isMigration && (
                    <>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="col-span-1"><label className="block text-xs font-bold uppercase text-slate-500 mb-2">Valor (R$)</label><input required type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5" placeholder=""/></div>
                            <div className="col-span-1"><label className="block text-xs font-bold uppercase text-slate-500 mb-2">Taxa Mensal (%)</label><input required type="number" onWheel={(e) => e.currentTarget.blur()} step="any" value={formData.interestRate} onChange={e => {
                                setExactInterest(null);
                                setFormData({...formData, interestRate: e.target.value});
                            }} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5" placeholder=""/></div>
                            <div className="col-span-1"><label className="block text-xs font-bold uppercase text-slate-500 mb-2">Qtd. Parcelas</label><input required type="number" onWheel={(e) => e.currentTarget.blur()} value={formData.interestType === 'SIMPLE' ? 1 : formData.installments} disabled={formData.interestType === 'SIMPLE'} onChange={e => setFormData({...formData, installments: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5 disabled:bg-slate-100 disabled:text-slate-400" placeholder=""/></div>
                        </div>

                        <div className="grid grid-cols-1 p-4 bg-slate-50 border border-slate-200 rounded-xl shadow-inner">
                            <div>
                                <label className="block text-[10px] font-black uppercase text-blue-600 mb-1 leading-tight">Juros Total Desejado (R$) - Opcional</label>
                                <input 
                                    type="number" 
                                    onWheel={(e) => e.currentTarget.blur()}
                                    step="0.01" 
                                    placeholder="Ex: 410.00 (O sistema calcula a % exata para você)"
                                    onChange={e => {
                                        const val = e.target.value;
                                        if (val === '') {
                                            setExactInterest(null);
                                            return;
                                        }
                                        const jurosTarget = parseFloat(val) || 0;
                                        setExactInterest(jurosTarget);

                                        const cap = parseFloat(formData.amount) || 0;
                                        const parcelas = formData.interestType === 'SIMPLE' ? 1 : (parseInt(formData.installments) || 1);
                                        
                                        if (cap > 0 && jurosTarget >= 0) {
                                            if (formData.interestType === 'SIMPLE' || parcelas === 1) {
                                                let taxa = (jurosTarget / cap) * 100;
                                                if (formData.frequency === 'SEMANAL') taxa *= 4;
                                                if (formData.frequency === 'DIARIO') taxa *= 30;
                                                setFormData({...formData, interestRate: String(taxa)});
                                            } else {
                                                let low = 0.0;
                                                let high = 100.0; 
                                                let bestRate = 0;
                                                // 60 loops garantem precisão microscópica!
                                                for (let i = 0; i < 60; i++) {
                                                    let mid = (low + high) / 2;
                                                    let r = mid / 100;
                                                    let pmt = cap * ((r * Math.pow(1 + r, parcelas)) / (Math.pow(1 + r, parcelas) - 1));
                                                    let totalInt = (pmt * parcelas) - cap;
                                                    if (totalInt < jurosTarget) low = mid;
                                                    else high = mid;
                                                    bestRate = mid;
                                                }
                                                // Converte a taxa do período de volta para Taxa Mensal para visualização correta
                                                if (formData.frequency === 'SEMANAL') bestRate *= 4;
                                                if (formData.frequency === 'DIARIO') bestRate *= 30;
                                                
                                                // FIX: Previne notação científica (e-17) em taxas zeradas
                                                if (bestRate < 0.000001) bestRate = 0;
                                                setFormData({...formData, interestRate: String(bestRate)});
                                            }
                                        }
                                    }}
                                    className="w-full p-3 border border-blue-300 rounded-xl outline-none font-black text-blue-700 bg-blue-50 focus:ring-2 focus:ring-blue-500/20 shadow-sm" 
                                />
                            </div>
                        </div>

                        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl mb-4">
                            <input type="checkbox" id="interestType" checked={formData.interestType === 'SIMPLE'} onChange={(e) => setFormData({...formData, interestType: e.target.checked ? 'SIMPLE' : 'PRICE'})} className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500" />
                            <label htmlFor="interestType" className="text-sm font-bold text-blue-800 cursor-pointer">Pagamento Mínimo (Só Juros) <span className="text-xs font-normal text-blue-600 block">O cliente paga apenas os juros mensais. O capital não abate.</span></label>
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
                                            <input type="number" onWheel={(e) => e.currentTarget.blur()} min="1" max="31" value={md.day} onChange={(e) => {
                                                const newMd = [...formData.multiDates];
                                                newMd[index].day = e.target.value as any;
                                                setFormData({...formData, multiDates: newMd});
                                            }} className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white" placeholder="Ex: 10" />
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Valor (R$)</label>
                                            <input type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" value={md.amount} onChange={(e) => {
                                                const newMd = [...formData.multiDates];
                                                newMd[index].amount = e.target.value as any;
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
                                {formData.multiDates.length < 15 && (
                                    <button type="button" onClick={() => setFormData({...formData, multiDates: [...formData.multiDates, {day: '' as any, amount: '' as any}]})} className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1 mt-2"><Plus size={12}/> Adicionar Data</button>
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
                                <input type="number" onWheel={(e) => e.currentTarget.blur()} step="0.01" placeholder="Ex: 50.00" value={formData.affiliateFee} onChange={(e) => setFormData({...formData, affiliateFee: e.target.value})} className="w-full p-2 border border-indigo-200 rounded-lg bg-white outline-none"/>
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