import React, { useState, useEffect } from 'react';
import { Save, Building, Shield, CheckCircle, RefreshCw, Download, Users, Plus, Trash2, Key, X, AlertTriangle } from 'lucide-react';
import Layout from '../components/Layout';
import { settingsService, clientService, loanService, authService } from '../services/api';

// Componente Modal Simples
const Modal = ({ isOpen, onClose, title, children }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

const Settings = () => {
  const [activeTab, setActiveTab] = useState<'empresa' | 'sistema' | 'usuarios'>('empresa');
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Estados de Usuários
  const [users, setUsers] = useState<any[]>([]);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });
  
  // Estado para Reset de Senha
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null);
  const [newPasswordReset, setNewPasswordReset] = useState('');

  // Estado para Reset de Fábrica (Zona de Perigo)
  const [dangerModalOpen, setDangerModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  // --- ALTERAÇÃO PRINCIPAL AQUI ---
  // Inicializamos lendo do Cache. Se não tiver cache, começa vazio ('').
  // Removemos o "Credit Now Financeira" hardcoded.
  const defaultSettings = {
    company: { 
        name: localStorage.getItem('lms_company_name_cache') || '', 
        cnpj: '', 
        pixKey: '', 
        email: '', 
        phone: '', 
        address: '' 
    },
    system: { autoBackup: false, requireLogin: true }
  };

  const [settings, setSettings] = useState<any>(defaultSettings);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await settingsService.get();
        const legacyData = data as any;
        
        if (legacyData && (legacyData.company || legacyData.general)) {
           const companyData = legacyData.company || legacyData.general;
           const systemData = legacyData.system || legacyData.security;
           
           setSettings({
               company: { ...defaultSettings.company, ...companyData },
               system: { ...defaultSettings.system, ...systemData }
           });

           // ATUALIZA O CACHE ASSIM QUE O DADO VEM DO BANCO
           if (companyData.name) {
               localStorage.setItem('lms_company_name_cache', companyData.name.toUpperCase());
           }
        }
        const userList = await authService.listUsers();
        setUsers(userList);
      } catch (err) { console.error('Erro ao carregar dados', err); }
    };
    fetchData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await settingsService.save(settings);
      
      // ATUALIZA O CACHE IMEDIATAMENTE AO SALVAR
      if (settings.company?.name) {
          localStorage.setItem('lms_company_name_cache', settings.company.name.toUpperCase());
      }

      setIsLoading(false);
      setShowSuccess(true);
      
      // Dispara evento para atualizar o Layout (Header) instantaneamente
      window.dispatchEvent(new Event('settingsUpdated'));
      
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) { alert('Falha ao salvar.'); setIsLoading(false); }
  };

  // --- LÓGICA DE USUÁRIOS ---
  const handleAddUser = async () => {
      if (!newUser.name || !newUser.email || !newUser.password) return alert("Preencha todos os campos.");
      try {
          const created = await authService.addUser(newUser);
          setUsers([...users, created]);
          setNewUser({ name: '', email: '', password: '' });
          alert("Usuário adicionado!");
      } catch (err: any) { alert(err.message); }
  };

  const handleRemoveUser = async (email: string) => {
      if (!confirm(`Remover o usuário ${email}?`)) return;
      await authService.removeUser(email);
      setUsers(users.filter(u => u.email !== email));
  };

  const openResetModal = (email: string) => {
      setSelectedUserEmail(email);
      setNewPasswordReset('');
      setResetModalOpen(true);
  };

  const confirmPasswordReset = async () => {
      if (!selectedUserEmail || !newPasswordReset) return;
      try {
          await authService.updateUser(selectedUserEmail, { password: newPasswordReset });
          alert(`Senha alterada com sucesso!`);
          setResetModalOpen(false);
      } catch (error) { alert("Erro ao alterar senha."); }
  };

  // --- Helpers e Máscaras ---
  const maskCNPJ = (v: string) => v.replace(/\D/g, '').replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2').slice(0, 18);
  const maskPhone = (v: string) => v.replace(/\D/g, '').replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2').slice(0, 15);
  
  const updateCompany = (f: string, v: string) => {
    let val = v;
    if (f === 'cnpj') val = maskCNPJ(v);
    if (f === 'phone') val = maskPhone(v);
    setSettings((p: any) => ({ ...p, company: { ...p.company, [f]: val } }));
  };

  // Backup Manual
  const handleDownloadBackup = async () => {
      if(!confirm("Baixar backup completo?")) return;
      try {
          const [clients, loans] = await Promise.all([clientService.getAll(), loanService.getAll()]);
          const backupData = { date: new Date().toISOString(), clients, loans, settings, users };
          const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
          const el = document.createElement('a');
          el.setAttribute("href", dataStr); el.setAttribute("download", `backup_${new Date().toISOString().split('T')[0]}.json`);
          document.body.appendChild(el); el.click(); el.remove();
      } catch (e) { alert("Erro ao gerar backup."); }
  };

  // Reset de Fábrica
  const handleFactoryReset = async () => {
    if (confirmText !== 'CONFIRMAR') return;
    try {
        const response = await fetch('/api/admin/reset', { 
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (response.ok) {
            alert('Sistema resetado com sucesso. Você será desconectado.');
            localStorage.removeItem('token');
            // Limpa o cache do nome também para resetar a interface
            localStorage.removeItem('lms_company_name_cache');
            window.location.href = '/login';
        } else {
            alert('Erro ao resetar sistema.');
        }
    } catch (e) { alert('Erro de conexão.'); }
  };

  return (
    <Layout>
      <header className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800">Configurações</h2>
        <p className="text-slate-500">Gestão global do sistema e acessos.</p>
      </header>

      <div className="flex flex-col lg:flex-row gap-8">
        <aside className="w-full lg:w-64 flex-shrink-0">
          <nav className="flex flex-col gap-2">
            <button onClick={() => setActiveTab('empresa')} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left ${activeTab === 'empresa' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-gray-50'}`}><Building size={18} /> Dados da Empresa</button>
            <button onClick={() => setActiveTab('usuarios')} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left ${activeTab === 'usuarios' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-gray-50'}`}><Users size={18} /> Usuários do Sistema</button>
            <button onClick={() => setActiveTab('sistema')} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left ${activeTab === 'sistema' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-gray-50'}`}><Shield size={18} /> Segurança e Backup</button>
          </nav>
          <div className="mt-8 bg-blue-50 p-4 rounded-xl border border-blue-100">
            <div className="flex items-center gap-2 mb-2"><div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div><span className="text-xs font-bold text-blue-700 uppercase">Status do Sistema</span></div>
            <p className="text-xs text-blue-800">Versão 2.6.0 (Prod)</p>
            <p className="text-xs text-blue-600 mt-1">Ambiente Seguro</p>
          </div>
        </aside>

        <div className="flex-1">
          <form onSubmit={handleSave} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 relative min-h-[500px]">
            {showSuccess && (<div className="absolute top-4 right-4 bg-green-100 text-green-800 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-2 z-10 border border-green-200 shadow-sm"><CheckCircle size={16} /> Salvo com sucesso!</div>)}

            {/* ABA EMPRESA */}
            {activeTab === 'empresa' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex items-center gap-3 border-b border-gray-100 pb-2"><Building className="text-slate-400" /><h3 className="text-lg font-bold text-slate-800">Dados Cadastrais</h3></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2"><label className="block text-sm font-bold text-slate-700 mb-1">Nome Fantasia</label><input type="text" value={settings.company.name} onChange={e => updateCompany('name', e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" placeholder="Ex: RODRIGO FINANCEIRA" /></div>
                  <div><label className="block text-sm font-bold text-slate-700 mb-1">CNPJ</label><input type="text" value={settings.company.cnpj} onChange={e => updateCompany('cnpj', e.target.value)} maxLength={18} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" /></div>
                  <div><label className="flex items-center gap-1 text-sm font-bold text-green-700 mb-1"><RefreshCw size={14}/> Chave PIX</label><input type="text" value={settings.company.pixKey} onChange={e => updateCompany('pixKey', e.target.value)} className="w-full p-3 border border-green-200 bg-green-50/30 text-green-800 font-mono rounded-xl outline-none focus:ring-2 focus:ring-green-500/20" /></div>
                  <div><label className="block text-sm font-bold text-slate-700 mb-1">Telefone</label><input type="text" value={settings.company.phone} onChange={e => updateCompany('phone', e.target.value)} maxLength={15} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" /></div>
                  <div><label className="block text-sm font-bold text-slate-700 mb-1">Email</label><input type="text" value={settings.company.email} onChange={e => updateCompany('email', e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" /></div>
                  <div className="md:col-span-2"><label className="block text-sm font-bold text-slate-700 mb-1">Endereço</label><input type="text" value={settings.company.address} onChange={e => updateCompany('address', e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" /></div>
                </div>
                <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end"><button type="submit" disabled={isLoading} className="flex items-center gap-2 bg-slate-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg">{isLoading ? 'Salvando...' : 'Salvar Alterações'}</button></div>
              </div>
            )}

            {/* ABA USUÁRIOS */}
            {activeTab === 'usuarios' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex items-center gap-3 border-b border-gray-100 pb-2"><Users className="text-slate-400" /><h3 className="text-lg font-bold text-slate-800">Gerenciar Acessos</h3></div>
                
                <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-slate-100 text-xs font-bold text-slate-500 uppercase">
                            <tr><th className="p-4">Nome</th><th className="p-4">Email</th><th className="p-4 text-right">Ações</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            <tr className="bg-blue-50/50"><td className="p-4 font-bold text-slate-800">Admin Mestre</td><td className="p-4 text-slate-600">admin@creditnow.com</td><td className="p-4 text-right"><span className="text-[10px] font-bold bg-blue-200 text-blue-800 px-2 py-1 rounded">SISTEMA</span></td></tr>
                            {users.map(user => (
                                <tr key={user.id} className="hover:bg-white transition-colors">
                                    <td className="p-4 font-medium text-slate-800">{user.name}</td>
                                    <td className="p-4 text-slate-600">{user.email}</td>
                                    <td className="p-4 text-right flex justify-end gap-2">
                                        <button type="button" onClick={() => openResetModal(user.email)} className="text-blue-600 hover:bg-blue-100 p-2 rounded-lg transition-all" title="Alterar Senha"><Key size={16}/></button>
                                        <button type="button" onClick={() => handleRemoveUser(user.email)} className="text-red-500 hover:bg-red-100 p-2 rounded-lg transition-all" title="Remover"><Trash2 size={16}/></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
                    <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Plus size={18} className="text-green-600"/> Cadastrar Novo</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <input type="text" placeholder="Nome" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} className="p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-slate-900/10"/>
                        <input type="email" placeholder="Email" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} className="p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-slate-900/10"/>
                        <input type="password" placeholder="Senha" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} className="p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-slate-900/10"/>
                    </div>
                    <button type="button" onClick={handleAddUser} className="mt-4 w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 transition-all">Adicionar Usuário</button>
                </div>
              </div>
            )}

            {/* ABA SISTEMA */}
            {activeTab === 'sistema' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex items-center gap-3 border-b border-gray-100 pb-2"><Shield className="text-slate-400" /><h3 className="text-lg font-bold text-slate-800">Manutenção</h3></div>
                
                {/* Backup Manual */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 flex justify-between items-center mb-4">
                    <div><h4 className="font-bold text-slate-800 flex gap-2"><Download size={18} className="text-blue-600"/> Backup Manual</h4><p className="text-sm text-slate-500">Baixar cópia dos dados locais.</p></div>
                    <button type="button" onClick={handleDownloadBackup} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700">Baixar (.json)</button>
                </div>

                {/* ZONA DE PERIGO (RESET) */}
                <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex justify-between items-center">
                    <div>
                        <h4 className="font-bold text-red-800 flex gap-2"><AlertTriangle size={18} className="text-red-600"/> Reset de Fábrica</h4>
                        <p className="text-sm text-red-600">Apaga todos os dados e reseta o sistema. Irreversível.</p>
                    </div>
                    <button type="button" onClick={() => { setConfirmText(''); setDangerModalOpen(true); }} className="px-4 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700">Resetar Sistema</button>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>

      {/* MODAL RESET SENHA */}
      <Modal isOpen={resetModalOpen} onClose={() => setResetModalOpen(false)} title="Alterar Senha">
          <div className="space-y-4">
              <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200 text-sm text-yellow-800">Alterando senha de: <strong>{selectedUserEmail}</strong></div>
              <div><label className="block text-sm font-bold text-slate-700 mb-1">Nova Senha</label><input type="password" value={newPasswordReset} onChange={(e) => setNewPasswordReset(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" placeholder="Digite a nova senha..." /></div>
              <button onClick={confirmPasswordReset} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all">Confirmar Alteração</button>
          </div>
      </Modal>

      {/* MODAL RESET FÁBRICA (PERIGO) */}
      <Modal isOpen={dangerModalOpen} onClose={() => setDangerModalOpen(false)} title="⚠️ Confirmação Crítica">
          <div className="space-y-4">
              <div className="bg-red-100 p-4 rounded-lg border border-red-200 text-sm text-red-900">
                  <strong>Atenção:</strong> Esta ação apagará permanentemente todos os clientes, empréstimos e registros do sistema. As configurações da empresa serão mantidas.
              </div>
              <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1">Para confirmar, digite "CONFIRMAR":</label>
                  <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="w-full p-3 border border-red-200 rounded-xl outline-none focus:ring-2 focus:ring-red-500" placeholder="CONFIRMAR" />
              </div>
              <button onClick={handleFactoryReset} disabled={confirmText !== 'CONFIRMAR'} className={`w-full py-3 font-bold rounded-xl transition-all ${confirmText === 'CONFIRMAR' ? 'bg-red-600 text-white hover:bg-red-700 shadow-lg' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>APAGAR TUDO</button>
          </div>
      </Modal>
    </Layout>
  );
};

export default Settings;