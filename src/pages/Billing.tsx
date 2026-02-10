import { useState, useEffect, useMemo } from 'react';
import { 
  Search, Plus, AlertCircle, CheckCircle, Clock, Trash2,
  MoreVertical, Loader2, RefreshCw, ShieldAlert, ShieldCheck, 
  Calculator, FileText, Check, ChevronRight, DollarSign, 
  Printer, Eye, TrendingUp, TrendingDown, History, Download, Calendar, AlertTriangle, Info, PartyPopper, UserCheck
} from 'lucide-react';

import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

import { generateContractPDF, generatePromissoryPDF } from '../utils/generatePDF';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { calculateOverdueValue, formatMoney } from '../utils/finance';
import { loanService, clientService, Loan, Client, PaymentRecord } from '../services/api';

interface ChecklistItem {
  id: string;
  label: string;
  weight: number;
  checked: boolean;
  stage: 1 | 2;
}

const Billing = () => {
  // --- Estados de Interface ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isChecklistOpen, setIsChecklistOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [activeStage, setActiveStage] = useState<1 | 2>(1);
  const [detailTab, setDetailTab] = useState<'info' | 'history'>('info');

  // --- Estados de Dados ---
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Todos' | 'Em Dia' | 'Atrasado' | 'Pago'>('Todos');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]); 

  const [isSimulating, setIsSimulating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [justification, setJustification] = useState('');

  // --- ESTADOS PAGAMENTO FLEXÍVEL ---
  const [payDate, setPayDate] = useState(''); 
  const [payCapital, setPayCapital] = useState(''); 
  const [payInterest, setPayInterest] = useState(''); 
  const [payTotal, setPayTotal] = useState(0); 
  const [settleInterest, setSettleInterest] = useState(false);
  
  const [cycleAcc, setCycleAcc] = useState({ interest: 0, capital: 0 }); 

  const [availableClients, setAvailableClients] = useState<Client[]>([]);
  const [summary, setSummary] = useState({ today: 0, overdue: 0, received: 0 });
  const [loans, setLoans] = useState<Loan[]>([]);

  // --- FORMULÁRIO DE CONTRATO (COM FIADOR E TIPO DE JUROS) ---
  const [formData, setFormData] = useState({ 
      client: '', amount: '', interestRate: '', installments: '', startDate: '',
      fineRate: '2.0', clientBank: '', paymentMethod: '',
      // NOVOS CAMPOS
      interestType: 'PRICE', // Inicializa como string, mas validaremos no envio
      hasGuarantor: false,
      guarantorName: '',
      guarantorCPF: '',
      guarantorAddress: ''
  });
  
  const [simulation, setSimulation] = useState({ installment: 0, totalInterest: 0, totalPayable: 0, isValid: false });

  // --- CHECKLIST ---
  const initialChecklist: ChecklistItem[] = useMemo(() => [
    { id: 'q1', label: 'Nome Completo e Cadastro Básico', weight: 1, checked: false, stage: 1 },
    { id: 'q2', label: 'Vínculo CLT/Autônomo Validado', weight: 3, checked: false, stage: 1 },
    { id: 'q3', label: 'Tempo de Empresa (> 6 meses)', weight: 2, checked: false, stage: 1 },
    { id: 'q4', label: 'Salário e Benefícios Reais', weight: 3, checked: false, stage: 1 },
    { id: 'q5', label: 'Moradia Confirmada', weight: 1, checked: false, stage: 1 },
    { id: 'q6', label: 'Análise de Redes Sociais', weight: 1, checked: false, stage: 1 },
    { id: 'q7', label: 'Sem Restrição Crítica', weight: 3, checked: false, stage: 1 },
    { id: 'q8', label: 'Filtro de Apostas', weight: 3, checked: false, stage: 1 },
    { id: 'd1', label: 'Comprovante Endereço Anexado', weight: 3, checked: false, stage: 2 },
    { id: 'd2', label: 'Holerite ou Extratos', weight: 3, checked: false, stage: 2 },
    { id: 'd3', label: 'Selfie do Cliente', weight: 2, checked: false, stage: 2 },
    { id: 'd4', label: 'Contato de Referência', weight: 2, checked: false, stage: 2 },
    { id: 'd5', label: 'RG/CNH Anexado', weight: 3, checked: false, stage: 2 },
    { id: 'd6', label: 'Vídeo da Casa', weight: 3, checked: false, stage: 2 },
    { id: 'd7', label: 'Vídeo do Acordo', weight: 3, checked: false, stage: 2 },
    { id: 'd8', label: 'Dados Bancários Completos', weight: 2, checked: false, stage: 2 },
  ], []);

  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(initialChecklist);
  const totalWeight = checklistItems.reduce((acc, item) => acc + item.weight, 0);
  const currentScore = checklistItems.reduce((acc, item) => item.checked ? acc + item.weight : acc, 0);
  const progressPercentage = Math.round((currentScore / totalWeight) * 100);
  const canFinalize = justification.trim().length >= 5;

  useEffect(() => {
    const handleGlobalClick = () => setOpenMenuId(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  const fetchLoans = async () => {
    setIsLoadingList(true);
    try { 
      const [clientsData, loansData] = await Promise.all([
          clientService.getAll(),
          loanService.getAll()
      ]);
      setAvailableClients(clientsData || []); 
      setLoans(loansData || []);
    } catch (err) { console.error("Erro ao carregar dados:", err); } 
    finally { setIsLoadingList(false); }
  };

  useEffect(() => { fetchLoans(); }, []);

  // --- AUTOCOMPLETE DE DADOS BANCÁRIOS ---
  useEffect(() => {
      if (formData.client && availableClients.length > 0) {
          // Busca último empréstimo desse cliente
          const lastLoan = loans
            .filter(l => l.client === formData.client)
            .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];
          
          if (lastLoan) {
              setFormData(prev => ({
                  ...prev,
                  clientBank: lastLoan.clientBank || '',
                  paymentMethod: lastLoan.paymentMethod || '',
                  fineRate: lastLoan.fineRate?.toString() || '2.0',
                  interestRate: lastLoan.interestRate?.toString() || prev.interestRate
              }));
          }
      }
  }, [formData.client]);

  // --- CHECKLIST INTELIGENTE ---
  useEffect(() => {
      if (isChecklistOpen && formData.client) {
          const clientData = availableClients.find(c => c.name === formData.client);
          const lastLoan = loans
            .filter(l => l.client === formData.client && l.checklistAtApproval && l.checklistAtApproval.length > 0)
            .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];

          setChecklistItems(prev => prev.map(item => {
              let isChecked = false;
              if (lastLoan && lastLoan.checklistAtApproval?.includes(item.id)) isChecked = true;
              if (clientData) {
                  if (item.id === 'q1' && clientData.name && clientData.cpf) isChecked = true;
                  if (clientData.documents && clientData.documents.length > 0) {
                      const docsStr = clientData.documents.map(d => d.name.toUpperCase()).join(' ');
                      if (item.id === 'd1' && (clientData.address || docsStr.includes('COMPROVANTE'))) isChecked = true;
                      if (item.id === 'd5' && (clientData.rg || docsStr.includes('RG') || docsStr.includes('CNH'))) isChecked = true;
                  }
                  if (item.id === 'd8' && formData.clientBank && formData.paymentMethod) isChecked = true;
              }
              return { ...item, checked: isChecked };
          }));
          if (lastLoan && justification === '') setJustification('Cliente recorrente. Checklist importado do contrato anterior.');
      }
  }, [isChecklistOpen, formData.client]);

  const toggleChecklistItem = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setChecklistItems(prev => prev.map(item => item.id === id ? { ...item, checked: !item.checked } : item));
  };

  const getLoanRealStatus = (loan: Loan) => {
    if (loan.status === 'Pago') return 'Pago';
    const today = new Date(); today.setHours(0,0,0,0);
    const dueDate = new Date(loan.nextDue); dueDate.setMinutes(dueDate.getMinutes() + dueDate.getTimezoneOffset()); dueDate.setHours(0,0,0,0);
    if (dueDate < today) return 'Atrasado';
    return 'Em Dia';
  };

  const getBreakdown = (loan: Loan) => {
      const interest = loan.amount * (loan.interestRate / 100);
      
      // SE FOR MODO "SÓ JUROS" (SIMPLE), A PARCELA DE CAPITAL É ZERO (ATÉ PAGAR FINAL)
      if (loan.InterestType === 'SIMPLE') {
          return { interest, capital: 0 }; 
      }

      const capital = loan.installmentValue - interest;
      return { interest, capital: capital > 0 ? capital : 0 };
  };

  useEffect(() => {
    const totalOverdue = loans.reduce((acc, l) => {
      if (l.status === 'Pago') return acc;
      const realStatus = getLoanRealStatus(l);
      if (realStatus === 'Atrasado') return acc + calculateOverdueValue(l.installmentValue, l.nextDue, 'Atrasado', l.fineRate || 2, l.moraInterestRate || 1);
      return acc;
    }, 0);
    const totalProfit = loans.reduce((acc, l) => acc + (l.totalPaidInterest || 0), 0);
    const totalToday = loans.filter(l => {
        const today = new Date(); today.setHours(0,0,0,0);
        const dueDate = new Date(l.nextDue); dueDate.setMinutes(dueDate.getMinutes() + dueDate.getTimezoneOffset()); dueDate.setHours(0,0,0,0);
        return dueDate.getTime() === today.getTime() && l.status !== 'Pago';
    }).reduce((acc, l) => acc + l.installmentValue, 0);
    setSummary({ overdue: totalOverdue, received: totalProfit, today: totalToday });
  }, [loans]);

  // --- SIMULAÇÃO DE PARCELAS ---
  useEffect(() => {
    const amount = parseFloat(formData.amount); 
    const rate = parseFloat(formData.interestRate); 
    const months = parseInt(formData.installments);
    
    if (amount > 0 && months > 0 && !isNaN(rate) && formData.startDate) {
      setIsSimulating(true);
      const timeoutId = setTimeout(() => {
        const i = rate / 100;
        let pmt = 0;
        let totalInt = 0;

        if (formData.interestType === 'SIMPLE') {
            // MODO SÓ JUROS: Parcela = Apenas Juros. Capital fica pro final.
            pmt = amount * i; 
            totalInt = pmt * months;
        } else {
            // MODO PRICE: Amortização
            pmt = i > 0 ? amount * ( (i * Math.pow(1 + i, months)) / (Math.pow(1 + i, months) - 1) ) : amount / months;
            totalInt = (pmt * months) - amount;
        }

        setSimulation({ 
            installment: pmt, 
            totalInterest: totalInt, 
            totalPayable: pmt * months + (formData.interestType === 'SIMPLE' ? amount : 0), 
            isValid: true 
        });
        setIsSimulating(false);
      }, 400);
      return () => clearTimeout(timeoutId);
    } else { 
        setSimulation({ installment: 0, totalInterest: 0, totalPayable: 0, isValid: false }); 
    }
  }, [formData.amount, formData.interestRate, formData.installments, formData.startDate, formData.interestType]);

  const handleOpenPayment = (loan: Loan) => {
    setSelectedLoan(loan);
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60 * 1000;
    const localISOTime = (new Date(now.getTime() - offsetMs)).toISOString().slice(0, 16);
    setPayDate(localISOTime);
    setPayInterest('');
    setPayCapital('');
    setPayTotal(0);
    setSettleInterest(false); 

    const dueDate = new Date(loan.nextDue);
    const cycleStart = new Date(dueDate);
    cycleStart.setMonth(cycleStart.getMonth() - 1);
    cycleStart.setHours(23, 59, 59, 999); 
    
    let accInt = 0;
    let accCap = 0;

    if(loan.history) {
        loan.history.forEach(h => {
            const hDate = new Date(h.date);
            if (hDate.getTime() > cycleStart.getTime()) {
                accInt += (h.interestPaid || 0);
                accCap += (h.capitalPaid || 0);
            }
        });
    }
    setCycleAcc({ interest: accInt, capital: accCap });
    
    setIsDetailsOpen(false);
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

    if (valTotal <= 0) { alert("Valor deve ser maior que zero."); return; }

    const expectedInterest = selectedLoan.amount * (selectedLoan.interestRate / 100);
    const totalInterestInCycle = valInterest + cycleAcc.interest;

    if (totalInterestInCycle < (expectedInterest - 0.10) && !settleInterest) {
        const remaining = expectedInterest - totalInterestInCycle;
        const userConfirmed = window.confirm(
            `⚠️ ATENÇÃO: Faltam R$ ${formatMoney(remaining)} de Juros neste mês.\n` +
            `(Devido: R$ ${formatMoney(expectedInterest)} | Acumulado no ciclo: R$ ${formatMoney(totalInterestInCycle)})\n\n` +
            `Como a opção "Quitar Juros do Mês" NÃO está marcada, o vencimento NÃO avançará.\n\n` +
            `Deseja continuar?`
        );
        if (!userConfirmed) return;
    }

    let updatedLoan = { ...selectedLoan };
    updatedLoan.totalPaidCapital = (updatedLoan.totalPaidCapital || 0) + valCapital;
    updatedLoan.totalPaidInterest = (updatedLoan.totalPaidInterest || 0) + valInterest;

    let newAmount = updatedLoan.amount - valCapital;
    if (newAmount < 0) newAmount = 0;
    updatedLoan.amount = newAmount;

    let noteText = `Baixa Manual. Ref: ${new Date(payDate).toLocaleString('pt-BR')}`;
    
    const cycleCompletedNow = totalInterestInCycle >= (expectedInterest - 0.10);

    if (settleInterest) {
        noteText += ` [JUROS QUITADOS]`;
        if (totalInterestInCycle < expectedInterest) noteText += ` (Desconto: R$ ${formatMoney(expectedInterest - totalInterestInCycle)})`;
    } else if (cycleCompletedNow) {
        noteText += ` [QUITAÇÃO MENSAL (ACUMULADO)]`;
    } else {
        noteText += ` [PARCIAL]`;
    }

    if (newAmount <= 0.10) {
        updatedLoan.status = 'Pago';
        updatedLoan.installments = 0;
    } else {
        updatedLoan.status = 'Em Dia';
        if (valCapital > 0 || settleInterest || cycleCompletedNow) {
             const currentDue = new Date(updatedLoan.nextDue);
             currentDue.setMonth(currentDue.getMonth() + 1);
             updatedLoan.nextDue = currentDue.toISOString().split('T')[0];
             updatedLoan.installments = Math.max(0, updatedLoan.installments - 1);
        }
    }

    const newRecord: PaymentRecord = {
        date: new Date(payDate).toISOString(),
        amount: valTotal,
        capitalPaid: valCapital,
        interestPaid: valInterest,
        type: (valCapital > 0 && valInterest > 0) ? 'Parcela' : (valCapital > 0 ? 'Amortização' : 'Juros'),
        note: noteText,
        registeredAt: new Date().toISOString()
    };

    updatedLoan.history = [...(updatedLoan.history || []), newRecord];

    try {
        await loanService.update(selectedLoan.id, updatedLoan);
        setLoans(prev => prev.map(l => l.id === updatedLoan.id ? updatedLoan : l));
        setIsPaymentModalOpen(false);
        setSelectedLoan(updatedLoan);
        setDetailTab('history');
        setIsDetailsOpen(true);
        alert("✅ Baixa registrada!");
    } catch (err) { alert("Erro ao registrar."); }
  };

  const handleExportExcel = async () => {
    if (selectedIds.length === 0) { alert("Selecione contratos para exportar."); return; }
    const loansToExport = loans.filter(l => selectedIds.includes(l.id));
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Relatório de Cobrança');
    worksheet.columns = [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Cliente', key: 'client', width: 30 },
        { header: 'CPF', key: 'cpf', width: 18 },
        { header: 'Data Início', key: 'start', width: 12 },
        { header: 'Vencimento', key: 'due', width: 12 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Valor Original', key: 'amount', width: 15 },
        { header: 'Parcelas Rest.', key: 'installments', width: 15 },
        { header: 'Taxa (%)', key: 'rate', width: 10 },
        { header: 'Total Pago (Capital)', key: 'paidCap', width: 20 },
        { header: 'LUCRO REAL (Juros)', key: 'paidInt', width: 20 }
    ];
    loansToExport.forEach(loan => {
        const client = availableClients.find(c => c.name === loan.client);
        worksheet.addRow({
            id: loan.id, client: loan.client, cpf: client?.cpf || "N/A",
            start: new Date(loan.startDate), due: new Date(loan.nextDue),
            status: getLoanRealStatus(loan), amount: loan.amount, installments: loan.installments,
            rate: loan.interestRate, paidCap: loan.totalPaidCapital || 0, paidInt: loan.totalPaidInterest || 0
        });
    });
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Relatorio_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.xlsx`);
    setSelectedIds([]);
  };

  const toggleSelectAll = () => { if (selectedIds.length === loans.length) setSelectedIds([]); else setSelectedIds(loans.map(l => l.id)); };
  const toggleSelectOne = (id: string) => { setSelectedIds(prev => prev.includes(id) ? prev.filter(curr => curr !== id) : [...prev, id]); };
  const handlePreSave = (e: React.FormEvent) => { e.preventDefault(); setActiveStage(1); setIsChecklistOpen(true); };
  
  const handleFinalSave = async () => {
    setIsSaving(true);
    try {
        const today = new Date();
        const year = today.getFullYear();
        const yearLoans = loans.filter(l => l.id.endsWith(`/${year}`));
        let maxSeq = 0;
        yearLoans.forEach(l => { const parts = l.id.split('/'); if(parts.length === 2) { const seq = parseInt(parts[0]); if(!isNaN(seq) && seq > maxSeq) maxSeq = seq; } });
        const nextSeq = maxSeq + 1;
        const newID = `${nextSeq.toString().padStart(2, '0')}/${year}`;
        const checkedItems = checklistItems.filter(i => i.checked).map(i => i.id);

        const newLoan: Loan = {
            id: newID,
            client: formData.client,
            amount: parseFloat(formData.amount),
            installments: parseInt(formData.installments),
            interestRate: parseFloat(formData.interestRate),
            startDate: formData.startDate,
            nextDue: new Date(new Date(formData.startDate).setMonth(new Date(formData.startDate).getMonth() + 1)).toISOString().split('T')[0],
            status: 'Em Dia', 
            installmentValue: simulation.installment,
            fineRate: parseFloat(formData.fineRate) || 2.0, 
            clientBank: formData.clientBank, 
            paymentMethod: formData.paymentMethod, 
            justification: justification,
            checklistAtApproval: checkedItems,
            totalPaidCapital: 0, totalPaidInterest: 0,
            history: [{ date: new Date().toISOString(), amount: parseFloat(formData.amount), type: 'Abertura', note: 'Empréstimo Concedido' }],
            
            // --- CORREÇÃO AQUI: CASTING PARA O TIPO CORRETO ---
            InterestType: formData.interestType as 'PRICE' | 'SIMPLE',
            
            GuarantorName: formData.hasGuarantor ? formData.guarantorName : '',
            GuarantorCPF: formData.hasGuarantor ? formData.guarantorCPF : '',
            GuarantorAddress: formData.hasGuarantor ? formData.guarantorAddress : ''
        };
        await loanService.create(newLoan);
        fetchLoans();
        setIsChecklistOpen(false); setIsModalOpen(false);
        setFormData({ 
            client: '', amount: '', interestRate: '', installments: '', startDate: '', 
            fineRate: '2.0', clientBank: '', paymentMethod: '', 
            interestType: 'PRICE', hasGuarantor: false, guarantorName: '', guarantorCPF: '', guarantorAddress: '' 
        });
        setJustification('');
        alert(`✅ Contrato ${newID} criado.`);
    } catch (err) { alert("Erro ao salvar."); } finally { setIsSaving(false); }
  };

  const handleDelete = async (id: string) => { if (confirm('Deseja excluir?')) { try { await loanService.delete(id); fetchLoans(); setIsDetailsOpen(false); } catch (err) { alert("Erro ao excluir."); } } };
  
  const filteredLoans = loans.filter(l => {
    const matchesSearch = (l.client || '').toLowerCase().includes(searchTerm.toLowerCase()) || (l.id || '').toLowerCase().includes(searchTerm.toLowerCase());
    const realStatus = getLoanRealStatus(l);
    const matchesStatus = statusFilter === 'Todos' || realStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <Layout>
      <header className="flex justify-between items-center mb-8">
        <div><h2 className="text-2xl font-bold text-slate-800">Cobrança e Empréstimos</h2><p className="text-slate-500">Gestão financeira completa.</p></div>
        <div className="flex gap-2">
            <button onClick={() => fetchLoans()} className="flex items-center gap-2 bg-white border border-gray-200 text-slate-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors font-bold shadow-sm"><RefreshCw className={isLoadingList ? "animate-spin" : ""} size={18} /> Recarregar</button>
            <button onClick={handleExportExcel} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-900/10"><Download size={18} /> Exportar Selecionados ({selectedIds.length})</button>
            <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20"><Plus size={20} /> Novo Contrato</button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 border-l-4 border-l-yellow-400"><div className="flex justify-between mb-4"><span className="text-slate-500 font-medium">A Receber (Hoje)</span><Clock className="text-yellow-400" size={20}/></div><h3 className="text-2xl font-bold text-slate-800">R$ {formatMoney(summary.today)}</h3></div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 border-l-4 border-l-red-500"><div className="flex justify-between mb-4"><span className="text-slate-500 font-medium">Atrasados (Total)</span><AlertCircle className="text-red-500" size={20}/></div><h3 className="text-2xl font-bold text-slate-800">R$ {formatMoney(summary.overdue)}</h3></div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 border-l-4 border-l-green-500"><div className="flex justify-between mb-4"><span className="text-slate-500 font-medium">Lucro Real (Juros)</span><TrendingUp className="text-green-500" size={20}/></div><h3 className="text-2xl font-bold text-slate-800">R$ {formatMoney(summary.received)}</h3></div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-visible">
        <div className="p-4 border-b border-slate-50 bg-slate-50/30 flex flex-col md:flex-row gap-4 justify-between items-center rounded-t-2xl">
          <div className="relative w-full md:w-96"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input type="text" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-slate-900/5 transition-all"/></div>
          <div className="flex gap-2 w-full md:w-auto"><select value={statusFilter} onChange={(e: any) => setStatusFilter(e.target.value)} className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium outline-none"><option value="Todos">Todos</option><option value="Em Dia">Em Dia</option><option value="Atrasado">Atrasado</option><option value="Pago">Pago</option></select></div>
        </div>
        <div className="overflow-visible min-h-[400px]">
            <table className="w-full text-left">
            <thead>
                <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                    <th className="p-4 text-center w-10"><input type="checkbox" onChange={toggleSelectAll} checked={filteredLoans.length > 0 && selectedIds.length === filteredLoans.length} className="w-4 h-4 rounded border-gray-300 text-slate-900 cursor-pointer"/></th>
                    <th className="p-4">Cliente</th>
                    <th className="p-4 text-center">Parcelas</th>
                    {/* NOVA COLUNA: VENCIMENTO */}
                    <th className="p-4 text-center">Vencimento</th>
                    <th className="p-4 text-right">Capital Atual</th>
                    <th className="p-4 text-right text-green-600">Lucro (Juros)</th>
                    <th className="p-4 text-center">Status</th>
                    <th className="p-4 text-right">Ações</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
                {filteredLoans.length === 0 ? (<tr><td colSpan={8} className="p-8 text-center text-slate-400">Vazio.</td></tr>) : (filteredLoans.map(loan => {
                    const displayStatus = getLoanRealStatus(loan);
                    return (
                        <tr key={loan.id} className={`transition-colors group ${selectedIds.includes(loan.id) ? 'bg-blue-50/50' : 'hover:bg-slate-50/80'}`}>
                            <td className="p-4 text-center"><input type="checkbox" checked={selectedIds.includes(loan.id)} onChange={() => toggleSelectOne(loan.id)} className="w-4 h-4 rounded border-gray-300 text-slate-900 cursor-pointer"/></td>
                            <td className="p-4"><div className="font-bold text-slate-800">{loan.client}</div><div className="text-[10px] font-mono text-slate-400">{loan.id}</div></td>
                            <td className="p-4 text-center"><span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold border border-slate-200">{loan.installments}x</span></td>
                            {/* DADO DA NOVA COLUNA VENCIMENTO */}
                            <td className="p-4 text-center">
                                <span className={`font-bold text-sm ${displayStatus === 'Atrasado' ? 'text-red-600' : 'text-slate-700'}`}>
                                    {new Date(loan.nextDue).toLocaleDateString('pt-BR')}
                                </span>
                            </td>
                            <td className="p-4 text-right font-bold text-slate-700">R$ {formatMoney(loan.amount)}</td>
                            <td className="p-4 text-right font-bold text-green-600 bg-green-50/30 rounded">R$ {formatMoney(loan.totalPaidInterest || 0)}</td>
                            <td className="p-4 text-center"><span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${displayStatus === 'Em Dia' ? 'bg-blue-50 text-blue-600' : displayStatus === 'Atrasado' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>{displayStatus}</span></td>
                            <td className="p-4 text-right relative"><div className="relative inline-block text-left"><button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === loan.id ? null : loan.id); }} className={`p-2 rounded-lg transition-all ${openMenuId === loan.id ? 'bg-slate-200 text-slate-900' : 'text-slate-400 hover:text-slate-900 hover:bg-slate-100'}`}><MoreVertical size={18} /></button>
                                {openMenuId === loan.id && (<div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-2xl border border-slate-100 z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right"><div className="py-1"><button onClick={() => { setSelectedLoan(loan); setDetailTab('info'); setIsDetailsOpen(true); setOpenMenuId(null); }} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"><Eye size={16} className="text-blue-500" /> Ver Detalhes</button><button onClick={() => { handleOpenPayment(loan); setOpenMenuId(null); }} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"><DollarSign size={16} className="text-green-600" /> Registrar Baixa</button><div className="border-t border-slate-100 my-1"></div><button onClick={() => { const c = availableClients.find(cl => cl.name === loan.client); generateContractPDF(loan, c); setOpenMenuId(null); }} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"><Printer size={16} /> Contrato PDF</button><button onClick={() => { const c = availableClients.find(cl => cl.name === loan.client); generatePromissoryPDF(loan, c); setOpenMenuId(null); }} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"><FileText size={16} /> Promissórias</button><div className="border-t border-slate-100 my-1"></div><button onClick={() => { handleDelete(loan.id); setOpenMenuId(null); }} className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 size={16} /> Excluir</button></div></div>)}</div></td>
                        </tr>
                    );
                }))}
            </tbody>
            </table>
        </div>
      </div>

      <Modal isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Detalhes do Contrato">
        {selectedLoan && (
          <div className="space-y-6">
            <div className="flex border-b border-slate-200"><button onClick={() => setDetailTab('info')} className={`flex-1 pb-3 text-sm font-bold border-b-2 transition-all ${detailTab === 'info' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>Visão Geral</button><button onClick={() => setDetailTab('history')} className={`flex-1 pb-3 text-sm font-bold border-b-2 transition-all ${detailTab === 'history' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>Extrato Financeiro</button></div>
            {detailTab === 'info' ? (
                <>
                    <div className="bg-slate-900 p-6 rounded-2xl shadow-xl text-white relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10"><FileText size={64} /></div>
                        <h3 className="text-xl font-black mb-1">{selectedLoan.client}</h3>
                        <div className="flex gap-4 text-[10px] text-slate-400 font-mono uppercase tracking-widest mt-1"><span>ID: {selectedLoan.id}</span><span>•</span><span>Criado em: {new Date(selectedLoan.startDate).toLocaleDateString('pt-BR')}</span></div>
                        <div className="mt-6 flex gap-8">
                            <div><p className="text-[10px] uppercase text-slate-400 font-bold">Saldo Devedor</p><p className="text-3xl font-bold text-white">R$ {formatMoney(selectedLoan.amount)}</p></div>
                            <div className="w-px bg-slate-700"></div>
                            <div>
                                <p className="text-[10px] uppercase text-slate-400 font-bold">Próx. Parcela</p>
                                <p className="text-2xl font-bold text-green-400">R$ {formatMoney(selectedLoan.installmentValue)}</p>
                                <div className="text-[10px] text-slate-400 mt-1 flex gap-3">
                                    <span>Cap: <b>R$ {formatMoney(getBreakdown(selectedLoan).capital)}</b></span>
                                    <span>Jur: <b>R$ {formatMoney(getBreakdown(selectedLoan).interest)}</b></span>
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* INFO ADICIONAL: TIPO DE CONTRATO E FIADOR */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white border border-slate-100 rounded-xl p-4">
                            <span className="text-xs font-bold text-slate-400 uppercase block mb-1">Modalidade</span>
                            <span className="text-sm font-bold text-slate-800">
                                {selectedLoan.InterestType === 'SIMPLE' ? 'Pagamento Mínimo (Só Juros)' : 'Price (Amortização)'}
                            </span>
                        </div>
                        {selectedLoan.GuarantorName && (
                            <div className="bg-white border border-slate-100 rounded-xl p-4">
                                <span className="text-xs font-bold text-slate-400 uppercase block mb-1">Fiador Vinculado</span>
                                <span className="text-sm font-bold text-slate-800 truncate block">{selectedLoan.GuarantorName}</span>
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {(!selectedLoan.history || selectedLoan.history.length === 0) ? (<div className="text-center py-10 text-slate-400 flex flex-col items-center"><History size={32} className="mb-2 opacity-50"/><p className="text-sm">Nenhum registro de pagamento encontrado.</p></div>) : (
                        <div className="relative border-l-2 border-slate-100 ml-3 space-y-6 py-2">
                            {selectedLoan.history.slice().reverse().map((record, idx) => {
                                const isOpening = record.type.toLowerCase().includes('abertura') || record.type.toLowerCase().includes('empréstimo');
                                return (
                                    <div key={idx} className="relative pl-6">
                                        <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white ${isOpening ? 'bg-green-500' : 'bg-blue-500'}`}></div>
                                        <div>
                                            <div className="flex justify-between items-start mb-1">
                                                <p className="text-xs text-slate-400 font-mono">{new Date(record.date).toLocaleDateString('pt-BR')} às {new Date(record.date).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</p>
                                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${isOpening ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{record.type}</span>
                                            </div>
                                            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                                <div className="flex justify-between items-center mb-1 border-b border-slate-200 pb-1">
                                                    <span className="text-xs font-bold text-slate-500">{isOpening ? 'VALOR CONCEDIDO:' : 'TOTAL PAGO:'}</span>
                                                    <span className="font-black text-slate-800">R$ {formatMoney(record.amount)}</span>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 mt-2">
                                                    <div><span className="block text-[10px] uppercase text-slate-400 font-bold">Amortização</span><span className="text-xs font-bold text-slate-700">R$ {formatMoney(record.capitalPaid || 0)}</span></div>
                                                    <div><span className="block text-[10px] uppercase text-slate-400 font-bold">Lucro (Juros)</span><span className="text-xs font-bold text-green-600">R$ {formatMoney(record.interestPaid || 0)}</span></div>
                                                </div>
                                                {record.note && <p className="text-[10px] text-slate-400 italic mt-2 border-t border-slate-200 pt-1">{record.note}</p>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
            <div className="flex flex-col gap-2 pt-4 border-t border-slate-100"><button onClick={() => { handleOpenPayment(selectedLoan); setIsDetailsOpen(false); }} className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-slate-800 transition-all shadow-lg"><DollarSign size={18} /> Registrar Novo Pagamento</button></div>
          </div>
        )}
      </Modal>

      <Modal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} title="Baixa Flexível">
        <div className="space-y-5">
            {selectedLoan && (cycleAcc.interest > 0 || cycleAcc.capital > 0) && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                        <Info size={16} className="text-blue-600"/>
                        <span className="text-xs font-bold text-blue-900">Juros Acumulados no Ciclo</span>
                    </div>
                    <div className="flex justify-between text-xs text-blue-800 mb-1">
                        <span>Pago: R$ {formatMoney(cycleAcc.interest)}</span>
                        <span>Meta: R$ {formatMoney(getBreakdown(selectedLoan).interest)}</span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                        <div className="bg-blue-600 h-full transition-all" style={{ width: `${Math.min(100, (cycleAcc.interest / getBreakdown(selectedLoan).interest) * 100)}%` }}></div>
                    </div>
                </div>
            )}

            {selectedLoan && !settleInterest && (parseFloat(payInterest || '0') + cycleAcc.interest) >= (selectedLoan.amount * (selectedLoan.interestRate/100) - 0.10) && (
                <div className="flex items-center gap-2 bg-green-50 text-green-700 p-2 rounded-lg text-xs animate-in fade-in slide-in-from-top-1">
                    <PartyPopper size={16}/>
                    <span>✨ Este valor completa os juros do mês! O vencimento avançará.</span>
                </div>
            )}

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <label className="flex items-center gap-2 text-xs font-bold uppercase text-slate-500 mb-2"><Calendar size={14}/> Data e Hora do Pagamento</label>
                <input type="datetime-local" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-full p-3 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-slate-900/5 font-mono text-sm"/>
                <p className="text-[10px] text-slate-400 mt-1 italic">Use para registrar pagamentos feitos anteriormente.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Capital (Amortização)</label>
                    <small className="block text-[10px] text-slate-400 mb-1">Esperado: R$ {selectedLoan && formatMoney(getBreakdown(selectedLoan).capital)}</small>
                    <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">R$</span><input type="number" step="0.01" value={payCapital} onChange={(e) => setPayCapital(e.target.value)} className="w-full pl-10 p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5 font-bold text-slate-700" placeholder="0.00"/></div>
                </div>
                <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Juros (Lucro)</label>
                    <small className="block text-[10px] text-slate-400 mb-1">Esperado: R$ {selectedLoan && formatMoney(getBreakdown(selectedLoan).interest)}</small>
                    <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-green-500 font-bold">R$</span><input type="number" step="0.01" value={payInterest} onChange={(e) => setPayInterest(e.target.value)} className="w-full pl-10 p-3 border border-green-200 rounded-xl outline-none focus:ring-2 focus:ring-green-500/20 font-bold text-green-600 bg-green-50/30" placeholder="0.00"/></div>
                </div>
            </div>
            <div className="flex items-center gap-2 py-2"><input type="checkbox" id="settleInterest" checked={settleInterest} onChange={(e) => setSettleInterest(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"/><label htmlFor="settleInterest" className="text-xs font-bold text-slate-600">Quitar Juros do Mês?</label></div>
            
            {settleInterest && selectedLoan && (parseFloat(payInterest || '0') + cycleAcc.interest) < (selectedLoan.amount * (selectedLoan.interestRate/100) - 0.10) && (
                <div className="flex items-center gap-2 bg-orange-50 text-orange-700 p-2 rounded-lg text-xs">
                    <AlertTriangle size={14}/>
                    <span>Atenção: Juros somado menor que o devido. O histórico registrará desconto.</span>
                </div>
            )}

            <div className="bg-slate-900 p-4 rounded-xl text-center shadow-lg"><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Recebido</span><p className="text-3xl font-black text-white mt-1">R$ {formatMoney(payTotal)}</p></div>
            <button onClick={confirmPayment} className="w-full py-4 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-all shadow-lg flex items-center justify-center gap-2"><Check size={20}/> Confirmar Baixa</button>
        </div>
      </Modal>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Novo Empréstimo">
        <form onSubmit={handlePreSave} className="space-y-6">
          <div className="space-y-4">
            <div><label className="block text-xs font-bold uppercase text-slate-500 mb-2">Cliente Selecionado</label><select required value={formData.client} onChange={e => setFormData({...formData, client: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-slate-900/5"><option value="">Selecione o titular...</option>{availableClients.map((c) => (<option key={c.id} value={c.name}>{c.name}</option>))}</select></div>
            
            {/* DADOS BANCÁRIOS (AUTOCOMPLETE) */}
            <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100"><div className="col-span-2"><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Banco do Cliente</label><input value={formData.clientBank} onChange={e => setFormData({...formData, clientBank: e.target.value})} className="w-full p-2 border rounded-lg bg-white" placeholder="Ex: Nubank, Itaú..."/></div><div className="col-span-2"><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Forma de Pagamento</label><input value={formData.paymentMethod} onChange={e => setFormData({...formData, paymentMethod: e.target.value})} className="w-full p-2 border rounded-lg bg-white" placeholder="CPF, Email, Ag/Conta..."/></div><div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Multa Atraso (%)</label><input value={formData.fineRate} onChange={e => setFormData({...formData, fineRate: e.target.value})} className="w-full p-2 border rounded-lg bg-white" placeholder="Ex: 2.0"/></div></div>
            
            {/* VALORES E DATAS */}
            <div className="grid grid-cols-2 gap-4"><div><label className="block text-xs font-bold uppercase text-slate-500 mb-2">Valor (R$)</label><input required type="number" step="0.01" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5" placeholder="0,00"/></div><div><label className="block text-xs font-bold uppercase text-slate-500 mb-2">Taxa Mensal (%)</label><input required type="number" step="0.01" value={formData.interestRate} onChange={e => setFormData({...formData, interestRate: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5" placeholder="5.0"/></div><div><label className="block text-xs font-bold uppercase text-slate-500 mb-2">Data da Operação</label><input required type="date" value={formData.startDate} onChange={e => setFormData({...formData, startDate: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5" /></div><div><label className="block text-xs font-bold uppercase text-slate-500 mb-2">Qtd. Parcelas</label><input required type="number" value={formData.installments} onChange={e => setFormData({...formData, installments: e.target.value})} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5" placeholder="12"/></div></div>
            
            {/* CHECKBOX: MODO SÓ JUROS */}
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
                <input type="checkbox" id="interestType" checked={formData.interestType === 'SIMPLE'} onChange={(e) => setFormData({...formData, interestType: e.target.checked ? 'SIMPLE' : 'PRICE'})} className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500" />
                <label htmlFor="interestType" className="text-sm font-bold text-blue-800 cursor-pointer">Pagamento Mínimo (Só Juros) <span className="text-xs font-normal text-blue-600 block">O cliente paga apenas os juros mensais. O capital não abate.</span></label>
            </div>

            {/* CHECKBOX: FIADOR */}
            <div className="flex items-center gap-2 mt-4"><input type="checkbox" id="hasGuarantor" checked={formData.hasGuarantor} onChange={(e) => setFormData({...formData, hasGuarantor: e.target.checked})} className="w-4 h-4 rounded text-slate-900 focus:ring-slate-500"/><label htmlFor="hasGuarantor" className="text-sm font-bold text-slate-700 cursor-pointer">Adicionar Fiador (Opcional)</label></div>
            
            {/* CAMPOS DE FIADOR (CONDICIONAL) */}
            {formData.hasGuarantor && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 animate-in slide-in-from-top-2">
                    <div className="flex items-center gap-2 mb-2"><UserCheck size={18} className="text-slate-500"/><span className="text-xs font-bold uppercase text-slate-500">Dados do Fiador</span></div>
                    <input type="text" placeholder="Nome Completo do Fiador" value={formData.guarantorName} onChange={(e) => setFormData({...formData, guarantorName: e.target.value})} className="w-full p-2 border rounded-lg bg-white"/>
                    <div className="grid grid-cols-2 gap-3">
                        <input type="text" placeholder="CPF do Fiador" value={formData.guarantorCPF} onChange={(e) => setFormData({...formData, guarantorCPF: e.target.value})} className="w-full p-2 border rounded-lg bg-white"/>
                        <input type="text" placeholder="Endereço Completo" value={formData.guarantorAddress} onChange={(e) => setFormData({...formData, guarantorAddress: e.target.value})} className="w-full p-2 border rounded-lg bg-white"/>
                    </div>
                </div>
            )}
          </div>

          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 shadow-inner"><div className="flex items-center gap-2 mb-4 border-b border-slate-200 pb-3"><Calculator size={20} className="text-slate-800" /><h4 className="text-[12px] font-bold text-slate-800 uppercase tracking-widest">Simulação Financeira ({formData.interestType === 'SIMPLE' ? 'Juros Simples' : 'Price'})</h4></div>{isSimulating ? (<div className="flex justify-center py-4"><Loader2 className="animate-spin text-slate-400" /></div>) : simulation.isValid ? (<div className="space-y-4"><div className="flex justify-between items-center text-sm font-medium"><span className="text-slate-500">Montante Financiado:</span><span className="text-slate-900 font-bold">R$ {formatMoney(parseFloat(formData.amount))}</span></div><div className="flex justify-between items-center"><span className="text-sm text-slate-500 font-medium">Parcela Mensal ({formData.installments}x):</span><span className="text-xl font-black text-green-600 bg-green-50 px-3 py-1 rounded-lg border border-green-100">R$ {formatMoney(simulation.installment)}</span></div><div className="flex justify-between items-center text-sm"><span className="text-slate-500 font-medium">Custo Total de Juros:</span><span className="text-red-600 font-bold">+ R$ {formatMoney(simulation.totalInterest)}</span></div></div>) : (<p className="text-center text-slate-400 text-xs py-4 font-medium italic">Aguardando dados...</p>)}</div>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100"><button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-all">Cancelar</button><button type="submit" disabled={!simulation.isValid} className="px-8 py-3 bg-slate-900 text-white rounded-xl flex items-center gap-2 font-bold shadow-xl shadow-slate-900/20 disabled:opacity-50 hover:bg-slate-800 transition-all">Iniciar Triagem <ChevronRight size={18} /></button></div>
        </form>
      </Modal>
    </Layout>
  );
};

export default Billing;