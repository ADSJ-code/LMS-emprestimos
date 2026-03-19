import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, Plus, MoreVertical, Edit2, Trash2, Eye, 
  MapPin, Phone, Mail, User, ShieldCheck, AlertCircle, RefreshCw, FileText, Upload, Loader2,
  DollarSign, CheckCircle, XCircle, Clock, TrendingUp, TrendingDown, Users, Calendar, Activity, List, Check, ShieldAlert,
  Home, Layers
} from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { clientService, loanService, Client, ClientDoc, Loan } from '../services/api';
import { formatMoney } from '../utils/finance';

interface ChecklistItem {
  id: string; label: string; weight: number; checked: boolean; stage: 1 | 2;
}

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
  const [modalTab, setModalTab] = useState<'dados' | 'financeiro' | 'analise'>('dados');
  
  const [globalMetricModal, setGlobalMetricModal] = useState<'base' | 'ativos' | 'emprestado' | 'lucro' | null>(null);

  const [isCepLoading, setIsCepLoading] = useState(false);

  // --- FORM DATA ATUALIZADO (Campos para Contrato Juliana) ---
  const [formData, setFormData] = useState<Partial<Client> & { 
    justification?: string, 
    checklist?: string[],
    nationality?: string,
    maritalStatus?: string,
    houseType?: 'CASA' | 'APARTAMENTO',
    block?: string,
    floor?: string 
  }>({
    name: '', cpf: '', rg: '', email: '', phone: '',
    nationality: 'Brasileiro(a)', maritalStatus: 'SOLTEIRO(A)',
    cep: '', address: '', number: '', neighborhood: '', city: '', state: '',
    observations: '', documents: [], status: 'Ativo', justification: '', checklist: [],
    houseType: 'CASA', block: '', floor: ''
  });

  const [openMenuId, setOpenMenuId] = useState<string | number | null>(null);

  // --- LÓGICA DA TRIAGEM COMPLETA ---
  const [activeStage, setActiveStage] = useState<1 | 2>(1);

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

  const toggleChecklistItem = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setChecklistItems(prev => prev.map(item => item.id === id ? { ...item, checked: !item.checked } : item));
  };

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
        }
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

  const processedClients = useMemo(() => {
      const sortedByTime = [...clients].sort((a, b) => Number(a.id) - Number(b.id));
      return sortedByTime.map((c, index) => ({
          ...c,
          displayNumber: (c as any).clientNumber || (index + 1)
      })).reverse(); 
  }, [clients]);

  const globalMetrics = useMemo(() => {
      let totalLent = 0;
      let totalProfit = 0;
      const activeClientsSet = new Set();
      loans.forEach(l => {
          totalLent += Number(l.amount) || 0;
          totalProfit += Number(l.totalPaidInterest) || 0;
          if (l.status !== 'Pago' && l.status !== 'Quitado') activeClientsSet.add(l.client);
      });
      return { totalLent, totalProfit, totalClients: clients.length, activeClients: activeClientsSet.size };
  }, [loans, clients]);

  const calculateClientScore = (clientName: string) => {
      const clientLoans = loans.filter(l => l.client === clientName);
      let totalEmprestado = 0; let totalDevolvido = 0; let lucroReal = 0; let atrasos = 0;
      clientLoans.forEach(l => {
          const capPaid = Number(l.totalPaidCapital) || 0;
          const intPaid = Number(l.totalPaidInterest) || 0;
          const amount = Number(l.amount) || 0;
          totalEmprestado += amount; totalDevolvido += (capPaid + intPaid); lucroReal += intPaid;
          if (l.status === 'Atrasado') atrasos++;
      });
      const saldoFinal = totalDevolvido - totalEmprestado;
      return { totalEmprestado, totalDevolvido, lucroReal, saldoFinal, atrasos, contratos: clientLoans.length };
  };

  // --- DOCUMENTOS ---
  type DocType = 'RG_FRENTE' | 'RG_VERSO' | 'COMPROVANTE_RESIDENCIA';
  const getDoc = (type: DocType) => formData.documents?.find(d => d.name.startsWith(`[${type}]`));

  const handleSpecificUpload = (e: any, type: DocType) => {
      const file = e.target.files[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              const otherDocs = formData.documents?.filter(d => !d.name.startsWith(`[${type}]`)) || [];
              const newDoc: ClientDoc = { name: `[${type}] ${file.name}`, type: file.type, data: reader.result as string };
              setFormData(prev => ({ ...prev, documents: [...otherDocs, newDoc] }));
          };
          reader.readAsDataURL(file);
      }
  };

  const removeDoc = (type: DocType) => {
      if(confirm("Deseja remover?")) {
          const filtered = formData.documents?.filter(d => !d.name.startsWith(`[${type}]`)) || [];
          setFormData(prev => ({ ...prev, documents: filtered }));
      }
  };

  const viewDoc = (doc: ClientDoc) => {
      const w = window.open("");
      if (w) w.document.write(`<iframe src="${doc.data}" frameborder="0" style="border:0; width:100%; height:100%;" allowfullscreen></iframe>`);
  };

  const UploadSlot = ({ label, type }: { label: string, type: DocType }) => {
      const currentDoc = getDoc(type);
      return (
          <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase">{label}</span>
              {currentDoc ? (
                  <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl">
                      <div className="flex items-center gap-2 truncate">
                          <div className="bg-green-100 p-1.5 rounded text-green-700"><FileText size={16}/></div>
                          <span className="text-xs font-bold text-green-800 truncate max-w-[80px]">{currentDoc.name.replace(`[${type}] `, '')}</span>
                      </div>
                      <div className="flex gap-1">
                          <button type="button" onClick={() => viewDoc(currentDoc)} className="text-blue-500 p-1"><Eye size={14}/></button>
                          <button type="button" onClick={() => removeDoc(type)} className="text-red-400 p-1"><Trash2 size={14}/></button>
                      </div>
                  </div>
              ) : (
                  <label className="flex flex-col items-center justify-center p-2 border-2 border-dashed border-slate-300 rounded-xl text-slate-400 cursor-pointer hover:bg-slate-50 h-[62px]">
                      <input type="file" className="hidden" onChange={(e) => handleSpecificUpload(e, type)} />
                      <Upload size={16} /><span className="text-[9px] font-bold">Anexar</span>
                  </label>
              )}
          </div>
      );
  };

  // --- LÓGICA DE DÍVIDA (RESTAURADA) ---
  const getClientDebtStatus = (clientName: string) => {
    const clientLoans = loans.filter(l => l.client === clientName);
    if (clientLoans.length === 0) return { label: 'Sem Histórico', color: 'gray' };
    const todayStr = new Date().toISOString().split('T')[0];
    const hasOverdue = clientLoans.some(l => l.status !== 'Pago' && l.status !== 'Quitado' && l.nextDue.split('T')[0] < todayStr);
    if (hasOverdue) return { label: 'Inadimplente', color: 'red' };
    if (clientLoans.some(l => l.status !== 'Pago' && l.status !== 'Quitado')) return { label: 'Em Dia (Ativo)', color: 'blue' };
    return { label: 'Quitado', color: 'green' };
  };

  // --- FILTRO DE CLIENTES (RESTAURADO) ---
  const filteredClients = useMemo(() => {
    return processedClients.filter(c => 
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      c.cpf.includes(searchTerm) ||
      c.displayNumber.toString().includes(searchTerm)
    );
  }, [processedClients, searchTerm]);

  const handleOpenModal = (client?: any, defaultTab: 'dados' | 'financeiro' | 'analise' = 'dados') => {
    setModalTab(defaultTab); 
    if (client) {
      setEditingId(client.id);
      const savedChecklist = client.checklist || [];
      const restoredItems = initialChecklist.map(item => ({ ...item, checked: savedChecklist.includes(item.id) }));
      setChecklistItems(restoredItems);
      setFormData({ 
          ...client, documents: client.documents || [], justification: client.justification || '', checklist: savedChecklist,
          nationality: client.nationality || 'Brasileiro(a)', maritalStatus: client.maritalStatus || 'SOLTEIRO(A)',
          houseType: client.houseType || 'CASA', block: client.block || '', floor: client.floor || ''
      });
    } else {
      setEditingId(null);
      setChecklistItems(initialChecklist);
      setFormData({ 
          name: '', cpf: '', rg: '', email: '', phone: '', cep: '', address: '', number: '', neighborhood: '', city: '', state: '', 
          observations: '', documents: [], status: 'Ativo', justification: '', checklist: [],
          nationality: 'Brasileiro(a)', maritalStatus: 'SOLTEIRO(A)', houseType: 'CASA', block: '', floor: ''
      });
    }
    setIsModalOpen(true);
    setOpenMenuId(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const checkedIds = checklistItems.filter(i => i.checked).map(i => i.id);
      const payload = { ...formData, checklist: checkedIds };
      if (editingId) {
        await clientService.update(editingId, payload as Client);
        alert('Atualizado!');
      } else {
        const maxNum = processedClients.reduce((max, c) => Math.max(max, c.displayNumber), 0);
        await clientService.create({ ...payload, id: Date.now(), clientNumber: maxNum + 1 } as Client);
        alert('Cadastrado!');
      }
      setIsModalOpen(false); fetchData();
    } catch (err) { alert("Erro ao salvar."); } finally { setIsLoading(false); }
  };

  const handleDelete = async (id: string | number) => {
    if (confirm('Excluir cliente?')) { try { await clientService.delete(id.toString()); fetchData(); } catch (err) { alert('Erro.'); } }
  };

  return (
    <Layout>
      <header className="flex justify-between items-center mb-6">
        <div><h2 className="text-2xl font-bold text-slate-800">Clientes</h2><p className="text-slate-500">Gestão e análise de crédito.</p></div>
        <div className="flex gap-2">
          <button onClick={fetchData} className="bg-white border p-2.5 rounded-xl shadow-sm"><RefreshCw className={isLoading ? "animate-spin" : ""} size={18} /></button>
          <button onClick={() => handleOpenModal()} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2"><Plus size={20} /> Novo Cliente</button>
        </div>
      </header>

      {/* DASHBOARD */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div onClick={() => setGlobalMetricModal('base')} className="bg-white p-6 rounded-2xl border cursor-pointer hover:shadow-md transition-all flex items-center gap-4">
              <div className="p-3 bg-slate-50 rounded-xl"><Users size={24}/></div>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase">Base</p><p className="text-2xl font-black">{globalMetrics.totalClients}</p></div>
          </div>
          <div onClick={() => setGlobalMetricModal('ativos')} className="bg-white p-6 rounded-2xl border cursor-pointer hover:shadow-md transition-all flex items-center gap-4 text-blue-600">
              <div className="p-3 bg-blue-50 rounded-xl"><Activity size={24}/></div>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase">Ativos</p><p className="text-2xl font-black">{globalMetrics.activeClients}</p></div>
          </div>
          <div onClick={() => setGlobalMetricModal('emprestado')} className="bg-white p-6 rounded-2xl border cursor-pointer hover:shadow-md transition-all flex items-center gap-4">
              <div className="p-3 bg-orange-50 text-orange-600 rounded-xl"><DollarSign size={24}/></div>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase">Emprestado</p><p className="text-xl font-black text-slate-800">R$ {formatMoney(globalMetrics.totalLent)}</p></div>
          </div>
          <div onClick={() => setGlobalMetricModal('lucro')} className="bg-white p-6 rounded-2xl border cursor-pointer hover:shadow-md transition-all flex items-center gap-4 text-green-600">
              <div className="p-3 bg-green-50 rounded-xl"><TrendingUp size={24}/></div>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase">Lucro</p><p className="text-xl font-black">R$ {formatMoney(globalMetrics.totalProfit)}</p></div>
          </div>
      </div>

      {/* TABELA */}
      <div className="bg-white rounded-2xl shadow-sm border min-h-[400px]">
        <div className="p-4 border-b bg-slate-50/30">
          <div className="relative w-full md:w-96"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input type="text" placeholder="Busca..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 rounded-xl border outline-none focus:ring-2 focus:ring-slate-900/5"/></div>
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b">
              <th className="p-4">Cliente</th><th className="p-4">Contato</th><th className="p-4 text-center">Status</th><th className="p-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredClients.map((client: Client) => {
              const ds = getClientDebtStatus(client.name);
              return (
                <tr key={client.id} className="hover:bg-slate-50/80 transition-colors cursor-pointer" onClick={() => handleOpenModal(client, 'financeiro')}>
                  <td className="p-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center text-white font-bold text-xs">#{(client as any).displayNumber}</div><div><p className="font-bold text-slate-800">{client.name}</p><p className="text-[10px] text-slate-400">{client.cpf}</p></div></div></td>
                  <td className="p-4 text-xs text-slate-600"><Mail size={12} className="inline mr-1"/> {client.email || '-'}<br/><Phone size={12} className="inline mr-1"/> {client.phone}</td>
                  <td className="p-4 text-center"><span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${ds.color === 'red' ? 'bg-red-50 text-red-600' : ds.color === 'blue' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>{ds.label}</span></td>
                  <td className="p-4 text-right relative">
                    <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === client.id ? null : client.id); }} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"><MoreVertical size={16} /></button>
                    {openMenuId === client.id && (
                        <div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-2xl border z-[100] overflow-hidden"><button onClick={() => handleOpenModal(client, 'dados')} className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50">Editar</button><button onClick={() => handleOpenModal(client, 'analise')} className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50">Triagem</button><div className="border-t"></div><button onClick={() => handleDelete(client.id)} className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50">Excluir</button></div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* MODAL PRINCIPAL */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? `Ficha #${(formData as any).displayNumber}` : "Novo Cliente"}>
        <div className="flex border-b mb-6 font-bold text-sm">
            <button onClick={() => setModalTab('dados')} className={`flex-1 pb-3 border-b-2 ${modalTab === 'dados' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>1. Dados</button>
            <button onClick={() => setModalTab('analise')} className={`flex-1 pb-3 border-b-2 ${modalTab === 'analise' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>2. Triagem</button>
            {editingId && <button onClick={() => setModalTab('financeiro')} className={`flex-1 pb-3 border-b-2 ${modalTab === 'financeiro' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>3. Financeiro</button>}
        </div>

        {modalTab === 'dados' ? (
            <form onSubmit={handleSave} className="space-y-4">
                <div className="bg-slate-50 p-4 rounded-xl border space-y-3">
                    <input required placeholder="Nome Completo" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-2.5 border rounded-lg" />
                    <div className="grid grid-cols-2 gap-3">
                        <input required placeholder="CPF" value={formData.cpf} onChange={e => setFormData({...formData, cpf: maskCPF(e.target.value)})} className="w-full p-2.5 border rounded-lg" />
                        <input placeholder="RG" value={formData.rg} onChange={e => setFormData({...formData, rg: maskRG(e.target.value)})} className="w-full p-2.5 border rounded-lg" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <input placeholder="Nacionalidade" value={formData.nationality} onChange={e => setFormData({...formData, nationality: e.target.value})} className="w-full p-2.5 border rounded-lg" />
                        <select value={formData.maritalStatus} onChange={e => setFormData({...formData, maritalStatus: e.target.value})} className="w-full p-2.5 border rounded-lg bg-white text-xs"><option value="SOLTEIRO(A)">Solteiro(a)</option><option value="CASADO(A)">Casado(a)</option><option value="DIVORCIADO(A)">Divorciado(a)</option><option value="VIÚVO(A)">Viúvo(a)</option><option value="UNIÃO ESTÁVEL">União Estável</option></select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <input required placeholder="WhatsApp" value={formData.phone} onChange={e => setFormData({...formData, phone: maskPhone(e.target.value)})} className="w-full p-2.5 border rounded-lg" />
                        <input type="email" placeholder="Email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full p-2.5 border rounded-lg" />
                    </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border space-y-3">
                    <h4 className="text-[10px] font-black uppercase text-slate-400 mb-2">Localização {isCepLoading && <Loader2 className="animate-spin inline" size={10}/>}</h4>
                    <div className="grid grid-cols-3 gap-3">
                        <input placeholder="CEP" value={formData.cep} onBlur={handleCepBlur} onChange={e => setFormData({...formData, cep: maskCEP(e.target.value)})} className="w-full p-2.5 border rounded-lg" />
                        <input placeholder="Rua" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="col-span-2 w-full p-2.5 border rounded-lg" />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <input placeholder="Nº" value={formData.number} onChange={e => setFormData({...formData, number: e.target.value})} className="w-full p-2.5 border rounded-lg" />
                        <select value={formData.houseType} onChange={e => setFormData({...formData, houseType: e.target.value as any})} className="w-full p-2.5 border rounded-lg bg-white text-xs font-bold"><option value="CASA">Casa</option><option value="APARTAMENTO">Apto</option></select>
                        <input placeholder="Bairro" value={formData.neighborhood} onChange={e => setFormData({...formData, neighborhood: e.target.value})} className="w-full p-2.5 border rounded-lg" />
                    </div>
                    {formData.houseType === 'APARTAMENTO' && (
                        <div className="grid grid-cols-2 gap-3 animate-in slide-in-from-top-1">
                            <div className="flex items-center gap-2 bg-white p-1 border rounded-lg"><Home size={14} className="text-slate-400 ml-1" /><input placeholder="Bloco" value={formData.block} onChange={e => setFormData({...formData, block: e.target.value})} className="w-full p-1 outline-none text-xs" /></div>
                            <div className="flex items-center gap-2 bg-white p-1 border rounded-lg"><Layers size={14} className="text-slate-400 ml-1" /><input placeholder="Andar / Apto" value={formData.floor} onChange={e => setFormData({...formData, floor: e.target.value})} className="w-full p-1 outline-none text-xs" /></div>
                        </div>
                    )}
                    <div className="grid grid-cols-3 gap-3">
                        <input placeholder="Cidade" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="col-span-2 w-full p-2.5 border rounded-lg" />
                        <input placeholder="UF" value={formData.state} maxLength={2} onChange={e => setFormData({...formData, state: e.target.value.toUpperCase()})} className="w-full p-2.5 border rounded-lg uppercase" />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <UploadSlot label="RG Frente" type="RG_FRENTE" /><UploadSlot label="RG Verso" type="RG_VERSO" /><UploadSlot label="Residência" type="COMPROVANTE_RESIDENCIA" />
                </div>

                <div className="pt-4 border-t flex justify-end gap-3">
                    <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 text-slate-500 font-bold">Cancelar</button>
                    <button type="submit" disabled={isLoading} className="bg-slate-900 text-white px-8 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg">
                        {isLoading ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle size={18}/>} Salvar
                    </button>
                </div>
            </form>
        ) : modalTab === 'analise' ? (
            <div className="space-y-6">
                <div className="bg-slate-900 p-5 rounded-2xl text-white">
                    <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Score</p>
                    <p className="text-4xl font-black text-blue-400">{progressPercentage}%</p>
                    <div className="w-full bg-white/10 rounded-full h-2 mt-3 overflow-hidden"><div className="bg-blue-400 h-full" style={{ width: `${progressPercentage}%` }}></div></div>
                </div>
                <div className="flex border-b gap-4 text-sm font-bold"><button onClick={() => setActiveStage(1)} className={`pb-2 ${activeStage === 1 ? 'border-b-2 border-slate-900' : 'text-slate-400'}`}>1. Perfil</button><button onClick={() => setActiveStage(2)} className={`pb-2 ${activeStage === 2 ? 'border-b-2 border-slate-900' : 'text-slate-400'}`}>2. Docs</button></div>
                <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2">
                    {checklistItems.filter(i => i.stage === activeStage).map(item => (
                        <div key={item.id} onClick={(e) => toggleChecklistItem(item.id, e)} className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer ${item.checked ? 'bg-green-50 border-green-200' : 'bg-white'}`}><div className={`w-5 h-5 rounded border flex items-center justify-center ${item.checked ? 'bg-green-500 border-green-500 text-white' : 'bg-white'}`}>{item.checked && <Check size={12} strokeWidth={4}/>}</div><span className={`text-xs font-bold ${item.checked ? 'text-green-800' : 'text-slate-600'}`}>{item.label}</span></div>
                    ))}
                </div>
                <div className="bg-orange-50 p-4 rounded-xl border border-orange-200"><textarea value={formData.justification} onChange={e => setFormData({...formData, justification: e.target.value})} className="w-full p-3 h-20 text-xs rounded-lg outline-none border-none bg-white/60" placeholder="Parecer da análise..." /></div>
                <button onClick={handleSave} className="w-full py-3 bg-green-600 text-white font-bold rounded-xl shadow-lg">Salvar Análise</button>
            </div>
        ) : (
            <div className="space-y-4">
                {(() => {
                    const st = calculateClientScore(formData.name || '');
                    const red = st.saldoFinal < 0;
                    return (
                        <>
                            <div className={`p-6 rounded-2xl border-2 flex justify-between items-center ${red ? 'bg-red-50 border-red-100 text-red-700' : 'bg-green-50 border-green-100 text-green-700'}`}><div><p className="text-[10px] font-black uppercase opacity-60">Rentabilidade</p><p className="text-3xl font-black">R$ {formatMoney(st.saldoFinal)}</p></div>{red ? <TrendingDown size={40} className="opacity-20"/> : <TrendingUp size={40} className="opacity-20"/>}</div>
                            <div className="grid grid-cols-2 gap-3"><div className="bg-slate-50 p-3 rounded-xl border"><p className="text-[10px] font-bold text-slate-400 uppercase">Emprestado</p><p className="text-lg font-black">R$ {formatMoney(st.totalEmprestado)}</p></div><div className="bg-slate-50 p-3 rounded-xl border"><p className="text-[10px] font-bold text-slate-400 uppercase">Devolvido</p><p className="text-lg font-black">R$ {formatMoney(st.totalDevolvido)}</p></div></div>
                            <div className="max-h-[200px] overflow-y-auto space-y-2 mt-4">{loans.filter(l => l.client === formData.name).map(l => (<div key={l.id} onClick={() => handleGoToContract(l.id)} className="p-3 border rounded-xl flex justify-between items-center bg-white shadow-sm cursor-pointer hover:border-blue-400"><div><p className="font-bold text-sm">#{l.id}</p><p className="text-[10px] text-slate-400">{new Date(l.startDate).toLocaleDateString()}</p></div><span className="font-black text-slate-800 text-sm">R$ {formatMoney(l.amount)}</span></div>))}</div>
                        </>
                    )
                })()}
                <button type="button" onClick={() => setIsModalOpen(false)} className="w-full py-4 bg-slate-900 text-white font-bold rounded-xl mt-4">Fechar</button>
            </div>
        )}
      </Modal>

      <Modal isOpen={!!globalMetricModal} onClose={() => setGlobalMetricModal(null)} title="Consolidado">
          <div className="max-h-[400px] overflow-y-auto pr-2 space-y-2">
              {processedClients.map(c => (<div key={c.id} className="p-3 border rounded-xl flex justify-between items-center"><div className="flex items-center gap-2"><div className="w-8 h-8 rounded bg-slate-900 text-white flex items-center justify-center text-[10px] font-bold">#{c.displayNumber}</div><p className="text-sm font-bold text-slate-700">{c.name}</p></div><span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${c.status === 'Bloqueado' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>{c.status}</span></div>))}
          </div>
      </Modal>
    </Layout>
  );
};

export default Clients;