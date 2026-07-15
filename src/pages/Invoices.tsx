import { useState, useEffect, useMemo } from 'react';
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

  // 🚀 Lógica Inteligente: Extrai pagamentos de juros NÃO EMITIDOS
  const availablePayments = useMemo(() => {
    const paymentsList: any[] = [];
    
    // Lista negra para não faturar clientes bloqueados
    const blockedNames = new Set(clients.filter(c => c.status === 'Bloqueado').map(c => c.name));

    loans.forEach(loan => {
      if (!loan.history || blockedNames.has(loan.client)) return;
      
      // 🚀 BUSCA BLINDADA CONTRA ACENTOS, MAIÚSCULAS E ESPAÇOS EXTRAS
      const clientInfo = clients.find(c => normalizeString(c.name) === normalizeString(loan.client));

      loan.history.forEach((record: any, index) => {
        const type = record.type?.toLowerCase() || '';
        
        // Ignora aberturas, acordos e pagamentos zerados
        if (type.includes('abertura') || type.includes('empréstimo') || type.includes('acordo') || parseVal(record.amount) <= 0) return;
        
        // 🚀 FIX: Se foi ignorada ou emitida por fora, não entra na fila de pendentes!
        if (record.nfeStatus === 'IGNORADA' || record.nfeStatus === 'EMITIDA_MANUAL') return;

        // 🚀 FIX: Usa o valor editado da NFE se existir, senão usa o juro recebido original
        const jurosRecebido = record.nfeValue !== undefined ? parseVal(record.nfeValue) : parseVal(record.interestPaid);
        
        // 🚀 HIGIENIZAÇÃO DO ID: Transforma "001/2026" em "NF0012026"
        const safeLoanId = loan.id.replace(/[^a-zA-Z0-9]/g, '');
        const uniquePaymentId = `NF${safeLoanId}-${index}`;
        
        // 🚀 VERIFICAÇÃO BLINDADA: Puxa todas as notas (incluindo reemissões com sufixo -R)
        const paymentInvoices = invoices.filter(inv => inv.id === uniquePaymentId || inv.id?.startsWith(`${uniquePaymentId}-R`));
        
        // Pega a nota mais recente ativa ou a última cancelada
        let relatedInvoice = paymentInvoices.find(inv => String(inv.status) !== 'CANCELADA');
        if (!relatedInvoice && paymentInvoices.length > 0) {
            relatedInvoice = paymentInvoices[paymentInvoices.length - 1]; 
        }

        // Se a nota final ligada a este pagamento foi AUTORIZADA, removemos da lista pendente!
        if (relatedInvoice && relatedInvoice.status === 'AUTORIZADA') return;

        if (jurosRecebido > 0) {
          paymentsList.push({
            uniqueId: uniquePaymentId,
            contractId: loan.id,
            recordIndex: index, // Guarda o índice para sabermos qual pagamento editar no banco
            client: loan.client,
            cpf: clientInfo?.cpf || 'Não cadastrado',
            paymentDate: record.date,
            totalPaid: record.amount,
            capitalPaid: record.capitalPaid || 0,
            interestPaid: jurosRecebido,
            note: record.note,
            invoiceStatus: relatedInvoice?.status || null // Passa o status para a tela
          });
        }
      });
    });

    return paymentsList
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

  // 🚀 Filtro do Histórico
  const filteredInvoices = useMemo(() => {
    return allHistoricalInvoices.filter(inv => 
      inv.client?.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (inv.id && inv.id.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [allHistoricalInvoices, searchTerm]);

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

      const loan = loans.find(l => l.id === paymentToEdit.contractId);
      if (!loan || !loan.history) {
          setIsEditing(false);
          return;
      }

      const updatedLoan = { ...loan };
      updatedLoan.history![paymentToEdit.recordIndex] = { 
          ...updatedLoan.history![paymentToEdit.recordIndex], 
          nfeValue: newVal 
      } as any;

      try {
          await loanService.update(loan.id, updatedLoan, 'EDIÇÃO DE VALOR NF', `Valor da base de cálculo da NF alterado para R$ ${newVal.toFixed(2)}`);
          await fetchData();
          setIsEditModalOpen(false);
          // Opcional: Se quiser que já abra o modal de emissão logo após confirmar, descomente a linha abaixo:
          // handleOpenEmitModal({...paymentToEdit, interestPaid: newVal});
      } catch (e) { 
          alert("Erro ao atualizar valor."); 
      } finally {
          setIsEditing(false);
      }
  };

  const handleIgnorePayment = async (payment: any) => {
      if (!window.confirm(`⚠️ Deseja realmente REMOVER este pagamento da fila de emissão?\n\nEle desaparecerá desta lista e não será enviado para a Sefaz.`)) return;

      const loan = loans.find(l => l.id === payment.contractId);
      if (!loan || !loan.history) return;

      const updatedLoan = { ...loan };
      updatedLoan.history![payment.recordIndex] = { 
          ...updatedLoan.history![payment.recordIndex], 
          nfeStatus: 'IGNORADA' 
      } as any;

      try {
          await loanService.update(loan.id, updatedLoan, 'NF IGNORADA', `Pagamento ignorado na fila de emissão fiscal.`);
          fetchData();
      } catch (e) { alert("Erro ao ignorar pagamento."); }
  };

  const handleManualEmission = async (payment: any) => {
      if (!window.confirm(`✅ Marcar como EMITIDA MANUALMENTE?\n\nIsto moverá o registro para a aba de Histórico, indicando que você já emitiu esta nota por fora ou de outra forma. Não haverá comunicação com a Prefeitura.`)) return;

      const loan = loans.find(l => l.id === payment.contractId);
      if (!loan || !loan.history) return;

      const updatedLoan = { ...loan };
      updatedLoan.history![payment.recordIndex] = { 
          ...updatedLoan.history![payment.recordIndex], 
          nfeStatus: 'EMITIDA_MANUAL' 
      } as any;

      try {
          await loanService.update(loan.id, updatedLoan, 'NF MANUAL', `Pagamento marcado como nota emitida manualmente por fora.`);
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
        serviceValue: selectedPayment.interestPaid
      });
      
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
      // Define o nome do ficheiro conforme pedido
      link.download = `${inv.id} ${inv.client} R$ ${formatMoney(inv.serviceValue)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      // Fallback de segurança: se a Focus NFe bloquear o fetch via CORS, abre o link original noutra aba
      window.open(url, '_blank');
    }
  };

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
                    <tr key={payment.uniqueId} className="hover:bg-slate-50 transition-colors group">
                      <td className="p-4">
                        <div className="font-bold text-slate-700 flex items-center gap-2">
                          <Calendar size={14} className="text-slate-400"/>
                          {new Date(payment.paymentDate).toLocaleDateString('pt-BR')}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5 ml-5">
                          {new Date(payment.paymentDate).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-slate-800">{payment.client}</div>
                        {getNickname(clients.find(c => c.name === payment.client)?.observations) && (
                            <div className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full inline-block mt-0.5 mb-1 w-fit truncate max-w-[200px]" title={getNickname(clients.find(c => c.name === payment.client)?.observations)}>
                                {getNickname(clients.find(c => c.name === payment.client)?.observations)}
                            </div>
                        )}
                        <div className="text-[10px] text-slate-500 font-mono">Contrato: {payment.contractId}</div>
                      </td>
                      <td className="p-4 text-right font-bold text-slate-600">
                        R$ {formatMoney(payment.totalPaid)}
                        <div className="text-[9px] text-slate-400 font-normal mt-0.5">(Capital: R$ {formatMoney(payment.capitalPaid)})</div>
                      </td>
                      <td className="p-4 text-right font-black text-blue-700 bg-blue-50/10">
                        R$ {formatMoney(payment.interestPaid)}
                      </td>
                      <td className="p-4">
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ABA: HISTÓRICO DE EMISSÕES */}
        {activeTab === 'historico' && (
          <div className="overflow-x-auto min-h-[400px]">
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
                      <td className="p-4 font-mono font-bold text-slate-700">{inv.id}</td>
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