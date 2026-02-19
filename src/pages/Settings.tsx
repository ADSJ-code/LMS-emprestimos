import React, { useState, useEffect, useRef } from 'react';
import { 
  Save, Building, Shield, CheckCircle, RefreshCw, Download, 
  Users, Plus, Trash2, Key, X, AlertTriangle, Upload, Loader2, Bell, Lock 
} from 'lucide-react';
import Layout from '../components/Layout';
// Importando os serviços necessários para deletar os dados
import { settingsService, clientService, loanService, authService } from '../services/api';

// --- COMPONENTE MODAL GENÉRICO ---
const Modal = ({ isOpen, onClose, title, children, color = "slate" }: any) => {
  if (!isOpen) return null;
  
  const headerColors: any = {
    slate: "bg-slate-50 border-slate-100",
    red: "bg-red-50 border-red-100 text-red-900",
    blue: "bg-blue-50 border-blue-100 text-blue-900"
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className={`px-6 py-4 border-b flex justify-between items-center ${headerColors[color] || headerColors.slate}`}>
          <h3 className="font-bold flex items-center gap-2">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={20}/></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

const Settings = () => {
  const [activeTab, setActiveTab] = useState<'empresa' | 'sistema' | 'usuarios'>('empresa');
  const [isLoading, setIsLoading] = useState(false);
  
  // --- AUTH & USER DATA ---
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false); 

  // --- USER MANAGEMENT STATES ---
  const [users, setUsers] = useState<any[]>([]);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });
  const [isUserLoading, setIsUserLoading] = useState(false);
  
  // --- MODALS STATES ---
  const [showSuccess, setShowSuccess] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null);
  const [newPasswordReset, setNewPasswordReset] = useState('');

  // --- DANGER ZONE STATES (RESTORE/RESET) ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dangerModalOpen, setDangerModalOpen] = useState(false);
  const [dangerActionType, setDangerActionType] = useState<'RESET' | 'RESTORE' | null>(null);
  const [securityCode, setSecurityCode] = useState(''); 
  const [confirmText, setConfirmText] = useState('');

  // --- SETTINGS FORM STATE ---
  const defaultSettings = {
    company: { 
        name: localStorage.getItem('lms_company_name_cache') || '', cnpj: '', pixKey: '', email: '', phone: '', address: '' 
    },
    system: { 
        autoBackup: false, requireLogin: true, warningDays: 3 
    }
  };
  const [settings, setSettings] = useState<any>(defaultSettings);

  // --- INITIAL LOAD ---
  useEffect(() => {
    let userObj = null;
    const sessionStr = localStorage.getItem('lms_active_session');
    
    if (sessionStr) {
        try {
            const sessionData = JSON.parse(sessionStr);
            userObj = sessionData.user || sessionData;
        } catch (e) { console.error("Erro ao ler lms_active_session", e); }
    } else {
        const userStr = localStorage.getItem('user');
        if (userStr) {
            try { userObj = JSON.parse(userStr); } catch (e) {}
        }
    }

    if (userObj) {
        setCurrentUser(userObj);
        
        const userRole = (userObj.role || "").toUpperCase();
        const userEmail = (userObj.email || userObj.username || "").toLowerCase();
        const userName = (userObj.name || "").toUpperCase();

        if (
            userRole.includes('ADMIN') || 
            userRole.includes('MASTER') || 
            userEmail.includes('admin') || 
            userName.includes('ADMIN') ||
            userName.includes('MESTRE')
        ) {
            setIsAdmin(true);
        }
    }

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

           if (companyData.name) {
               localStorage.setItem('lms_company_name_cache', companyData.name.toUpperCase());
           }
        }

        try {
            const userList = await authService.listUsers();
            setUsers(userList || []);
        } catch (uErr) { console.warn("Acesso restrito à lista de usuários."); }

      } catch (err) { console.error('Erro ao carregar configurações', err); }
    };
    fetchData();
  }, []);

  // --- HANDLERS: EMPRESA ---
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await settingsService.save(settings);
      if (settings.company?.name) {
          localStorage.setItem('lms_company_name_cache', settings.company.name.toUpperCase());
      }
      setIsLoading(false);
      setShowSuccess(true);
      window.dispatchEvent(new Event('settingsUpdated')); 
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) { alert('Falha ao salvar as configurações.'); setIsLoading(false); }
  };

  const updateCompany = (f: string, v: string) => {
    let val = v;
    if (f === 'cnpj') val = v.replace(/\D/g, '').replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2').slice(0, 18);
    if (f === 'phone') val = v.replace(/\D/g, '').replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2').slice(0, 15);
    setSettings((p: any) => ({ ...p, company: { ...p.company, [f]: val } }));
  };

  const updateSystem = (f: string, v: any) => {
      setSettings((p: any) => ({ ...p, system: { ...p.system, [f]: v } }));
  };

  // --- HANDLERS: USUÁRIOS ---
  const handleAddUser = async () => {
      if (!newUser.name || !newUser.email || !newUser.password) return alert("Preencha todos os campos.");
      setIsUserLoading(true); 
      try {
          await authService.addUser(newUser);
          try {
            const updatedList = await authService.listUsers();
            setUsers(updatedList || []);
          } catch(e) { console.error("Erro ao recarregar lista"); }
          
          setNewUser({ name: '', email: '', password: '' });
          alert("Usuário adicionado com sucesso!");
      } catch (err: any) { 
          alert(err.response?.data || err.message || "Erro ao adicionar usuário"); 
      } finally { setIsUserLoading(false); }
  };

  const handleRemoveUser = async (email: string) => {
      if (!confirm(`Remover o usuário ${email}?`)) return;
      try {
          await authService.removeUser(email);
          setUsers(users.filter(u => (u.username || u.email) !== email));
      } catch (err) { alert("Erro ao remover usuário."); }
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

  // --- HANDLERS: SISTEMA (BACKUP & RESET) ---
  const handleDownloadBackup = async () => {
      try {
          if(!confirm("Gerar backup completo do sistema?")) return;
          const [clients, loans] = await Promise.all([clientService.getAll(), loanService.getAll()]);
          const backupData = { date: new Date().toISOString(), clients, loans, settings, users };
          const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
          const el = document.createElement('a');
          el.setAttribute("href", dataStr); el.setAttribute("download", `backup_creditnow_${new Date().toISOString().split('T')[0]}.json`);
          document.body.appendChild(el); el.click(); el.remove();
      } catch (e) { alert("Erro ao gerar arquivo de backup."); }
  };

  const initiateRestore = () => {
      setDangerActionType('RESTORE');
      setSecurityCode('');
      setDangerModalOpen(true);
  };

  const initiateReset = () => {
      setDangerActionType('RESET');
      setSecurityCode('');
      setConfirmText('');
      setDangerModalOpen(true);
  };

  const handleSecurityCheck = () => {
      // SENHA TÉCNICA
      if (securityCode !== 'SUPORTE' && securityCode !== 'admin123') {
          alert("Código de segurança incorreto. Ação negada.");
          return;
      }

      if (dangerActionType === 'RESTORE') {
          setDangerModalOpen(false);
          fileInputRef.current?.click();
      } else if (dangerActionType === 'RESET') {
          if (confirmText !== 'CONFIRMAR') return;
          performFactoryReset();
      }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
          try {
              const json = JSON.parse(e.target?.result as string);
              setIsLoading(true); 
              await settingsService.restoreBackup(json);
              alert("✅ Sistema restaurado com sucesso! Você será desconectado.");
              localStorage.clear(); 
              window.location.href = '/login';
          } catch (error: any) {
              console.error(error);
              alert("Erro ao restaurar: Arquivo inválido.");
          } finally {
              setIsLoading(false);
              if (fileInputRef.current) fileInputRef.current.value = '';
          }
      };
      reader.readAsText(file);
  };

  // --- LÓGICA DE LIMPEZA REAL (Apaga um por um) ---
  const performFactoryReset = async () => {
    try {
        setIsLoading(true);
        
        const [clients, loans] = await Promise.all([
            clientService.getAll(),
            loanService.getAll()
        ]);

        for (const loan of loans) {
            try {
                await loanService.delete(loan.id);
            } catch(e) { console.error(`Erro ao deletar loan ${loan.id}`, e); }
        }

        for (const client of clients) {
            try {
                await clientService.delete(String(client.id));
            } catch(e) { console.error(`Erro ao deletar client ${client.id}`, e); }
        }
        
        alert('♻️ Reset de fábrica concluído. Todos os dados foram apagados.');
        localStorage.clear();
        window.location.href = '/login';
    } catch (e) { 
        console.error("Erro crítico no reset:", e);
        alert('Erro ao processar limpeza completa. Verifique o console.'); 
    }
    finally { setIsLoading(false); setDangerModalOpen(false); }
  };

  return (
    <Layout>
      <header className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800">Configurações</h2>
        <p className="text-slate-500">Gestão global do sistema, backups e controle de acessos.</p>
      </header>

      <div className="flex flex-col lg:flex-row gap-8">
        <aside className="w-full lg:w-64 flex-shrink-0">
          <nav className="flex flex-col gap-2">
            <button onClick={() => setActiveTab('empresa')} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors text-left ${activeTab === 'empresa' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-gray-50'}`}><Building size={18} /> Dados da Empresa</button>
            <button onClick={() => setActiveTab('usuarios')} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors text-left ${activeTab === 'usuarios' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-gray-50'}`}><Users size={18} /> Usuários do Sistema</button>
            <button onClick={() => setActiveTab('sistema')} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors text-left ${activeTab === 'sistema' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-gray-50'}`}><Shield size={18} /> Sistema e Backup</button>
          </nav>
          
          <div className="mt-8 bg-blue-50 p-4 rounded-xl border border-blue-100">
            <div className="flex items-center gap-2 mb-2"><div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div><span className="text-xs font-bold text-blue-700 uppercase">Status do Sistema</span></div>
            <p className="text-xs text-blue-800 font-medium">Versão 3.1.0 (Live)</p>
            <p className="text-[10px] text-blue-600 mt-1">Conexão Criptografada</p>
          </div>
        </aside>

        <div className="flex-1">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 relative min-h-[500px]">
            {showSuccess && (<div className="absolute top-4 right-4 bg-green-100 text-green-800 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 animate-in fade-in slide-in-from-top-2 z-10 border border-green-200 shadow-sm"><CheckCircle size={16} /> Salvo com sucesso!</div>)}

            {/* ABA EMPRESA */}
            {activeTab === 'empresa' && (
              <form onSubmit={handleSave} className="space-y-6 animate-in fade-in duration-300">
                <div className="flex items-center gap-3 border-b border-gray-100 pb-2"><Building className="text-slate-400" /><h3 className="text-lg font-bold text-slate-800">Dados Cadastrais</h3></div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2"><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome Fantasia</label><input type="text" value={settings.company.name} onChange={e => updateCompany('name', e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10 font-bold text-slate-700" placeholder="Ex: FINANCEIRA MODELO" /></div>
                  <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">CNPJ</label><input type="text" value={settings.company.cnpj} onChange={e => updateCompany('cnpj', e.target.value)} maxLength={18} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" /></div>
                  <div><label className="flex items-center gap-1 text-xs font-bold text-green-700 uppercase mb-1"><RefreshCw size={14}/> Chave PIX Padrão</label><input type="text" value={settings.company.pixKey} onChange={e => updateCompany('pixKey', e.target.value)} className="w-full p-3 border border-green-200 bg-green-50/30 text-green-800 font-mono rounded-xl outline-none focus:ring-2 focus:ring-green-500/20" /></div>
                  <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Telefone / WhatsApp</label><input type="text" value={settings.company.phone} onChange={e => updateCompany('phone', e.target.value)} maxLength={15} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" /></div>
                  <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email de Contato</label><input type="text" value={settings.company.email} onChange={e => updateCompany('email', e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" /></div>
                  <div className="md:col-span-2"><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Endereço Completo</label><input type="text" value={settings.company.address} onChange={e => updateCompany('address', e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" /></div>
                </div>
                <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end"><button type="submit" disabled={isLoading} className="flex items-center gap-2 bg-slate-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg">{isLoading ? <Loader2 className="animate-spin" size={18}/> : 'Salvar Alterações'}</button></div>
              </form>
            )}

            {/* ABA USUÁRIOS */}
            {activeTab === 'usuarios' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex items-center gap-3 border-b border-gray-100 pb-2"><Users className="text-slate-400" /><h3 className="text-lg font-bold text-slate-800">Gerenciar Acessos</h3></div>
                
                <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-slate-100 text-xs font-bold text-slate-500 uppercase">
                            <tr><th className="p-4">Nome</th><th className="p-4">Email / Login</th><th className="p-4 text-right">Ações</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {users.map((u, idx) => (
                                <tr key={idx} className="hover:bg-white transition-colors">
                                    <td className="p-4 font-bold text-slate-700 flex items-center gap-2">
                                        {(u.role?.toUpperCase() === 'ADMIN' || u.name?.toUpperCase().includes('ADMIN')) && (
                                            <span className="flex items-center" title="Administrador">
                                                <Shield size={14} className="text-blue-600"/>
                                            </span>
                                        )}
                                        {u.name}
                                    </td>
                                    <td className="p-4 text-slate-600 text-sm">{u.username || u.email}</td>
                                    <td className="p-4 text-right flex justify-end gap-2">
                                        {isAdmin ? (
                                            <>
                                                <button type="button" onClick={() => openResetModal(u.username || u.email)} className="text-blue-600 hover:bg-blue-100 p-2 rounded-lg transition-all" title="Alterar Senha"><Key size={16}/></button>
                                                <button type="button" onClick={() => handleRemoveUser(u.username || u.email)} className="text-red-500 hover:bg-red-100 p-2 rounded-lg transition-all" title="Remover"><Trash2 size={16}/></button>
                                            </>
                                        ) : <span className="text-xs text-slate-400 italic">Visualização</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {isAdmin && (
                    <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
                        <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2 text-sm uppercase"><Plus size={16} className="text-green-600"/> Cadastrar Novo Usuário</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <input type="text" placeholder="Nome Completo" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} className="p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-slate-900/10 text-sm"/>
                            <input type="email" placeholder="Email (Login)" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} className="p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-slate-900/10 text-sm"/>
                            <input type="password" placeholder="Senha Inicial" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} className="p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-slate-900/10 text-sm"/>
                        </div>
                        <button type="button" onClick={handleAddUser} disabled={isUserLoading} className={`mt-4 w-full font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 text-sm ${isUserLoading ? 'bg-slate-400 cursor-not-allowed text-white' : 'bg-slate-900 text-white hover:bg-slate-800'}`}>
                            {isUserLoading ? <><Loader2 className="animate-spin" size={16} /> Salvando...</> : "Adicionar Usuário"}
                        </button>
                    </div>
                )}
              </div>
            )}

            {/* ABA SISTEMA E BACKUP */}
            {activeTab === 'sistema' && (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="flex items-center gap-3 border-b border-gray-100 pb-2"><Shield className="text-slate-400" /><h3 className="text-lg font-bold text-slate-800">Manutenção e Segurança</h3></div>
                
                <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="bg-yellow-100 p-2 rounded-lg text-yellow-600"><Bell size={20}/></div>
                        <div>
                            <h4 className="font-bold text-slate-800 text-sm uppercase">Antecedência de Alerta</h4>
                            <p className="text-xs text-slate-500">Dias antes do vencimento para alertar.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <input type="number" min="0" max="30" value={settings.system.warningDays || 3} onChange={(e) => updateSystem('warningDays', parseInt(e.target.value))} className="w-16 p-2 text-center border border-slate-300 rounded-lg font-bold text-slate-800" />
                        <span className="text-xs font-bold text-slate-600 uppercase">dias</span>
                    </div>
                </div>

                {isAdmin && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 flex justify-between items-center">
                        <div><h4 className="font-bold text-slate-800 flex gap-2 text-sm uppercase"><Download size={18} className="text-blue-600"/> Exportar Base de Dados</h4><p className="text-xs text-slate-500">Gera um arquivo JSON completo.</p></div>
                        <button type="button" onClick={handleDownloadBackup} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 shadow-lg shadow-blue-500/20">Baixar Backup</button>
                    </div>
                )}

                {isAdmin && (
                    <div className="mt-10 pt-6 border-t-2 border-red-100">
                        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                            <div className="flex items-center gap-2 mb-4 text-red-700 border-b border-red-200 pb-2">
                                <AlertTriangle className="text-red-600" size={24}/>
                                <h3 className="font-black text-lg uppercase tracking-tight">Zona de Perigo (Técnico)</h3>
                            </div>
                            <p className="text-sm text-red-600 mb-6 font-medium">Estas ações exigem autorização técnica e senha de segurança.</p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <input type="file" accept=".json" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                                    <button type="button" onClick={initiateRestore} disabled={isLoading} className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-white border-2 border-red-200 text-red-700 rounded-xl hover:bg-red-100 transition-all font-black shadow-sm text-sm uppercase">
                                        <Upload size={18} /> {isLoading ? 'RESTAURANDO...' : 'RESTAURAR BACKUP'}
                                    </button>
                                </div>

                                <div className="space-y-2">
                                    <button type="button" onClick={initiateReset} className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all font-black shadow-lg shadow-red-600/20 text-sm uppercase">
                                        <Trash2 size={18} /> RESET DE FÁBRICA
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                
                <div className="mt-4 flex justify-end"><button type="button" onClick={handleSave} disabled={isLoading} className="flex items-center gap-2 bg-slate-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg">{isLoading ? 'Processando...' : 'Salvar Configurações'}</button></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL RESET SENHA */}
      <Modal isOpen={resetModalOpen} onClose={() => setResetModalOpen(false)} title="Segurança: Alterar Senha" color="blue">
          <div className="space-y-4">
              <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200 text-sm text-yellow-800">Alterando senha de: <strong>{selectedUserEmail}</strong></div>
              <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nova Senha</label><input type="password" value={newPasswordReset} onChange={(e) => setNewPasswordReset(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" placeholder="Digite a nova senha..." /></div>
              <button onClick={confirmPasswordReset} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all">Confirmar Alteração</button>
          </div>
      </Modal>

      {/* MODAL ZONA DE PERIGO (RESET/RESTORE) */}
      <Modal isOpen={dangerModalOpen} onClose={() => setDangerModalOpen(false)} title="⚠️ AÇÃO RESTRITA" color="red">
          <div className="space-y-4 text-center">
              <div className="bg-red-100 p-4 rounded-lg border border-red-200 text-sm text-red-900 text-left">
                  <p className="font-black mb-1 uppercase flex items-center gap-2"><Lock size={14}/> Autorização Necessária</p>
                  {dangerActionType === 'RESET' 
                    ? "Você está prestes a APAGAR TODO O SISTEMA. Clientes, empréstimos e histórico serão perdidos." 
                    : "Você irá substituir o banco de dados atual por um backup antigo. Dados recentes serão perdidos."
                  }
              </div>
              
              <div className="text-left space-y-3">
                  <div>
                    <label className="block text-xs font-black text-slate-700 mb-1 uppercase">Senha de Segurança (Técnico):</label>
                    <input type="password" value={securityCode} onChange={(e) => setSecurityCode(e.target.value)} className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-red-500 font-bold text-center tracking-widest" placeholder="••••••" />
                  </div>

                  {dangerActionType === 'RESET' && (
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1 uppercase">Digite "CONFIRMAR" para prosseguir:</label>
                        <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="w-full p-3 border border-red-200 rounded-xl outline-none focus:ring-2 focus:ring-red-500 font-bold text-center text-red-600" placeholder="CONFIRMAR" />
                      </div>
                  )}
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setDangerModalOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200">Cancelar</button>
                <button 
                    onClick={handleSecurityCheck} 
                    className={`flex-1 py-3 font-bold rounded-xl transition-all text-white shadow-lg ${dangerActionType === 'RESET' ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-800 hover:bg-slate-900'}`}
                >
                    {dangerActionType === 'RESET' ? 'ZERAR TUDO' : 'LIBERAR UPLOAD'}
                </button>
              </div>
          </div>
      </Modal>
    </Layout>
  );
};

export default Settings;