import { useState, useEffect, useMemo } from 'react';
import { 
  Search, Receipt, FileText, CheckCircle, AlertCircle, 
  Clock, Download, RefreshCw, Send, Landmark, Calendar
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
  const [activeTab, setActiveTab] = useState<'pendentes' | 'historico'>('pendentes');

  // 🚀 EXTRAÇÃO DE APELIDO: Limpa o JSON e mostra apenas a observação
  const getNickname = (obs?: string) => {
      if (!obs) return '';
      let clean = obs.split('[META:')[0].trim();
      return clean.replace(/\}\]$/, '').trim();
  };

  // Estado Modal de Emissão
  const [isEmitModalOpen, setIsEmitModalOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [isEmitting, setIsEmitting] = useState(false);

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
      
      const clientInfo = clients.find(c => c.name === loan.client);

      loan.history.forEach((record, index) => {
        const type = record.type?.toLowerCase() || '';
        // 🚀 FIX: Ignora Abertura, Acordo e pagamentos zerados
        if (type.includes('abertura') || type.includes('empréstimo') || type.includes('acordo') || parseVal(record.amount) <= 0) return;
        
        const jurosRecebido = parseVal(record.interestPaid);
        const uniquePaymentId = `${loan.id}-${index}`;
        
        // 🚀 FIX CRÍTICO: Agora a trava verifica o uniquePaymentId exato. 
        // Não esconde o contrato todo, só a parcela faturada.
        const isAlreadyInvoiced = invoices.some(inv => inv.id === uniquePaymentId);

        // Só exibe se houver lucro e se não foi faturado
        if (jurosRecebido > 0 && !isAlreadyInvoiced) {
          paymentsList.push({
            uniqueId: uniquePaymentId,
            contractId: loan.id,
            client: loan.client,
            cpf: clientInfo?.cpf || 'Não cadastrado',
            paymentDate: record.date,
            totalPaid: record.amount,
            capitalPaid: record.capitalPaid || 0,
            interestPaid: jurosRecebido,
            note: record.note
          });
        }
      });
    });

    // Ordena do mais recente para o mais antigo e aplica a busca
    return paymentsList
      .filter(p => p.client.toLowerCase().includes(searchTerm.toLowerCase()) || p.contractId.includes(searchTerm))
      .sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());
  }, [loans, clients, searchTerm, invoices]);

  // 🚀 Filtro do Histórico Real
  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => 
      inv.client?.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (inv.id && inv.id.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [invoices, searchTerm]);

  const handleOpenEmitModal = (payment: any) => {
    setSelectedPayment(payment);
    setIsEmitModalOpen(true);
  };

  const confirmEmission = async () => {
    setIsEmitting(true);
    try {
      // 🚀 Chamada Real para o Backend em Go (agora enviando a Chave Única de Pagamento)
      await invoiceService.emit({
        id: selectedPayment.uniqueId, // O Go deve salvar esse ID para travar a emissão dupla
        client: selectedPayment.client,
        cpf: selectedPayment.cpf,
        serviceValue: selectedPayment.interestPaid
      });
      
      // Atualiza a lista para a nota aparecer como "PROCESSANDO" imediatamente
      const updatedInvoices = await invoiceService.getAll();
      setInvoices(updatedInvoices || []);
      
      setIsEmitModalOpen(false);
      setActiveTab('historico');
    } catch (error: any) {
      // 🚀 FIX: Mostra o erro real devolvido pelo Go (Ex: Trava de Duplicidade)
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
          <div className="flex bg-slate-200/50 p-1 rounded-lg w-full md:w-auto">
            <button 
                onClick={() => setActiveTab('pendentes')} 
                className={`flex-1 md:flex-none px-6 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'pendentes' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                Pagamentos s/ Nota
            </button>
            <button 
                onClick={() => setActiveTab('historico')} 
                className={`flex-1 md:flex-none px-6 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'historico' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                Histórico de Emissões
            </button>
          </div>

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
                      <td className="p-4 text-center">
                        <button 
                          onClick={() => handleOpenEmitModal(payment)}
                          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-600 transition-colors shadow-sm flex items-center gap-2 mx-auto"
                        >
                          <Send size={14} /> Emitir NF
                        </button>
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
                          inv.status === 'ERRO' ? 'bg-red-100 text-red-700 border border-red-200' :
                          'bg-yellow-100 text-yellow-700 border border-yellow-200'
                        }`}>
                          {inv.status === 'AUTORIZADA' ? <CheckCircle size={12}/> : inv.status === 'ERRO' ? <AlertCircle size={12}/> : <Clock size={12}/>}
                          {inv.status}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        {inv.status === 'AUTORIZADA' && inv.pdfUrl ? (
                          <a href={inv.pdfUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 flex items-center gap-1 mx-auto text-xs font-bold bg-blue-50 px-3 py-1.5 rounded-lg transition-colors border border-transparent hover:border-blue-200 w-fit">
                            <Download size={14}/> Baixar PDF
                          </a>
                        ) : inv.status === 'ERRO' ? (
                          <span className="text-[10px] text-red-500 font-bold cursor-help max-w-[150px] inline-block leading-tight truncate" title={inv.errorMsg || 'Erro desconhecido'}>{inv.errorMsg || 'Ver Erro'}</span>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-bold flex items-center justify-center gap-1"><RefreshCw size={10} className="animate-spin"/> Aguardando...</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL DE CONFIRMAÇÃO DE EMISSÃO */}
      <Modal isOpen={isEmitModalOpen} onClose={() => !isEmitting && setIsEmitModalOpen(false)} title="Confirmar Emissão de NF">
        {selectedPayment && (
          <div className="space-y-6">
            <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100 shadow-inner">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-blue-600 p-2 rounded-lg text-white"><Landmark size={20} /></div>
                <div>
                  <h3 className="font-bold text-blue-900 leading-tight">Prefeitura / SEFAZ</h3>
                  <p className="text-[10px] text-blue-700 uppercase">Ambiente de Produção</p>
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