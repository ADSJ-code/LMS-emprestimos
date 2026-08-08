import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, Receipt, FileText, CheckCircle, AlertCircle,
  Clock, Download, RefreshCw, Send, Landmark, Calendar,
  Edit, Trash2
} from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { formatMoney } from '../utils/finance';
import { loanService, clientService, invoiceService, Loan, Client, InvoiceRecord } from '../services/api';

const Invoices = () => {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]); // 🚀 Dados Reais do Banco
  
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'pendentes' | 'historico' | 'avulsa'>('pendentes');

  // 🚀 ESTADOS DO FILTRO DE MÊS
  const [filterMonth, setFilterMonth] = useState<string>('todos');

  // 🚀 ESTADOS DA EMISSÃO AVULSA
  const [avulsaSearch, setAvulsaSearch] = useState('');
  const [avulsaSelectedClient, setAvulsaSelectedClient] = useState<Client | null>(null);
  const [avulsaValue, setAvulsaValue] = useState('');

  // 🚀 EXTRAÇÃO DE APELIDO: Limpa o JSON e mostra apenas a observação
  const getNickname = (obs?: string) => {
      if (!obs) return '';
      let clean = obs.split('[META:')[0].trim();
      return clean.replace(/\}\]$/, '').trim();
  };

  // 🚀 LIMPADOR DE ACENTOS (NOVO) - Ensina o sistema a ignorar acentos e letras maiúsculas
  const normalizeString = (str: string) => {
      if (!str) return '';
      return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  };

  // Estado Modal de Emissão
  const [isEmitModalOpen, setIsEmitModalOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [isEmitting, setIsEmitting] = useState(false);

  // Estado Modal de Edição de Valor
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [paymentToEdit, setPaymentToEdit] = useState<any>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  
  // 🚀 ESTADO DA SANFONA DE DETALHES DOS PACOTES
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [loansData, clientsData, invoicesData] = await Promise.all([
        loanService.getAll(),
        clientService.getAll(),
        invoiceService.getAll() // 🚀 Puxa o histórico real do Go
      ]);
      setLoans(loansData || []);
      setClients(clientsData || []);
      setInvoices(invoicesData || []);
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 🚀 POLLING INTELIGENTE: Se tiver nota "PROCESSANDO", atualiza a lista a cada 3 seg para ver o retorno da prefeitura
  useEffect(() => {
    const hasProcessing = invoices.some(inv => inv.status === 'PROCESSANDO');
    if (hasProcessing) {
      const interval = setInterval(() => {
        invoiceService.getAll().then(data => setInvoices(data || []));
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [invoices]);

  // 🚀 LIMPADOR INTELIGENTE: Blindagem contra strings no banco
  const parseVal = (v: any): number => {
      if (typeof v === 'number') return isNaN(v) ? 0 : v;
      if (!v) return 0;
      if (typeof v === 'string') return parseFloat(v.replace(/\./g, '').replace(',', '.')) || 0;
      return 0;
  };

  // 🚀 Lógica Inteligente: Extrai e AGRUPA pagamentos do mesmo cliente no mesmo dia!
  const availablePayments = useMemo(() => {
    const groups: Record<string, any> = {};
    
    // Lista negra para não faturar clientes bloqueados
    const blockedNames = new Set(clients.filter(c => c.status === 'Bloqueado').map(c => c.name));

    loans.forEach(loan => {
      if (!loan.history || blockedNames.has(loan.client)) return;
      
      const clientInfo = clients.find(c => normalizeString(c.name) === normalizeString(loan.client));
      const safeClientName = normalizeString(loan.client).replace(/[^a-z0-9]/g, '');

      loan.history.forEach((record: any, index) => {
        const type = record.type?.toLowerCase() || '';
        
        // Ignora aberturas, acordos e pagamentos zerados
        if (type.includes('abertura') || type.includes('empréstimo') || type.includes('acordo') || parseVal(record.amount) <= 0) return;
        if (record.nfeStatus === 'IGNORADA' || record.nfeStatus === 'EMITIDA_MANUAL') return;

        const jurosRecebido = record.nfeValue !== undefined ? parseVal(record.nfeValue) : parseVal(record.interestPaid);
        if (jurosRecebido <= 0) return;

        // 🚀 CRIA A CHAVE DO GRUPO (Cliente + Data)
        const dateStr = record.date.split('T')[0];
        // ID Baseado no Cliente e no Dia. Ex: NFG-DAIANE-20260716
        const groupId = `NFG-${safeClientName}-${dateStr.replace(/-/g, '')}`;
        
        const groupInvoices = invoices.filter(inv => inv.id === groupId || inv.id?.startsWith(`${groupId}-R`));
        let relatedInvoice = groupInvoices.find(inv => String(inv.status) !== 'CANCELADA');
        if (!relatedInvoice && groupInvoices.length > 0) {
            relatedInvoice = groupInvoices[groupInvoices.length - 1]; 
        }

        if (relatedInvoice && relatedInvoice.status === 'AUTORIZADA') return;

        if (!groups[groupId]) {
           groups[groupId] = {
             uniqueId: groupId,
             client: loan.client,
             cpf: clientInfo?.cpf || 'Não cadastrado',
             paymentDate: dateStr,
             totalPaid: 0,
             capitalPaid: 0,
             interestPaid: 0,
             invoiceStatus: relatedInvoice?.status || null,
             underlyingRecords: [], // Guarda todos os registos originais para atualizar o BD
             contracts: new Set()   // Guarda os IDs dos contratos
           };
        }

        groups[groupId].totalPaid += parseVal(record.amount);
        groups[groupId].capitalPaid += parseVal(record.capitalPaid || 0);
        groups[groupId].interestPaid += jurosRecebido;
        groups[groupId].contracts.add(loan.id);
        groups[groupId].underlyingRecords.push({ loanId: loan.id, recordIndex: index, originalRecord: record });
      });
    });

    return Object.values(groups)
      .map(g => ({ ...g, contractId: Array.from(g.contracts).join(', ') })) // Junta os contratos p/ a Tabela
      .filter(p => p.client.toLowerCase().includes(searchTerm.toLowerCase()) || p.contractId.includes(searchTerm))
      .sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());
  }, [loans, clients, searchTerm, invoices]);

  // 🚀 JUNTA O HISTÓRICO REAL COM AS NOTAS EMITIDAS MANUALMENTE NO SISTEMA
  const allHistoricalInvoices = useMemo(() => {
      const list: any[] = [...invoices];
      
      loans.forEach(loan => {
          loan.history?.forEach((record: any, index: number) => {
              if (record.nfeStatus === 'EMITIDA_MANUAL') {
                  const clientInfo = clients.find(c => c.name === loan.client);
                  list.push({
                      id: `MANUAL-${loan.id.replace(/[^a-zA-Z0-9]/g, '')}-${index}`,
                      issueDate: record.date,
                      client: loan.client,
                      cpf: clientInfo?.cpf || 'Não cadastrado',
                      serviceValue: record.nfeValue !== undefined ? parseVal(record.nfeValue) : parseVal(record.interestPaid),
                      status: 'EMITIDA_MANUAL',
                      pdfUrl: '',
                      errorMsg: 'Baixa manual. Obrigação cumprida fora do sistema.'
                  });
              }
          });
      });
      return list.sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime());
  }, [invoices, loans, clients]);

  const availableMonths = useMemo(() => {
      const months = new Set<string>();
      
      // 🚀 FORÇA A EXIBIÇÃO DO MÊS ATUAL MESMO QUE AINDA NÃO TENHA NENHUMA NOTA EMITIDA
      const today = new Date();
      const currentMonthVal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
      months.add(currentMonthVal);

      allHistoricalInvoices.forEach(inv => {
          if (inv.issueDate) {
              const d = new Date(inv.issueDate);
              const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              months.add(val);
          }
      });
      return Array.from(months).sort().reverse();
  }, [allHistoricalInvoices]);

  // 🚀 Filtro do Histórico
  const filteredInvoices = useMemo(() => {
    return allHistoricalInvoices.filter(inv => {
      const matchSearch = inv.client?.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (inv.id && inv.id.toLowerCase().includes(searchTerm.toLowerCase()));
      
      let matchMonth = true;
      if (filterMonth !== 'todos') {
          if (inv.issueDate) {
              const d = new Date(inv.issueDate);
              const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              matchMonth = val === filterMonth;
          } else {
              matchMonth = false;
          }
      }

      return matchSearch && matchMonth;
    });
  }, [allHistoricalInvoices, searchTerm, filterMonth]);

  const handleOpenEmitModal = (payment: any) => {
    setSelectedPayment(payment);
    setIsEmitModalOpen(true);
  };

  // 🚀 NOVAS AÇÕES PODEROSAS DO RODRIGO
  const handleEditNfeValue = (payment: any) => {
      setPaymentToEdit(payment);
      setEditValue(formatMoney(payment.interestPaid));
      setIsEditModalOpen(true);
  };

  const confirmEditNfeValue = async () => {
      if (!paymentToEdit || !editValue) return;
      setIsEditing(true);

      const newVal = parseVal(editValue);
      if (newVal <= 0) { 
          alert("Valor inválido."); 
          setIsEditing(false);
          return; 
      }

      // Descobre a proporção do ajuste para dividir pelos contratos aglomerados
      const ratio = paymentToEdit.interestPaid > 0 ? (newVal / paymentToEdit.interestPaid) : 1;
      const updatesByLoan: Record<string, Loan> = {};

      paymentToEdit.underlyingRecords.forEach((ur: any) => {
          if (!updatesByLoan[ur.loanId]) {
              const loanObj = loans.find(l => l.id === ur.loanId);
              if (loanObj) updatesByLoan[ur.loanId] = JSON.parse(JSON.stringify(loanObj)); // Cópia segura
          }
          const loanToUpdate = updatesByLoan[ur.loanId];
          if (loanToUpdate && loanToUpdate.history) {
              const currentBase = ur.originalRecord.nfeValue !== undefined ? parseVal(ur.originalRecord.nfeValue) : parseVal(ur.originalRecord.interestPaid);
              // 🚀 FIX TS: Usando as any para evitar erro de tipagem
              (loanToUpdate.history[ur.recordIndex] as any).nfeValue = currentBase * ratio;
          }
      });

      try {
          await Promise.all(Object.values(updatesByLoan).map(l => 
              loanService.update(l.id, l as any, 'EDIÇÃO DE VALOR NF (PACOTE)', `Base de cálculo rateada. Total do pacote ajustado para R$ ${newVal.toFixed(2)}`)
          ));
          await fetchData();
          setIsEditModalOpen(false);
      } catch (e) { 
          alert("Erro ao atualizar valor."); 
      } finally {
          setIsEditing(false);
      }
  };

  const handleIgnorePayment = async (payment: any) => {
      if (!window.confirm(`⚠️ Deseja realmente REMOVER este pacote de pagamentos da fila de emissão?\n\nEle desaparecerá desta lista e não será enviado para a Sefaz.`)) return;

      const updatesByLoan: Record<string, Loan> = {};
      payment.underlyingRecords.forEach((ur: any) => {
          if (!updatesByLoan[ur.loanId]) {
              const loanObj = loans.find(l => l.id === ur.loanId);
              if (loanObj) updatesByLoan[ur.loanId] = JSON.parse(JSON.stringify(loanObj));
          }
          const hist = updatesByLoan[ur.loanId]?.history;
          if (hist) {
              // 🚀 FIX TS: Protegendo contra undefined
              (hist[ur.recordIndex] as any).nfeStatus = 'IGNORADA';
          }
      });

      try {
          await Promise.all(Object.values(updatesByLoan).map(l => loanService.update(l.id, l as any, 'NF IGNORADA', `Pacote de pagamentos ignorado na fila de emissão fiscal.`)));
          fetchData();
      } catch (e) { alert("Erro ao ignorar pagamentos."); }
  };

  const handleManualEmission = async (payment: any) => {
      if (!window.confirm(`✅ Marcar pacote como EMITIDO MANUALMENTE?\n\nIsto moverá os registros para a aba de Histórico, indicando que você já emitiu esta nota por fora ou de outra forma. Não haverá comunicação com a Prefeitura.`)) return;

      const updatesByLoan: Record<string, Loan> = {};
      payment.underlyingRecords.forEach((ur: any) => {
          if (!updatesByLoan[ur.loanId]) {
              const loanObj = loans.find(l => l.id === ur.loanId);
              if (loanObj) updatesByLoan[ur.loanId] = JSON.parse(JSON.stringify(loanObj));
          }
          const hist = updatesByLoan[ur.loanId]?.history;
          if (hist) {
              // 🚀 FIX TS: Protegendo contra undefined
              (hist[ur.recordIndex] as any).nfeStatus = 'EMITIDA_MANUAL';
          }
      });

      try {
          await Promise.all(Object.values(updatesByLoan).map(l => loanService.update(l.id, l as any, 'NF MANUAL', `Pacote marcado como nota emitida manualmente por fora.`)));
          fetchData();
      } catch (e) { alert("Erro ao atualizar."); }
  };

  // 🚀 LÓGICA OFICIAL: Cancelar Nota Fiscal (Síncrono com Focus/Prefeitura)
  const handleDeleteInvoice = async (invoiceId: string) => {
    const justificativa = window.prompt("⚠️ CANCELAMENTO OFICIAL DE NFS-e\n\nDigite o motivo do cancelamento (Mínimo de 15 caracteres):");
    
    if (justificativa === null) return;
    
    if (justificativa.length < 15) {
      alert("❌ A justificativa precisa ter pelo menos 15 caracteres conforme regra da Receita.");
      return;
    }

    try {
      // 🚀 Chama a nova função do api.ts que acabamos de criar!
      await invoiceService.delete(invoiceId, justificativa);
      
      alert("✅ Solicitação de cancelamento processada! O status será atualizado na tabela.");
      fetchData(); 
    } catch (error: any) {
      console.error("Erro ao cancelar:", error);
      const backendMsg = error.response?.data?.mensagem || error.response?.data?.errorMsg || "Erro desconhecido. O gateway pode estar indisponível.";
      alert(`❌ Erro ao cancelar nota no Gateway Fiscal:\n\n${backendMsg}`);
    }
  };

  const confirmEmission = async () => {
    setIsEmitting(true);
    try {
      // 🚀 MOTOR DE REEMISSÃO: Se a nota anterior foi cancelada ou deu erro, gera um novo ID único com sufixo -R
      const isReemission = String(selectedPayment.invoiceStatus) === 'CANCELADA' || String(selectedPayment.invoiceStatus) === 'ERRO';
      const finalEmissionId = isReemission 
          ? `${selectedPayment.uniqueId}-R${Date.now().toString().slice(-6)}` 
          : selectedPayment.uniqueId;

      await invoiceService.emit({
        id: finalEmissionId,
        client: selectedPayment.client,
        cpf: selectedPayment.cpf,
        serviceValue: selectedPayment.interestPaid,
        // 🚀 FIX ERRO PREFEITURA: Zera explicitamente as retenções para evitar "PIS Inconsistente" ou "Valores Divergentes"
        pis: 0,
        cofins: 0,
        csll: 0,
        inss: 0,
        ir: 0
      } as any);
      
      const updatedInvoices = await invoiceService.getAll();
      setInvoices(updatedInvoices || []);
      
      setIsEmitModalOpen(false);
      setActiveTab('historico');
    } catch (error: any) {
      const backendMsg = error.response?.data;
      if (backendMsg && typeof backendMsg === 'string') {
          alert(`⚠️ Aviso do Sistema: ${backendMsg}`);
      } else {
          alert("❌ Falha ao comunicar com o servidor para emissão.");
      }
    } finally {
      setIsEmitting(false);
    }
  };

  // 🚀 FUNÇÃO PARA FORÇAR O NOME DO ARQUIVO PDF
  const handleDownloadPDF = async (url: string, inv: any) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("CORS block");
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      
      // 🚀 Define o nome do ficheiro usando o NÚMERO REAL da Sefaz
      const numeroNota = inv.invoiceNumber || inv.id;
      link.download = `${numeroNota} ${inv.client} R$ ${formatMoney(inv.serviceValue)}.pdf`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      // Fallback de segurança: se a Focus NFe bloquear o fetch via CORS, abre o link original noutra aba
      window.open(url, '_blank');
    }
  };

  // 🚀 MOTOR GERENCIAL: Resumo de Emissões por Mês (Destrincha as NFs por Contrato)
  const monthSummary = useMemo(() => {
      if (filterMonth === 'todos') return null;
      
      const summary = {
          totalEmitted: 0,
          clients: {} as Record<string, { total: number, contracts: Record<string, number> }>
      };

      // 1. Vasculha todos os contratos para encontrar pagamentos faturados
      loans.forEach(loan => {
          if (!loan.history) return;
          const safeClientName = normalizeString(loan.client).replace(/[^a-z0-9]/g, '');

          loan.history.forEach((record: any) => {
              const type = record.type?.toLowerCase() || '';
              if (type.includes('abertura') || type.includes('empréstimo') || type.includes('acordo') || parseVal(record.amount) <= 0) return;
              if (record.nfeStatus === 'IGNORADA') return;

              const jurosRecebido = record.nfeValue !== undefined ? parseVal(record.nfeValue) : parseVal(record.interestPaid);
              if (jurosRecebido <= 0) return;

              let isEmittedInFilteredMonth = false;

              // Verifica se foi baixa manual no mês filtrado
              if (record.nfeStatus === 'EMITIDA_MANUAL') {
                  const recordMonth = record.date.substring(0, 7);
                  if (recordMonth === filterMonth) isEmittedInFilteredMonth = true;
              } else {
                  // Verifica se pertence a um Pacote (NFG) que foi Autorizado pela Sefaz no mês filtrado
                  const dateStr = record.date.split('T')[0];
                  const groupId = `NFG-${safeClientName}-${dateStr.replace(/-/g, '')}`;
                  const groupInvoices = invoices.filter(inv => inv.id === groupId || inv.id?.startsWith(`${groupId}-R`));
                  
                  const authorizedInv = groupInvoices.find(inv => inv.status === 'AUTORIZADA');
                  if (authorizedInv && authorizedInv.issueDate) {
                      const issueMonth = new Date(authorizedInv.issueDate).toISOString().substring(0, 7);
                      if (issueMonth === filterMonth) isEmittedInFilteredMonth = true;
                  }
              }

              if (isEmittedInFilteredMonth) {
                  summary.totalEmitted += jurosRecebido;
                  
                  if (!summary.clients[loan.client]) summary.clients[loan.client] = { total: 0, contracts: {} };
                  
                  summary.clients[loan.client].total += jurosRecebido;
                  
                  if (!summary.clients[loan.client].contracts[loan.id]) summary.clients[loan.client].contracts[loan.id] = 0;
                  summary.clients[loan.client].contracts[loan.id] += jurosRecebido;
              }
          });
      });

      // 2. Inclui Notas Avulsas (Fora de Contratos)
      invoices.forEach(inv => {
          if (inv.status === 'AUTORIZADA' && inv.id?.startsWith('NF-AVULSA')) {
              if (inv.issueDate) {
                  const issueMonth = new Date(inv.issueDate).toISOString().substring(0, 7);
                  if (issueMonth === filterMonth) {
                      const val = parseVal(inv.serviceValue);
                      summary.totalEmitted += val;
                      
                      const clientName = inv.client || 'Cliente Desconhecido';
                      if (!summary.clients[clientName]) summary.clients[clientName] = { total: 0, contracts: {} };
                      
                      summary.clients[clientName].total += val;
                      if (!summary.clients[clientName].contracts['Avulsa / Extra']) summary.clients[clientName].contracts['Avulsa / Extra'] = 0;
                      summary.clients[clientName].contracts['Avulsa / Extra'] += val;
                  }
              }
          }
      });

      const sortedClients = Object.entries(summary.clients)
          .map(([name, data]) => ({ name, ...data }))
          .sort((a, b) => b.total - a.total); // Ordena quem gerou mais nota primeiro

      return { totalEmitted: summary.totalEmitted, clients: sortedClients };
  }, [loans, invoices, filterMonth]);

  return (
    <Layout>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Receipt className="text-blue-600" /> Notas Fiscais (NFS-e)
          </h2>
          <p className="text-slate-500">Emissão e controle de notas fiscais de serviço sobre juros.</p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-2 bg-white border border-gray-200 text-slate-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors shadow-sm font-bold">
          <RefreshCw className={isLoading ? "animate-spin" : ""} size={18} /> Atualizar
        </button>
      </header>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-8">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex bg-slate-200/50 p-1 rounded-lg w-full md:w-auto overflow-x-auto custom-scrollbar">
            <button 
                onClick={() => setActiveTab('pendentes')} 
                className={`flex-1 md:flex-none px-6 py-2 text-sm font-bold rounded-md transition-all whitespace-nowrap ${activeTab === 'pendentes' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                Pagamentos s/ Nota
            </button>
            <button 
                onClick={() => setActiveTab('historico')} 
                className={`flex-1 md:flex-none px-6 py-2 text-sm font-bold rounded-md transition-all whitespace-nowrap ${activeTab === 'historico' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                Histórico de Emissões
            </button>
            <button 
                onClick={() => setActiveTab('avulsa')} 
                className={`flex-1 md:flex-none px-6 py-2 text-sm font-bold rounded-md transition-all whitespace-nowrap ${activeTab === 'avulsa' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                Emissão Avulsa / Parcial
            </button>
          </div>

          {activeTab !== 'avulsa' && (
            <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
              {activeTab === 'historico' && (
                <select 
                  value={filterMonth} 
                  onChange={(e) => setFilterMonth(e.target.value)} 
                  className="w-full md:w-48 appearance-none bg-white px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm cursor-pointer"
                >
                  <option value="todos">Todos os Meses</option>
                  {availableMonths.map(m => {
                      const [ano, mes] = m.split('-');
                      return <option key={m} value={m}>{`${mes}/${ano}`}</option>;
                  })}
                </select>
              )}
              <div className="relative w-full md:w-96">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="text" 
                  placeholder="Buscar cliente ou contrato..." 
                  value={searchTerm} 
                  onChange={(e) => setSearchTerm(e.target.value)} 
                  className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-bold text-slate-700" 
                />
              </div>
            </div>
          )}
        </div>

        {/* ABA: PAGAMENTOS PENDENTES DE NOTA */}
        {activeTab === 'pendentes' && (
          <div className="overflow-x-auto min-h-[400px]">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                  <th className="p-4">Data da Baixa</th>
                  <th className="p-4">Cliente / Contrato</th>
                  <th className="p-4 text-right">Valor Total Pago</th>
                  <th className="p-4 text-right text-blue-600 bg-blue-50/30">Juros (Base da NF)</th>
                  <th className="p-4 text-center">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {availablePayments.length === 0 ? (
                  <tr><td colSpan={5} className="p-8 text-center text-slate-400 italic">Nenhum pagamento com juros encontrado para emitir nota.</td></tr>
                ) : (
                  availablePayments.map((payment) => (
                    <React.Fragment key={payment.uniqueId}>
                        <tr className="hover:bg-slate-50 transition-colors group">
                          <td className="p-4 align-top pt-5">
                            <div className="font-bold text-slate-700 flex items-center gap-2">
                              <Calendar size={14} className="text-slate-400"/>
                              {new Date(payment.paymentDate).toLocaleDateString('pt-BR')}
                            </div>
                          </td>
                          <td className="p-4 align-top pt-5">
                            <div className="font-bold text-slate-800">{payment.client}</div>
                            {getNickname(clients.find(c => c.name === payment.client)?.observations) && (
                                <div className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full inline-block mt-0.5 mb-1 w-fit truncate max-w-[200px]" title={getNickname(clients.find(c => c.name === payment.client)?.observations)}>
                                    {getNickname(clients.find(c => c.name === payment.client)?.observations)}
                                </div>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                                <div className="text-[10px] text-slate-500 font-mono">
                                    {payment.underlyingRecords.length > 1 ? `${payment.underlyingRecords.length} Contratos Agrupados` : `Contrato: ${payment.contractId}`}
                                </div>
                                {payment.underlyingRecords.length > 1 && (
                                    <button 
                                        onClick={() => setExpandedGroup(expandedGroup === payment.uniqueId ? null : payment.uniqueId)}
                                        className="text-[9px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors border border-slate-200"
                                    >
                                        {expandedGroup === payment.uniqueId ? 'Ocultar Detalhes' : 'Ver Detalhes'}
                                    </button>
                                )}
                            </div>
                          </td>
                          <td className="p-4 text-right font-bold text-slate-600 align-top pt-5">
                            R$ {formatMoney(payment.totalPaid)}
                            <div className="text-[9px] text-slate-400 font-normal mt-0.5">(Capital: R$ {formatMoney(payment.capitalPaid)})</div>
                          </td>
                          <td className="p-4 text-right font-black text-blue-700 bg-blue-50/10 align-top pt-5">
                            R$ {formatMoney(payment.interestPaid)}
                          </td>
                          <td className="p-4 align-top pt-4">
                            <div className="flex items-center justify-end gap-2">
                                <button onClick={() => handleEditNfeValue(payment)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar Valor da NF">
                                    <Edit size={16}/>
                                </button>
                                <button onClick={() => handleIgnorePayment(payment)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Apagar da fila">
                                    <Trash2 size={16}/>
                                </button>
                                <button onClick={() => handleManualEmission(payment)} className="p-2 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Já emitido">
                                    <CheckCircle size={16}/>
                                </button>
                                <button onClick={() => handleOpenEmitModal(payment)} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-600 transition-colors shadow-sm flex items-center gap-1.5 ml-2">
                                    <Send size={14} /> Emitir
                                </button>
                            </div>
                          </td>
                        </tr>
                        {/* 🚀 LINHA EXPANSÍVEL DA SANFONA COM OS DETALHES */}
                        {expandedGroup === payment.uniqueId && payment.underlyingRecords.length > 1 && (
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <td colSpan={5} className="p-0">
                                    <div className="px-10 py-4 animate-in slide-in-from-top-2 flex justify-center">
                                        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm w-full md:w-2/3 mx-auto">
                                            <h5 className="text-[10px] font-black text-center uppercase text-slate-400 mb-3 border-b border-slate-100 pb-2">Composição do Valor da NF</h5>
                                            <div className="space-y-2">
                                                {payment.underlyingRecords.map((ur: any, idx: number) => {
                                                    const juros = ur.originalRecord.nfeValue !== undefined ? parseVal(ur.originalRecord.nfeValue) : parseVal(ur.originalRecord.interestPaid);
                                                    const cap = parseVal(ur.originalRecord.capitalPaid || 0);
                                                    return (
                                                        <div key={idx} className="flex justify-between items-center text-xs border-b border-slate-50 pb-2 last:border-0 last:pb-0">
                                                            <span className="font-mono text-slate-500 font-bold">CTR: <span className="text-slate-800">{ur.loanId}</span></span>
                                                            <div className="flex gap-6 items-center">
                                                                <span className="text-slate-400 text-[10px] uppercase">Cap: R$ {formatMoney(cap)}</span>
                                                                <span className="font-black text-blue-600 min-w-[90px] text-right">Jur: R$ {formatMoney(juros)}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ABA: HISTÓRICO DE EMISSÕES */}
        {activeTab === 'historico' && (
          <div className="flex flex-col gap-4 min-h-[400px]">
            
            {/* 🚀 RELATÓRIO MENSAL GERENCIAL */}
            {filterMonth !== 'todos' && monthSummary && (
                <div className="p-5 bg-blue-50 border border-blue-200 rounded-2xl animate-in fade-in shadow-inner mx-4 mt-4">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 border-b border-blue-200 pb-3 gap-4">
                        <div className="flex items-center gap-2">
                            <Landmark size={20} className="text-blue-600" />
                            <h3 className="font-black text-blue-900 uppercase tracking-widest text-sm">Resumo de Emissões: {filterMonth.split('-').reverse().join('/')}</h3>
                        </div>
                        <div className="text-left md:text-right">
                            <span className="text-[10px] font-bold text-blue-700 uppercase block mb-0.5">Base de Cálculo Total Emitida no Mês</span>
                            <span className="text-3xl font-black text-blue-900">R$ {formatMoney(monthSummary.totalEmitted)}</span>
                        </div>
                    </div>
                    
                    {monthSummary.clients.length > 0 ? (
                        <div className="bg-white rounded-xl border border-blue-100 overflow-hidden shadow-sm">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-blue-100/50 text-[10px] uppercase tracking-wider text-blue-800 font-bold border-b border-blue-100">
                                    <tr>
                                        <th className="p-3">Cliente / Devedor</th>
                                        <th className="p-3 text-right">Total Faturado no Mês</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {monthSummary.clients.map((c, i) => (
                                        <React.Fragment key={i}>
                                            <tr className="hover:bg-slate-50 transition-colors">
                                                <td className="p-3 font-bold text-slate-800">{c.name}</td>
                                                <td className="p-3 text-right font-black text-blue-600">R$ {formatMoney(c.total)}</td>
                                            </tr>
                                            {Object.entries(c.contracts).length > 0 && (
                                                <tr className="bg-slate-50/50">
                                                    <td colSpan={2} className="p-0">
                                                        <div className="px-4 py-2 border-l-2 border-blue-300 ml-4 my-2">
                                                            <p className="text-[9px] uppercase font-bold text-slate-400 mb-1.5 flex items-center gap-1"><FileText size={10}/> Detalhamento por Contrato</p>
                                                            <div className="space-y-1">
                                                                {Object.entries(c.contracts).map(([contractId, val]) => (
                                                                    <div key={contractId} className="flex justify-between items-center text-xs">
                                                                        <span className="text-slate-500 font-mono font-medium">CTR: {contractId}</span>
                                                                        <span className="font-bold text-slate-600">R$ {formatMoney(val as number)}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="text-sm text-blue-600 font-medium italic text-center py-2">Nenhuma nota emitida ou autorizada neste mês.</p>
                    )}
                </div>
            )}

            <div className="overflow-x-auto w-full">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                    <th className="p-4">Nº Solicitação</th>
                    <th className="p-4">Data / Hora</th>
                    <th className="p-4">Cliente / CPF</th>
                    <th className="p-4 text-right">Valor do Serviço</th>
                    <th className="p-4 text-center">Status Sefaz</th>
                    <th className="p-4 text-center">Documento</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredInvoices.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-slate-400 italic">Nenhuma nota fiscal encontrada no histórico.</td></tr>
                  ) : (
                    filteredInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 font-mono font-bold text-slate-700">
                            {inv.invoiceNumber ? (
                                <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded-md text-xs">NFS-e {inv.invoiceNumber}</span>
                            ) : (
                                inv.id
                            )}
                        </td>
                        <td className="p-4 text-sm font-medium text-slate-600">
                          {inv.issueDate ? new Date(inv.issueDate).toLocaleDateString('pt-BR') : '-'} 
                          {inv.issueDate && <span className="text-slate-400 text-xs ml-1">{new Date(inv.issueDate).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</span>}
                        </td>
                        <td className="p-4">
                          <div className="font-bold text-slate-800">{inv.client}</div>
                          {getNickname(clients.find(c => c.name === inv.client)?.observations) && (
                              <div className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full inline-block mt-0.5 mb-1 w-fit truncate max-w-[200px]" title={getNickname(clients.find(c => c.name === inv.client)?.observations)}>
                                  {getNickname(clients.find(c => c.name === inv.client)?.observations)}
                              </div>
                          )}
                          <div className="text-[10px] text-slate-500">{inv.cpf}</div>
                        </td>
                        <td className="p-4 text-right font-black text-slate-800">R$ {formatMoney(inv.serviceValue)}</td>
                        <td className="p-4 text-center">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase flex items-center justify-center gap-1 w-fit mx-auto ${
                            inv.status === 'AUTORIZADA' ? 'bg-green-100 text-green-700 border border-green-200' :
                            inv.status === 'EMITIDA_MANUAL' ? 'bg-purple-100 text-purple-700 border border-purple-200' :
                            inv.status === 'ERRO' ? 'bg-red-100 text-red-700 border border-red-200' :
                            String(inv.status) === 'CANCELADA' ? 'bg-slate-100 text-slate-500 border border-slate-300' :
                            'bg-yellow-100 text-yellow-700 border border-yellow-200'
                          }`}>
                            {inv.status === 'AUTORIZADA' || inv.status === 'EMITIDA_MANUAL' ? <CheckCircle size={12}/> : inv.status === 'ERRO' ? <AlertCircle size={12}/> : String(inv.status) === 'CANCELADA' ? <Trash2 size={12}/> : <Clock size={12}/>}
                            {inv.status === 'EMITIDA_MANUAL' ? 'Manual / Por fora' : inv.status}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center justify-between min-w-[160px] gap-2">
                            <div className="flex-1 flex justify-center">
                              {inv.status === 'AUTORIZADA' && inv.pdfUrl ? (
                                <button onClick={() => handleDownloadPDF(inv.pdfUrl!, inv)} className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs font-bold bg-blue-50 px-3 py-1.5 rounded-lg transition-colors border border-transparent hover:border-blue-200 w-fit">
                                  <Download size={14}/> Baixar PDF
                                </button>
                              ) : inv.status === 'EMITIDA_MANUAL' ? (
                                <span className="text-[10px] text-purple-500 font-bold max-w-[150px] inline-block leading-tight truncate">Resolvido Manualmente</span>
                              ) : inv.status === 'ERRO' ? (
                                <span className="text-[10px] text-red-500 font-bold cursor-help max-w-[150px] inline-block leading-tight truncate" title={inv.errorMsg || 'Erro desconhecido'}>{inv.errorMsg || 'Ver Erro'}</span>
                              ) : String(inv.status) === 'CANCELADA' ? (
                                <span className="text-[10px] text-amber-700 font-black bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200 uppercase tracking-wider">
                                  Sem efeito fiscal
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400 font-bold flex items-center justify-center gap-1"><RefreshCw size={10} className="animate-spin"/> Aguardando...</span>
                              )}
                            </div>
                            {inv.status !== 'EMITIDA_MANUAL' && String(inv.status) !== 'CANCELADA' && (
                              <button 
                                onClick={() => handleDeleteInvoice(inv.id!)}
                                className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-md transition-colors shrink-0"
                                title="Cancelar Nota Fiscal"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 🚀 ABA: EMISSÃO AVULSA / PARCIAL */}
        {activeTab === 'avulsa' && (
          <div className="p-8 min-h-[400px] bg-slate-50/30">
              <div className="max-w-2xl mx-auto space-y-6">
                  <div className="bg-blue-50 border border-blue-200 p-5 rounded-2xl flex gap-4 items-start">
                      <div className="bg-blue-100 p-2 rounded-xl text-blue-600 shrink-0"><AlertCircle size={24}/></div>
                      <div>
                          <h4 className="font-black text-blue-900 text-sm mb-1">Emissão Livre de Nota Fiscal</h4>
                          <p className="text-xs text-blue-700 leading-relaxed">
                              Esta área permite emitir uma nota fiscal avulsa para um cliente selecionado com um valor 100% livre (Ex: pagamentos parciais, renegociações fora da plataforma). <br/>A nota ficará guardada no <b>Histórico de Emissões</b> normalmente.
                          </p>
                      </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
                      
                      {/* BUSCA DE CLIENTE */}
                      <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">1. Localize o Cliente</label>
                          <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                              <input 
                                  type="text" 
                                  placeholder="Digite o nome ou CPF..." 
                                  value={avulsaSearch}
                                  onChange={e => {
                                      setAvulsaSearch(e.target.value);
                                      setAvulsaSelectedClient(null); // Reseta a seleção se ele voltar a digitar
                                  }}
                                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-300 outline-none focus:ring-2 focus:ring-blue-500/20 font-bold text-slate-800 transition-all"
                              />
                          </div>
                          
                          {/* Datalist Visual de Resultados */}
                          {avulsaSearch && !avulsaSelectedClient && (
                              <div className="mt-2 border border-slate-200 rounded-xl overflow-hidden shadow-lg max-h-48 overflow-y-auto bg-white absolute w-full max-w-2xl z-10">
                                  {clients.filter(c => normalizeString(c.name).includes(normalizeString(avulsaSearch)) || c.cpf.includes(avulsaSearch)).length === 0 ? (
                                      <div className="p-4 text-center text-sm text-slate-400 italic">Cliente não encontrado.</div>
                                  ) : (
                                      clients.filter(c => normalizeString(c.name).includes(normalizeString(avulsaSearch)) || c.cpf.includes(avulsaSearch)).map(c => (
                                          <div 
                                              key={c.id} 
                                              onClick={() => {
                                                  setAvulsaSelectedClient(c);
                                                  setAvulsaSearch(c.name);
                                              }}
                                              className="p-3 border-b border-slate-50 hover:bg-blue-50 cursor-pointer flex justify-between items-center transition-colors"
                                          >
                                              <span className="font-bold text-slate-700 text-sm">{c.name}</span>
                                              <span className="text-xs text-slate-400 font-mono">{c.cpf}</span>
                                          </div>
                                      ))
                                  )}
                              </div>
                          )}
                      </div>

                      {/* DADOS DO CLIENTE SELECIONADO E VALOR LIVRE */}
                      {avulsaSelectedClient && (
                          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-6">
                              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex justify-between items-center">
                                  <div>
                                      <span className="block text-[10px] uppercase font-bold text-slate-400 mb-0.5">Cliente Selecionado</span>
                                      <span className="font-black text-slate-800">{avulsaSelectedClient.name}</span>
                                  </div>
                                  <div className="text-right">
                                      <span className="block text-[10px] uppercase font-bold text-slate-400 mb-0.5">CPF / CNPJ</span>
                                      <span className="font-bold text-slate-600 font-mono text-sm">{avulsaSelectedClient.cpf}</span>
                                  </div>
                              </div>

                              <div>
                                  <label className="block text-xs font-bold text-blue-600 uppercase mb-2">2. Valor a Emitir na Nota (R$)</label>
                                  <input 
                                      type="number" 
                                      step="0.01"
                                      onWheel={(e) => e.currentTarget.blur()}
                                      value={avulsaValue}
                                      onChange={(e) => setAvulsaValue(e.target.value)}
                                      placeholder="Ex: 85.50"
                                      className="w-full px-4 py-4 rounded-xl border-2 border-blue-200 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 font-black text-2xl text-blue-900 transition-all bg-white"
                                  />
                              </div>

                              <button 
                                  onClick={() => {
                                      if (Number(avulsaValue) <= 0) {
                                          alert("O valor da nota deve ser maior que zero.");
                                          return;
                                      }
                                      
                                      // Monta um "Fake Payment" para passar no modal existente (com TS Safe)
                                      const fakePayment = {
                                          uniqueId: `NF-AVULSA-${Date.now()}`,
                                          client: avulsaSelectedClient?.name || '',
                                          cpf: avulsaSelectedClient?.cpf || '',
                                          interestPaid: Number(avulsaValue),
                                          capitalPaid: 0,
                                          invoiceStatus: null
                                      };
                                      
                                      handleOpenEmitModal(fakePayment);
                                  }}
                                  disabled={!avulsaValue || Number(avulsaValue) <= 0}
                                  className="w-full py-4 bg-slate-900 text-white font-bold rounded-xl hover:bg-blue-600 transition-colors shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                  <FileText size={18}/> Processar Emissão Avulsa
                              </button>
                          </div>
                      )}
                  </div>
              </div>
          </div>
        )}
      </div>

      {/* MODAL DE EDIÇÃO DE VALOR */}
      <Modal isOpen={isEditModalOpen} onClose={() => !isEditing && setIsEditModalOpen(false)} title="Editar Valor da Nota">
        {paymentToEdit && (
          <div className="space-y-4">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <p className="text-sm text-slate-600 mb-1">Cliente: <span className="font-bold text-slate-800">{paymentToEdit.client}</span></p>
              <p className="text-sm text-slate-600">Valor atual (Juros): <span className="font-bold text-slate-800">R$ {formatMoney(paymentToEdit.interestPaid)}</span></p>
            </div>
            
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Novo valor (R$)</label>
              <input 
                type="text" 
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500/20 outline-none font-bold text-slate-800"
                placeholder="Ex: 150,00"
                disabled={isEditing}
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button 
                onClick={() => setIsEditModalOpen(false)} 
                disabled={isEditing}
                className="px-6 py-2 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmEditNfeValue} 
                disabled={isEditing}
                className="px-6 py-2 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all flex items-center gap-2 shadow-sm disabled:opacity-70"
              >
                {isEditing ? <RefreshCw size={18} className="animate-spin"/> : <Edit size={18}/>}
                Confirmar Envio
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* MODAL DE CONFIRMAÇÃO DE EMISSÃO */}
      <Modal isOpen={isEmitModalOpen} onClose={() => !isEmitting && setIsEmitModalOpen(false)} title="Confirmar Emissão de NF">
        {selectedPayment && (
          <div className="space-y-6">
            <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100 shadow-inner">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-blue-600 p-2 rounded-lg text-white"><Landmark size={20} /></div>
                <div>
                  <h3 className="font-bold text-blue-900 leading-tight">Prefeitura de Mauá (Ginfes)</h3>
                  <p className="text-[10px] text-blue-700 uppercase">Ambiente de Emissão / SEFAZ</p>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center text-sm border-b border-blue-200/50 pb-2">
                  <span className="text-blue-800 font-medium">Tomador do Serviço (Cliente):</span>
                  <span className="font-bold text-slate-800">{selectedPayment.client}</span>
                </div>
                <div className="flex justify-between items-center text-sm border-b border-blue-200/50 pb-2">
                  <span className="text-blue-800 font-medium">CPF / CNPJ:</span>
                  <span className="font-bold text-slate-800">{selectedPayment.cpf}</span>
                </div>
                <div className="flex justify-between items-center text-sm pt-2">
                  <span className="text-blue-800 font-bold uppercase">Base de Cálculo (Juros):</span>
                  <span className="text-2xl font-black text-blue-900">R$ {formatMoney(selectedPayment.interestPaid)}</span>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 flex items-start gap-3">
              <AlertCircle className="text-amber-600 shrink-0 mt-0.5" size={18}/>
              <p className="text-xs text-amber-800 font-medium leading-relaxed">
                A nota será emitida <b>apenas sobre o valor do Lucro/Juros (R$ {formatMoney(selectedPayment.interestPaid)})</b>, conforme regra tributária para operações de crédito. O capital amortizado (R$ {formatMoney(selectedPayment.capitalPaid)}) não compõe a base de cálculo.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button 
                onClick={() => setIsEmitModalOpen(false)} 
                disabled={isEmitting}
                className="px-6 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmEmission} 
                disabled={isEmitting}
                className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-900/20 disabled:opacity-70"
              >
                {isEmitting ? (
                  <><RefreshCw size={18} className="animate-spin"/> Transmitindo...</>
                ) : (
                  <><FileText size={18}/> Transmitir Nota Fiscal</>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
};

export default Invoices;