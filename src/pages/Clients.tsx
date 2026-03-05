import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, Plus, MoreVertical, Edit2, Trash2, Eye, 
  MapPin, Phone, Mail, User, ShieldCheck, AlertCircle, RefreshCw, FileText, Upload, Loader2,
  DollarSign, CheckCircle, XCircle, Clock, TrendingUp, TrendingDown, Users, Calendar, Activity, List
} from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { clientService, loanService, Client, ClientDoc, Loan } from '../services/api';
import { formatMoney } from '../utils/finance';

const Clients = () => {
  const navigate = useNavigate();

  // --- Estados Principais ---
  const [clients, setClients] = useState<Client[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]); 
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // --- Estados dos Modais ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [modalTab, setModalTab] = useState<'dados' | 'financeiro'>('dados');
  
  // NOVO: Estado para controlar qual métrica global foi clicada
  const [globalMetricModal, setGlobalMetricModal] = useState<'base' | 'ativos' | 'emprestado' | 'lucro' | null>(null);

  const [isCepLoading, setIsCepLoading] = useState(false);
  const [formData, setFormData] = useState<Partial<Client>>({
    name: '', cpf: '', rg: '', email: '', phone: '',
    cep: '', address: '', number: '', neighborhood: '', city: '', state: '',
    observations: '', documents: [], status: 'Ativo'
  });

  const [openMenuId, setOpenMenuId] = useState<string | number | null>(null);

  // --- NAVEGAÇÃO RÁPIDA ---
  const handleGoToContract = (contractId: string) => {
      sessionStorage.setItem('searchClient', contractId);
      navigate('/billing');
  };

  // --- MÁSCARAS ---
  const maskCPF = (value: string) => value.replace(/\D/g, "").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})/, "$1-$2").replace(/(-\d{2})\d+?$/, "$1");
  const maskRG = (value: string) => value.replace(/\D/g, "").replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})/, "$1-$2").slice(0, 12);
  const maskPhone = (value: string) => value.replace(/\D/g, "").replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2").replace(/(-\d{4})\d+?$/, "$1");
  const maskCEP = (value: string) => value.replace(/\D/g, "").replace(/^(\d{5})(\d)/, "$1-$2").slice(0, 9);

  // --- BUSCA CEP ---
  const handleCepBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const cep = e.target.value.replace(/\D/g, '');
    if (cep.length === 8) {
      setIsCepLoading(true);
      try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await response.json();
        if (!data.erro) {
          setFormData(prev => ({
            ...prev,
            address: data.logradouro,
            neighborhood: data.bairro,
            city: data.localidade,
            state: data.uf
          }));
        } else { alert("CEP não encontrado."); }
      } catch (error) { console.error(error); } 
      finally { setIsCepLoading(false); }
    }
  };

  // --- DATA FETCHING ---
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [clientsData, loansData] = await Promise.all([
          clientService.getAll(),
          loanService.getAll()
      ]);
      setClients(clientsData || []);
      setLoans(loansData || []);
    } catch (err) { console.error(err); } 
    finally { setIsLoading(false); }
  };

  useEffect(() => {
    fetchData();
    const handleGlobalClick = () => setOpenMenuId(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  // --- PLACAR GLOBAL ---
  const globalMetrics = React.useMemo(() => {
      let totalLent = 0;
      let totalProfit = 0;
      const activeClientsSet = new Set();
      
      loans.forEach(l => {
          totalLent += Number(l.amount) || 0;
          totalProfit += Number(l.totalPaidInterest) || 0;
          if (l.status !== 'Pago') {
              activeClientsSet.add(l.client);
          }
      });

      return { 
          totalLent, 
          totalProfit, 
          totalClients: clients.length, 
          activeClients: activeClientsSet.size 
      };
  }, [loans, clients]);


  // --- INTELIGÊNCIA DE CLIENTE (LUCRO / PREJUÍZO) ---
  const calculateClientScore = (clientName: string) => {
      const clientLoans = loans.filter(l => l.client === clientName);
      
      let totalEmprestado = 0;
      let totalDevolvido = 0; 
      let lucroReal = 0; 
      let atrasos = 0;

      clientLoans.forEach(l => {
          const capPaid = Number(l.totalPaidCapital) || 0;
          const intPaid = Number(l.totalPaidInterest) || 0;
          const amount = Number(l.amount) || 0;

          totalEmprestado += amount;
          totalDevolvido += (capPaid + intPaid);
          lucroReal += intPaid;

          if (l.status === 'Atrasado') atrasos++;
      });

      const saldoFinal = totalDevolvido - totalEmprestado;

      return { totalEmprestado, totalDevolvido, lucroReal, saldoFinal, atrasos, contratos: clientLoans.length };
  };

  // --- LÓGICA DE DOCUMENTOS ---
  type DocType = 'RG_FRENTE' | 'RG_VERSO' | 'COMPROVANTE_RESIDENCIA';

  const getDoc = (type: DocType) => {
      return formData.documents?.find(d => d.name.startsWith(`[${type}]`));
  };

  const handleSpecificUpload = (e: any, type: DocType) => {
      const file = e.target.files[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              const otherDocs = formData.documents?.filter(d => !d.name.startsWith(`[${type}]`)) || [];
              const newDoc: ClientDoc = { 
                  name: `[${type}] ${file.name}`, 
                  type: file.type, 
                  data: reader.result as string 
              };
              setFormData(prev => ({ ...prev, documents: [...otherDocs, newDoc] }));
          };
          reader.readAsDataURL(file);
      }
  };

  const removeDoc = (type: DocType) => {
      if(confirm("Deseja remover este documento anexo?")) {
          const filtered = formData.documents?.filter(d => !d.name.startsWith(`[${type}]`)) || [];
          setFormData(prev => ({ ...prev, documents: filtered }));
      }
  };

  const UploadSlot = ({ label, type }: { label: string, type: DocType }) => {
      const currentDoc = getDoc(type);
      return (
          <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase">{label}</span>
              {currentDoc ? (
                  <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl transition-all">
                      <div className="flex items-center gap-2 truncate">
                          <div className="bg-green-100 p-1.5 rounded text-green-700"><FileText size={16}/></div>
                          <div className="flex flex-col truncate">
                              <span className="text-xs font-bold text-green-800 truncate max-w-[120px]">
                                  {currentDoc.name.replace(`[${type}] `, '')}
                              </span>
                              <span className="text-[9px] text-green-600">Anexado</span>
                          </div>
                      </div>
                      <button type="button" onClick={() => removeDoc(type)} className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors" title="Remover anexo">
                          <Trash2 size={16}/>
                      </button>
                  </div>
              ) : (
                  <label className="flex flex-col items-center justify-center gap-1 p-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-400 cursor-pointer hover:bg-slate-50 hover:border-slate-400 hover:text-slate-600 transition-all group h-[62px]">
                      <input type="file" className="hidden" onChange={(e) => handleSpecificUpload(e, type)} accept="image/*,application/pdf" />
                      <Upload size={18} className="group-hover:-translate-y-0.5 transition-transform"/>
                      <span className="text-[10px] font-bold">Clique para Anexar</span>
                  </label>
              )}
          </div>
      );
  };

  // --- HANDLERS PRINCIPAIS ---
  const handleOpenModal = (client?: Client, defaultTab: 'dados' | 'financeiro' = 'dados') => {
    setModalTab(defaultTab); 
    if (client) {
      setEditingId(client.id);
      setFormData({ ...client, documents: client.documents || [] });
    } else {
      setEditingId(null);
      setFormData({ 
          name: '', cpf: '', rg: '', email: '', phone: '', 
          cep: '', address: '', number: '', neighborhood: '', city: '', state: '', 
          observations: '', documents: [], status: 'Ativo' 
      });
    }
    setIsModalOpen(true);
    setOpenMenuId(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const payload = { ...formData, documents: formData.documents || [] } as Client;
      if (editingId) {
        await clientService.update(editingId, payload);
        alert('Cliente atualizado com sucesso!');
      } else {
        const newClient = { ...payload, id: Date.now() }; 
        await clientService.create(newClient);
        alert('Cliente cadastrado com sucesso!');
      }
      setIsModalOpen(false);
      fetchData();
    } catch (error: any) { 
        console.error("Erro ao salvar:", error);
        const msg = error.response?.data || error.message || "Erro desconhecido ao salvar.";
        alert("❌ ERRO: " + msg);
    } finally { 
        setIsLoading(false); 
    }
  };

  const handleDelete = async (id: string | number) => {
    if (confirm('Tem certeza que deseja excluir este cliente?')) {
      try { await clientService.delete(id.toString()); fetchData(); } 
      catch (err) { alert('Erro ao excluir cliente.'); }
    }
    setOpenMenuId(null);
  };

  // --- LÓGICA DE DÍVIDA ---
  const getClientDebtStatus = (clientName: string) => {
      const clientLoans = loans.filter(l => l.client === clientName);
      if (clientLoans.length === 0) return { label: 'Sem Histórico', color: 'gray' };

      const hasOverdue = clientLoans.some(l => {
          const today = new Date(); today.setHours(0,0,0,0);
          const due = new Date(l.nextDue); due.setMinutes(due.getMinutes() + due.getTimezoneOffset()); due.setHours(0,0,0,0);
          return l.status !== 'Pago' && due < today;
      });

      if (hasOverdue) return { label: 'Inadimplente', color: 'red' };
      
      const hasActive = clientLoans.some(l => l.status !== 'Pago');
      if (hasActive) return { label: 'Em Dia (Ativo)', color: 'blue' };

      return { label: 'Quitado (Histórico)', color: 'green' };
  };

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.cpf.includes(searchTerm)
  );

  return (
    <Layout>
      <header className="flex justify-between items-center mb-6">
        <div><h2 className="text-2xl font-bold text-slate-800">Gestão de Clientes</h2><p className="text-slate-500">Cadastre e gerencie sua base de clientes.</p></div>
        <div className="flex gap-2">
          <button onClick={fetchData} className="flex items-center gap-2 bg-white border border-gray-200 text-slate-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors shadow-sm"><RefreshCw className={isLoading ? "animate-spin" : ""} size={18} /></button>
          <button onClick={() => handleOpenModal()} className="flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20"><Plus size={20} /> Novo Cliente</button>
        </div>
      </header>

      {/* --- CARDS DE INTELIGÊNCIA GLOBAL CLICÁVEIS --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div onClick={() => setGlobalMetricModal('base')} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 cursor-pointer hover:shadow-md hover:border-slate-300 transition-all group">
              <div className="p-4 bg-slate-50 text-slate-600 rounded-xl group-hover:bg-slate-100 transition-colors"><Users size={28}/></div>
              <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest group-hover:text-slate-600 transition-colors">Base Cadastrada</p>
                  <p className="text-2xl font-black text-slate-800">{globalMetrics.totalClients}</p>
              </div>
          </div>
          <div onClick={() => setGlobalMetricModal('ativos')} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 cursor-pointer hover:shadow-md hover:border-blue-300 transition-all group">
              <div className="p-4 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-100 transition-colors"><Activity size={28}/></div>
              <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest group-hover:text-blue-500 transition-colors">Contratos Ativos</p>
                  <p className="text-2xl font-black text-slate-800">{globalMetrics.activeClients}</p>
              </div>
          </div>
          <div onClick={() => setGlobalMetricModal('emprestado')} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 cursor-pointer hover:shadow-md hover:border-orange-300 transition-all group">
              <div className="p-4 bg-orange-50 text-orange-600 rounded-xl group-hover:bg-orange-100 transition-colors"><DollarSign size={28}/></div>
              <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest group-hover:text-orange-500 transition-colors">Emprestado no Total</p>
                  <p className="text-xl font-black text-slate-800">R$ {formatMoney(globalMetrics.totalLent)}</p>
              </div>
          </div>
          <div onClick={() => setGlobalMetricModal('lucro')} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 cursor-pointer hover:shadow-md hover:border-green-300 transition-all group">
              <div className="p-4 bg-green-50 text-green-600 rounded-xl group-hover:bg-green-100 transition-colors"><TrendingUp size={28}/></div>
              <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest group-hover:text-green-500 transition-colors">Lucro Total Recebido</p>
                  <p className="text-xl font-black text-green-600">R$ {formatMoney(globalMetrics.totalProfit)}</p>
              </div>
          </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-visible" style={{ minHeight: '400px' }}>
        <div className="p-4 border-b border-slate-50 bg-slate-50/30 flex justify-between items-center rounded-t-2xl">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input type="text" placeholder="Buscar por nome, CPF ou email..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-slate-900/5 transition-all"/>
          </div>
        </div>
        <div className="overflow-visible">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                <th className="p-4">Cliente</th><th className="p-4">Contato</th><th className="p-4">Localização</th><th className="p-4 text-center">Situação Financeira</th><th className="p-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredClients.length === 0 ? (<tr><td colSpan={5} className="p-8 text-center text-slate-400">Nenhum cliente encontrado.</td></tr>) : (filteredClients.map(client => {
                  const debtStatus = getClientDebtStatus(client.name);
                  return (
                  <tr key={client.id} className="hover:bg-slate-50/80 transition-colors group cursor-pointer" onClick={() => handleOpenModal(client, 'financeiro')}>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold border border-slate-200 shadow-sm">{client.name.charAt(0).toUpperCase()}</div>
                        <div><div className="font-bold text-slate-800 group-hover:text-blue-600 transition-colors">{client.name}</div><div className="text-xs text-slate-400 flex items-center gap-1"><ShieldCheck size={12} /> {client.cpf}</div></div>
                      </div>
                    </td>
                    <td className="p-4"><div className="text-sm text-slate-600 flex items-center gap-2 mb-1"><Mail size={14} className="text-slate-400" /> {client.email || '-'}</div><div className="text-sm text-slate-600 flex items-center gap-2"><Phone size={14} className="text-slate-400" /> {client.phone}</div></td>
                    <td className="p-4"><div className="flex items-center gap-2 text-sm text-slate-600"><MapPin size={16} className="text-slate-400" /> {client.city || '-'} {client.state ? `- ${client.state}` : ''}</div></td>
                    <td className="p-4 text-center">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase shadow-sm
                            ${debtStatus.color === 'red' ? 'bg-red-50 text-red-700 border border-red-100' : 
                              debtStatus.color === 'blue' ? 'bg-blue-50 text-blue-700 border border-blue-100' : 
                              debtStatus.color === 'green' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-slate-50 text-slate-500 border border-slate-200'}`}>
                            {debtStatus.label}
                        </span>
                    </td>
                    <td className="p-4 text-right relative">
                        <div className="relative inline-block text-left">
                            <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === client.id ? null : client.id); }} className={`p-2 rounded-lg transition-all ${openMenuId === client.id ? 'bg-slate-200 text-slate-900' : 'text-slate-400 hover:text-slate-900 hover:bg-slate-100'}`} title="Opções"><MoreVertical size={18} /></button>
                            
                            {openMenuId === client.id && (
                                <div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-2xl border border-slate-100 z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                                    <div className="py-1">
                                            <button onClick={() => handleOpenModal(client, 'dados')} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                                                <Edit2 size={16} className="text-blue-500" /> Editar Dados
                                            </button>
                                            <button onClick={() => handleOpenModal(client, 'financeiro')} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                                                <DollarSign size={16} className="text-green-600" /> Ficha Financeira
                                            </button>
                                            <div className="border-t border-slate-100 my-1"></div>
                                            <button onClick={(e) => { e.stopPropagation(); handleDelete(client.id); }} className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 size={16} /> Excluir</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </td>
                  </tr>
                )
              }))}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- MODAL DA FICHA DO CLIENTE --- */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? `Cliente: ${formData.name}` : "Novo Cliente"}>
        {/* --- ABAS DO MODAL --- */}
        <div className="flex border-b border-slate-200 mb-6">
            <button onClick={() => setModalTab('dados')} className={`flex-1 pb-3 text-sm font-bold border-b-2 transition-all ${modalTab === 'dados' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>Dados Cadastrais</button>
            {editingId && <button onClick={() => setModalTab('financeiro')} className={`flex-1 pb-3 text-sm font-bold border-b-2 transition-all ${modalTab === 'financeiro' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>Ficha Financeira</button>}
        </div>

        {modalTab === 'dados' ? (
            <form onSubmit={handleSave} className="space-y-5">
            {/* DADOS PESSOAIS */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Dados Pessoais</h4>
                <div className="space-y-3">
                    <div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Nome Completo</label><input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-slate-900/5 bg-white" placeholder="Ex: João da Silva" /></div>
                    <div className="grid grid-cols-2 gap-3">
                        <div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">CPF</label><input required type="text" value={formData.cpf} maxLength={14} onChange={e => setFormData({...formData, cpf: maskCPF(e.target.value)})} className="w-full p-2.5 border border-slate-200 rounded-lg bg-white" placeholder="000.000.000-00"/></div>
                        <div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">RG</label><input type="text" value={formData.rg || ''} onChange={e => setFormData({...formData, rg: maskRG(e.target.value)})} className="w-full p-2.5 border border-slate-200 rounded-lg bg-white" placeholder="00.000.000-0"/></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Telefone</label><input required type="text" value={formData.phone} maxLength={15} onChange={e => setFormData({...formData, phone: maskPhone(e.target.value)})} className="w-full p-2.5 border border-slate-200 rounded-lg bg-white" placeholder="(00) 00000-0000"/></div>
                        <div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Email</label><input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg bg-white" placeholder="cliente@email.com" /></div>
                    </div>
                </div>
            </div>

            {/* ENDEREÇO */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex justify-between items-center">
                    Endereço Completo
                    {isCepLoading && <span className="text-[10px] text-blue-500 flex items-center gap-1"><Loader2 className="animate-spin" size={10}/> Buscando...</span>}
                </h4>
                <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                        <div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">CEP</label><input value={formData.cep || ''} onChange={e => setFormData({...formData, cep: maskCEP(e.target.value)})} onBlur={handleCepBlur} className="w-full p-2.5 border border-slate-200 rounded-lg bg-white" placeholder="00000-000"/></div>
                        <div className="col-span-2"><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Rua / Logradouro</label><input value={formData.address || ''} onChange={e => setFormData({...formData, address: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg bg-white" /></div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Número</label><input value={formData.number || ''} onChange={e => setFormData({...formData, number: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg bg-white" /></div>
                        <div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Bairro</label><input value={formData.neighborhood || ''} onChange={e => setFormData({...formData, neighborhood: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg bg-white" /></div>
                        <div><label className="block text-xs font-bold uppercase text-slate-500 mb-1">Cidade - UF</label><input value={formData.city || ''} onChange={e => setFormData({...formData, city: e.target.value})} className="w-full p-2.5 border border-slate-200 rounded-lg bg-white" /></div>
                    </div>
                </div>
            </div>

            {/* DOCUMENTOS */}
            <div className="border-t border-slate-100 pt-4">
                <div className="flex items-start gap-3 mb-4 bg-blue-50 p-4 rounded-xl border border-blue-100">
                    <AlertCircle size={20} className="text-blue-600 mt-0.5"/>
                    <div className="flex-1">
                        <p className="text-sm font-bold text-blue-900 mb-1">Documentação Recomendada</p>
                        <p className="text-xs text-blue-700 leading-relaxed">
                            Para maior segurança jurídica e aprovação rápida, anexe os documentos abaixo. <br/>
                            <span className="opacity-75">* Arquivos aceitos: Imagens (JPG, PNG) ou PDF.</span>
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-4">
                    <UploadSlot label="RG (Frente)" type="RG_FRENTE" />
                    <UploadSlot label="RG (Verso)" type="RG_VERSO" />
                    <UploadSlot label="Comp. Residência" type="COMPROVANTE_RESIDENCIA" />
                </div>

                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Observações Internas</label>
                <textarea value={formData.observations || ''} onChange={e => setFormData({...formData, observations: e.target.value})} className="w-full border p-3 rounded-xl h-20 text-sm bg-slate-50 focus:bg-white transition-colors outline-none focus:ring-2 focus:ring-slate-900/5" placeholder="Anotações extras sobre o cliente..." />
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 text-slate-600 font-bold hover:bg-slate-100 rounded-xl transition-all">Cancelar</button>
                <button type="submit" disabled={isLoading} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 disabled:opacity-50">
                {isLoading ? 'Salvando...' : 'Salvar Cliente'}
                </button>
            </div>
            </form>
        ) : (
            // --- CONTEÚDO DA FICHA FINANCEIRA ---
            <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
                {(() => {
                    const stats = calculateClientScore(formData.name || '');
                    const isInRed = stats.saldoFinal < 0;

                    return (
                        <>
                            {/* CARD DE SCORE FINANCEIRO (LUCRO / PREJUÍZO) */}
                            <div className={`p-5 rounded-2xl border ${isInRed ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'} shadow-sm flex flex-col gap-4`}>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className={`text-[10px] font-black uppercase tracking-widest ${isInRed ? 'text-red-500' : 'text-green-600'}`}>Balanço Geral do Cliente (Lucro/Prejuízo)</p>
                                        <p className={`text-3xl font-black ${isInRed ? 'text-red-700' : 'text-green-700'}`}>
                                            {isInRed ? '-' : '+'} R$ {formatMoney(Math.abs(stats.saldoFinal))}
                                        </p>
                                    </div>
                                    <div className={`p-3 rounded-xl ${isInRed ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                        {isInRed ? <TrendingDown size={28}/> : <TrendingUp size={28}/>}
                                    </div>
                                </div>
                                <p className={`text-xs font-medium ${isInRed ? 'text-red-800' : 'text-green-800'}`}>
                                    {isInRed 
                                        ? `PREJUÍZO ATUAL: O cliente pegou R$ ${formatMoney(stats.totalEmprestado)} e devolveu apenas R$ ${formatMoney(stats.totalDevolvido)} até o momento.` 
                                        : `LUCRO REAL: O cliente já pagou todo o capital emprestado e gerou R$ ${formatMoney(stats.saldoFinal)} de lucro livre para a empresa!`}
                                </p>
                            </div>

                            {/* MINI CARDS DE DADOS */}
                            <div className="grid grid-cols-2 gap-3 mb-2">
                                <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl">
                                    <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Total Já Emprestado</span>
                                    <span className="text-lg font-black text-slate-800">R$ {formatMoney(stats.totalEmprestado)}</span>
                                </div>
                                <div className="bg-slate-50 border border-slate-100 p-3 rounded-xl">
                                    <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Lucro Líquido Gerado</span>
                                    <span className="text-lg font-black text-green-600">R$ {formatMoney(stats.lucroReal)}</span>
                                </div>
                            </div>
                        </>
                    )
                })()}

                <h4 className="text-xs font-bold text-slate-500 uppercase mt-6 mb-2">Histórico de Contratos</h4>
                
                {loans.filter(l => l.client === formData.name).length === 0 ? (
                    <div className="text-center py-10 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        <FileText size={32} className="mx-auto mb-2 opacity-20"/>
                        <p className="text-sm">Nenhum empréstimo no histórico.</p>
                    </div>
                ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {loans.filter(l => l.client === formData.name).map(loan => {
                            const isPaid = loan.status === 'Pago';
                            return (
                                <div 
                                    key={loan.id} 
                                    onClick={() => handleGoToContract(loan.id)}
                                    className={`p-4 border rounded-xl flex justify-between items-center cursor-pointer hover:border-blue-400 hover:shadow-md transition-all ${isPaid ? 'bg-green-50/50 border-green-200' : 'bg-white border-slate-200 shadow-sm'}`}
                                    title="Clique para ir à ficha de cobrança deste contrato"
                                >
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-800">Contrato #{loan.id}</span>
                                            <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${isPaid ? 'bg-green-200 text-green-800' : loan.status === 'Atrasado' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>{loan.status}</span>
                                        </div>
                                        <p className="text-[11px] font-medium text-slate-500 mt-1 flex items-center gap-2">
                                            <Calendar size={12}/> {new Date(loan.startDate).toLocaleDateString('pt-BR')} 
                                            <span>•</span> 
                                            R$ {formatMoney(loan.amount)}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Valor Quitado</p>
                                        <p className="text-sm text-green-600 font-black">R$ {formatMoney((loan.totalPaidCapital || 0) + (loan.totalPaidInterest || 0))}</p>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
                
                <div className="pt-4 border-t border-slate-100 flex justify-end">
                    <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 text-white bg-slate-900 font-bold rounded-xl transition-all shadow-lg hover:bg-slate-800">Fechar Ficha</button>
                </div>
            </div>
        )}
      </Modal>

      {/* --- MODAL DETALHAMENTO DAS MÉTRICAS GLOBAIS --- */}
      <Modal isOpen={!!globalMetricModal} onClose={() => setGlobalMetricModal(null)} title="Detalhamento da Métrica">
          <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-300">
              {globalMetricModal === 'base' && (
                  <>
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl mb-4 flex items-center gap-3">
                          <div className="p-2 bg-slate-200 rounded-lg text-slate-600"><Users size={20}/></div>
                          <div>
                              <p className="text-[10px] uppercase font-bold text-slate-400">Listagem de Base</p>
                              <h3 className="font-bold text-slate-800">Todos os Clientes ({clients.length})</h3>
                          </div>
                      </div>
                      <div className="max-h-[400px] overflow-y-auto pr-2 custom-scrollbar space-y-2">
                          {clients.map(c => (
                              <div key={c.id} className="p-3 border border-slate-100 rounded-lg flex justify-between items-center hover:bg-slate-50 transition-colors">
                                  <div>
                                      <p className="font-bold text-slate-700 text-sm">{c.name}</p>
                                      <p className="text-[10px] text-slate-400 font-mono">CPF: {c.cpf}</p>
                                  </div>
                                  <span className={`text-[10px] px-2 py-1 rounded-full font-bold ${c.status === 'Bloqueado' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>{c.status}</span>
                              </div>
                          ))}
                      </div>
                  </>
              )}

              {globalMetricModal === 'ativos' && (
                  <>
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl mb-4 flex items-center gap-3">
                          <div className="p-2 bg-blue-200 rounded-lg text-blue-700"><Activity size={20}/></div>
                          <div>
                              <p className="text-[10px] uppercase font-bold text-blue-500">Listagem de Devedores</p>
                              <h3 className="font-bold text-blue-900">Clientes com Contratos Ativos ({globalMetrics.activeClients})</h3>
                          </div>
                      </div>
                      <div className="max-h-[400px] overflow-y-auto pr-2 custom-scrollbar space-y-2">
                          {Array.from(new Set(loans.filter(l => l.status !== 'Pago').map(l => l.client))).map((clientName, idx) => (
                              <div key={idx} className="p-3 border border-slate-100 rounded-lg flex justify-between items-center hover:bg-blue-50/50 transition-colors cursor-pointer" onClick={() => { setGlobalMetricModal(null); handleOpenModal(clients.find(c => c.name === clientName), 'financeiro'); }}>
                                  <p className="font-bold text-slate-700 text-sm">{clientName}</p>
                                  <span className="text-[10px] px-2 py-1 rounded-full font-bold bg-blue-100 text-blue-700">Dívida Ativa</span>
                              </div>
                          ))}
                      </div>
                  </>
              )}

              {globalMetricModal === 'emprestado' && (
                  <>
                      <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl mb-4 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                              <div className="p-2 bg-orange-200 rounded-lg text-orange-700"><DollarSign size={20}/></div>
                              <div>
                                  <p className="text-[10px] uppercase font-bold text-orange-500">Histórico de Saídas</p>
                                  <h3 className="font-bold text-orange-900">Dinheiro Emprestado</h3>
                              </div>
                          </div>
                          <h3 className="font-black text-orange-700 text-xl">R$ {formatMoney(globalMetrics.totalLent)}</h3>
                      </div>
                      <div className="max-h-[400px] overflow-y-auto pr-2 custom-scrollbar space-y-2">
                          {loans.map(l => (
                              <div key={l.id} className="p-3 border border-slate-100 rounded-lg flex justify-between items-center hover:bg-orange-50/50 transition-colors cursor-pointer" onClick={() => handleGoToContract(l.id)}>
                                  <div>
                                      <p className="font-bold text-slate-700 text-sm">{l.client}</p>
                                      <p className="text-[10px] text-slate-400 font-mono flex items-center gap-1"><List size={10}/> Contrato: {l.id} • {new Date(l.startDate).toLocaleDateString('pt-BR')}</p>
                                  </div>
                                  <span className="font-black text-slate-800">R$ {formatMoney(l.amount)}</span>
                              </div>
                          ))}
                      </div>
                  </>
              )}

              {globalMetricModal === 'lucro' && (
                  <>
                      <div className="p-4 bg-green-50 border border-green-200 rounded-xl mb-4 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                              <div className="p-2 bg-green-200 rounded-lg text-green-700"><TrendingUp size={20}/></div>
                              <div>
                                  <p className="text-[10px] uppercase font-bold text-green-600">Histórico de Entradas</p>
                                  <h3 className="font-bold text-green-900">Lucro Gerado</h3>
                              </div>
                          </div>
                          <h3 className="font-black text-green-700 text-xl">R$ {formatMoney(globalMetrics.totalProfit)}</h3>
                      </div>
                      <div className="max-h-[400px] overflow-y-auto pr-2 custom-scrollbar space-y-2">
                          {loans.filter(l => (l.totalPaidInterest || 0) > 0).map(l => (
                              <div key={l.id} className="p-3 border border-slate-100 rounded-lg flex justify-between items-center hover:bg-green-50/50 transition-colors cursor-pointer" onClick={() => handleGoToContract(l.id)}>
                                  <div>
                                      <p className="font-bold text-slate-700 text-sm">{l.client}</p>
                                      <p className="text-[10px] text-slate-400 font-mono flex items-center gap-1"><List size={10}/> Contrato: {l.id}</p>
                                  </div>
                                  <span className="font-black text-green-600">+ R$ {formatMoney(l.totalPaidInterest || 0)}</span>
                              </div>
                          ))}
                          {loans.filter(l => (l.totalPaidInterest || 0) > 0).length === 0 && (
                              <p className="text-center text-slate-400 text-sm py-8 italic border border-dashed rounded-xl">Nenhum lucro recebido ainda.</p>
                          )}
                      </div>
                  </>
              )}

              <div className="pt-4 border-t border-slate-100 text-right">
                  <button type="button" onClick={() => setGlobalMetricModal(null)} className="px-6 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition-all border border-slate-200 shadow-sm">Fechar Detalhamento</button>
              </div>
          </div>
      </Modal>
    </Layout>
  );
};

export default Clients;