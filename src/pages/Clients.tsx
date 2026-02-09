import React, { useState, useEffect } from 'react';
import { 
  Search, Plus, MoreVertical, Edit2, Trash2, Eye, 
  MapPin, Phone, Mail, User, ShieldCheck, AlertCircle, RefreshCw, FileText, Upload, Loader2
} from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { clientService, Client, ClientDoc } from '../services/api';

const Clients = () => {
  // --- Estados ---
  const [clients, setClients] = useState<Client[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCepLoading, setIsCepLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [editingId, setEditingId] = useState<string | number | null>(null);

  const [formData, setFormData] = useState<Partial<Client>>({
    name: '', cpf: '', rg: '', email: '', phone: '',
    cep: '', address: '', number: '', neighborhood: '', city: '', state: '',
    observations: '', documents: [], status: 'Ativo'
  });

  const [openMenuId, setOpenMenuId] = useState<string | number | null>(null);

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
  const fetchClients = async () => {
    setIsLoading(true);
    try {
      const data = await clientService.getAll();
      setClients(data || []);
    } catch (err) { console.error(err); } 
    finally { setIsLoading(false); }
  };

  useEffect(() => {
    fetchClients();
    const handleGlobalClick = () => setOpenMenuId(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

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
  const handleOpenModal = (client?: Client) => {
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
      fetchClients();
    } catch (error: any) { 
        // --- CORREÇÃO AQUI: EXIBE A MENSAGEM DO BACKEND ---
        console.error("Erro ao salvar:", error);
        const msg = error.response?.data || error.message || "Erro desconhecido ao salvar.";
        alert("❌ ERRO: " + msg);
    } finally { 
        setIsLoading(false); 
    }
  };

  const handleDelete = async (id: string | number) => {
    if (confirm('Tem certeza que deseja excluir este cliente?')) {
      try { await clientService.delete(id.toString()); fetchClients(); } 
      catch (err) { alert('Erro ao excluir cliente.'); }
    }
    setOpenMenuId(null);
  };

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.cpf.includes(searchTerm)
  );

  return (
    <Layout>
      <header className="flex justify-between items-center mb-8">
        <div><h2 className="text-2xl font-bold text-slate-800">Gestão de Clientes</h2><p className="text-slate-500">Cadastre e gerencie sua base de clientes.</p></div>
        <div className="flex gap-2">
          <button onClick={fetchClients} className="flex items-center gap-2 bg-white border border-gray-200 text-slate-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors"><RefreshCw className={isLoading ? "animate-spin" : ""} size={18} /></button>
          <button onClick={() => handleOpenModal()} className="flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20"><Plus size={20} /> Novo Cliente</button>
        </div>
      </header>

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
                <th className="p-4">Cliente</th><th className="p-4">Contato</th><th className="p-4">Localização</th><th className="p-4 text-center">Status</th><th className="p-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredClients.length === 0 ? (<tr><td colSpan={5} className="p-8 text-center text-slate-400">Nenhum cliente encontrado.</td></tr>) : (filteredClients.map(client => (
                  <tr key={client.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold">{client.name.charAt(0).toUpperCase()}</div>
                        <div><div className="font-bold text-slate-800">{client.name}</div><div className="text-xs text-slate-400 flex items-center gap-1"><ShieldCheck size={12} /> {client.cpf}</div></div>
                      </div>
                    </td>
                    <td className="p-4"><div className="text-sm text-slate-600 flex items-center gap-2 mb-1"><Mail size={14} className="text-slate-400" /> {client.email}</div><div className="text-sm text-slate-600 flex items-center gap-2"><Phone size={14} className="text-slate-400" /> {client.phone}</div></td>
                    <td className="p-4"><div className="flex items-center gap-2 text-sm text-slate-600"><MapPin size={16} className="text-slate-400" /> {client.city} {client.state ? `- ${client.state}` : ''}</div></td>
                    <td className="p-4 text-center"><span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${client.status === 'Ativo' ? 'bg-green-100 text-green-700' : client.status === 'Bloqueado' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>{client.status}</span></td>
                    <td className="p-4 text-right relative">
                        <div className="relative inline-block text-left">
                            <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === client.id ? null : client.id); }} className={`p-2 rounded-lg transition-all ${openMenuId === client.id ? 'bg-slate-200 text-slate-900' : 'text-slate-400 hover:text-slate-900 hover:bg-slate-100'}`} title="Opções"><MoreVertical size={18} /></button>
                            
                            {openMenuId === client.id && (
                                <div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-2xl border border-slate-100 z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                                    <div className="py-1">
                                        <button onClick={() => handleOpenModal(client)} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                                            <Eye size={16} className="text-blue-500" /> Detalhes
                                        </button>
                                        <div className="border-t border-slate-100 my-1"></div>
                                        <button onClick={() => handleDelete(client.id)} className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 size={16} /> Excluir</button>
                                    </div>
                                </div>
                            )}
                        </div>
                        <button onClick={() => handleOpenModal(client)} className="ml-2 p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Ver Detalhes">
                            <Eye size={18} />
                        </button>
                    </td>
                  </tr>
                )))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? "Detalhes do Cliente" : "Novo Cliente"}>
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
      </Modal>
    </Layout>
  );
};

export default Clients;