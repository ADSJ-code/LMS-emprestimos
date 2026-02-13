import React, { useState, useEffect, useRef } from 'react';
import { Save, Building, Shield, CheckCircle, RefreshCw, Download, Users, Plus, Trash2, Key, X, AlertTriangle, Upload, Loader2, Bell } from 'lucide-react';
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
  
  // --- SEGURANÇA ---
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false); 

  const [isUserLoading, setIsUserLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [users, setUsers] = useState<any[]>([]);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' });
  
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(null);
  const [newPasswordReset, setNewPasswordReset] = useState('');

  const [dangerModalOpen, setDangerModalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const defaultSettings = {
    company: { 
        name: localStorage.getItem('lms_company_name_cache') || '', cnpj: '', pixKey: '', email: '', phone: '', address: '' 
    },
    system: { 
        autoBackup: false, requireLogin: true, warningDays: 3 
    }
  };

  const [settings, setSettings] = useState<any>(defaultSettings);

  useEffect(() => {
    // 1. Identificação do Usuário e Role
    const sessionStr = localStorage.getItem('lms_active_session');
    if (sessionStr) {
        try {
            const sessionObj = JSON.parse(sessionStr);
            const userObj = sessionObj.user;
            setCurrentUser(userObj);
            const userRole = (userObj?.role || "").toUpperCase();
            if (userRole.includes('ADMIN')) {
                setIsAdmin(true);
            }
        } catch (e) {
            console.error("Erro ao ler usuário do localStorage", e);
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
        } catch (uErr) {
            console.warn("Não foi possível listar usuários.");
        }
      } catch (err) { console.error('Erro ao carregar configurações', err); }
    };
    fetchData();
  }, []);

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

  const handleAddUser = async () => {
      if (!newUser.name || !newUser.email || !newUser.password) return alert("Preencha todos os campos.");
      setIsUserLoading(true); 
      try {
          const created = await authService.addUser(newUser);
          setUsers([...users, created]);
          setNewUser({ name: '', email: '', password: '' });
          alert("Usuário adicionado com sucesso!");
      } catch (err: any) { 
          alert(err.response?.data || err.message || "Erro ao adicionar usuário"); 
      } finally {
          setIsUserLoading(false);
      }
  };

  const handleRemoveUser = async (email: string) => {
      if (!confirm(`Remover o usuário ${email}?`)) return;
      try {
          await authService.removeUser(email);
          setUsers(users.filter(u => (u.username || u.email) !== email));
      } catch (err) {
          alert("Erro ao remover usuário.");
      }
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

  const maskCNPJ = (v: string) => v.replace(/\D/g, '').replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2').slice(0, 18);
  const maskPhone = (v: string) => v.replace(/\D/g, '').replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2').slice(0, 15);
  
  const updateCompany = (f: string, v: string) => {
    let val = v;
    if (f === 'cnpj') val = maskCNPJ(v);
    if (f === 'phone') val = maskPhone(v);
    setSettings((p: any) => ({ ...p, company: { ...p.company, [f]: val } }));
  };

  const updateSystem = (f: string, v: any) => {
      setSettings((p: any) => ({ ...p, system: { ...p.system, [f]: v } }));
  };

  const handleDownloadBackup = async () => {
      if(!confirm("Deseja baixar uma cópia de segurança completa do sistema?")) return;
      try {
          const [clients, loans] = await Promise.all([clientService.getAll(), loanService.getAll()]);
          const backupData = { date: new Date().toISOString(), clients, loans, settings, users };
          const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
          const el = document.createElement('a');
          el.setAttribute("href", dataStr); el.setAttribute("download", `backup_total_${new Date().toISOString().split('T')[0]}.json`);
          document.body.appendChild(el); el.click(); el.remove();
      } catch (e) { alert("Erro ao gerar arquivo de backup."); }
  };

  const handleRestoreClick = () => {
      fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!confirm("⚠️ PERIGO: Restaurar um backup irá SUBSTITUIR TODOS os dados atuais. Esta ação não pode ser desfeita.\n\nDeseja continuar?")) {
          if (fileInputRef.current) fileInputRef.current.value = ''; 
          return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
          try {
              const json = JSON.parse(e.target?.result as string);
              setIsLoading(true); 
              await settingsService.restoreBackup(json);
              alert("Sistema restaurado com sucesso! Você será desconectado para aplicar as mudanças.");
              localStorage.clear(); 
              window.location.href = '/login';
          } catch (error: any) {
              console.error(error);
              alert("Erro ao restaurar: " + (error.response?.data || error.message || "Arquivo inválido ou corrompido."));
          } finally {
              setIsLoading(false);
              if (fileInputRef.current) fileInputRef.current.value = '';
          }
      };
      reader.readAsText(file);
  };

  const handleFactoryReset = async () => {
    if (confirmText !== 'CONFIRMAR') return;
    try {
        setIsLoading(true);
        const response = await fetch('/api/admin/reset', { 
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        if (response.ok) {
            alert('Reset de fábrica concluído. O sistema foi zerado e você será desconectado.');
            localStorage.clear();
            window.location.href = '/login';
        } else {
            alert('Erro ao resetar sistema. Verifique suas permissões.');
        }
    } catch (e) { alert('Erro de conexão com o servidor.'); }
    finally { setIsLoading(false); }
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
            <button onClick={() => setActiveTab('empresa')} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left ${activeTab === 'empresa' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-gray-50'}`}><Building size={18} /> Dados da Empresa</button>
            <button onClick={() => setActiveTab('usuarios')} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left ${activeTab === 'usuarios' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-gray-50'}`}><Users size={18} /> Usuários do Sistema</button>
            <button onClick={() => setActiveTab('sistema')} className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left ${activeTab === 'sistema' ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-600 hover:bg-gray-50'}`}><Shield size={18} /> Sistema e Backup</button>
          </nav>
          <div className="mt-8 bg-blue-50 p-4 rounded-xl border border-blue-100">
            <div className="flex items-center gap-2 mb-2"><div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div><span className="text-xs font-bold text-blue-700 uppercase">Status do Sistema</span></div>
            <p className="text-xs text-blue-800">Versão 2.8.1 (ERP)</p>
            <p className="text-xs text-blue-600 mt-1 font-medium">Conexão Criptografada</p>
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
                  <div className="md:col-span-2"><label className="block text-sm font-bold text-slate-700 mb-1">Nome Fantasia</label><input type="text" value={settings.company.name} onChange={e => updateCompany('name', e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" placeholder="Ex: FINANCEIRA MODELO" /></div>
                  <div><label className="block text-sm font-bold text-slate-700 mb-1">CNPJ</label><input type="text" value={settings.company.cnpj} onChange={e => updateCompany('cnpj', e.target.value)} maxLength={18} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" /></div>
                  <div><label className="flex items-center gap-1 text-sm font-bold text-green-700 mb-1"><RefreshCw size={14}/> Chave PIX Padrão</label><input type="text" value={settings.company.pixKey} onChange={e => updateCompany('pixKey', e.target.value)} className="w-full p-3 border border-green-200 bg-green-50/30 text-green-800 font-mono rounded-xl outline-none focus:ring-2 focus:ring-green-500/20" /></div>
                  <div><label className="block text-sm font-bold text-slate-700 mb-1">Telefone / WhatsApp</label><input type="text" value={settings.company.phone} onChange={e => updateCompany('phone', e.target.value)} maxLength={15} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" /></div>
                  <div><label className="block text-sm font-bold text-slate-700 mb-1">Email de Contato</label><input type="text" value={settings.company.email} onChange={e => updateCompany('email', e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" /></div>
                  <div className="md:col-span-2"><label className="block text-sm font-bold text-slate-700 mb-1">Endereço Completo</label><input type="text" value={settings.company.address} onChange={e => updateCompany('address', e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/10" /></div>
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
                                    <td className="p-4 font-medium text-slate-800 flex items-center gap-2">
                                        {(u.role?.toUpperCase() === 'ADMIN') && (
                                            <span title="Administrador"><Shield size={14} className="text-blue-600"/></span>
                                        )}
                                        {u.name}
                                    </td>
                                    <td className="p-4 text-slate-600">{u.username || u.email}</td>
                                    <td className="p-4 text-right flex justify-end gap-2">
                                        <button type="button" onClick={() => openResetModal(u.username || u.email)} className="text-blue-600 hover:bg-blue-100 p-2 rounded-lg transition-all" title="Alterar Senha"><Key size={16}/></button>
                                        {(u.role?.toUpperCase() !== 'ADMIN') && (
                                            <button type="button" onClick={() => handleRemoveUser(u.username || u.email)} className="text-red-500 hover:bg-red-100 p-2 rounded-lg transition-all" title="Remover"><Trash2 size={16}/></button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {isAdmin && (
                    <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
                        <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Plus size={18} className="text-green-600"/> Cadastrar Novo Usuário</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <input type="text" placeholder="Nome Completo" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} className="p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-slate-900/10"/>
                            <input type="email" placeholder="Email (Login)" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} className="p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-slate-900/10"/>
                            <input type="password" placeholder="Senha Inicial" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} className="p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-slate-900/10"/>
                        </div>
                        
                        <button 
                            type="button" 
                            onClick={handleAddUser} 
                            disabled={isUserLoading}
                            className={`mt-4 w-full font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 ${isUserLoading ? 'bg-slate-400 cursor-not-allowed text-white' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                        >
                            {isUserLoading ? <><Loader2 className="animate-spin" size={18} /> Processando...</> : "Adicionar Usuário"}
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
                            <h4 className="font-bold text-slate-800">Antecedência de Alerta</h4>
                            <p className="text-sm text-slate-500">Dias antes do vencimento para o contrato aparecer no "Bom Dia".</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <input type="number" min="1" max="30" value={settings.system.warningDays || 3} 
                               onChange={(e) => updateSystem('warningDays', parseInt(e.target.value))}
                               className="w-16 p-2 text-center border border-slate-300 rounded-lg font-bold text-slate-800" />
                        <span className="text-sm font-bold text-slate-600">dias</span>
                    </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 flex justify-between items-center">
                    <div><h4 className="font-bold text-slate-800 flex gap-2"><Download size={18} className="text-blue-600"/> Exportar Base de Dados</h4><p className="text-sm text-slate-500">Gera um arquivo JSON com todos os dados atuais.</p></div>
                    <button type="button" onClick={handleDownloadBackup} className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700">Baixar Backup</button>
                </div>

                {isAdmin && (
                    <div className="mt-10 pt-6 border-t-2 border-red-100">
                        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                            <div className="flex items-center gap-2 mb-4 text-red-700 border-b border-red-200 pb-2">
                                <AlertTriangle className="text-red-600" size={24}/>
                                <h3 className="font-black text-lg uppercase tracking-tight">Zona de Perigo (Administrador)</h3>
                            </div>
                            <p className="text-sm text-red-600 mb-6 font-medium">As ações abaixo são críticas e afetam a integridade de todo o sistema financeiro.</p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <input type="file" accept=".json" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                                    <button type="button" onClick={handleRestoreClick} disabled={isLoading} className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-white border-2 border-red-200 text-red-700 rounded-xl hover:bg-red-100 transition-all font-black shadow-sm">
                                        <Upload size={20} /> {isLoading ? 'RESTAURANDO...' : 'RESTAURAR BACKUP JSON'}
                                    </button>
                                </div>

                                <div className="space-y-2">
                                    <button type="button" onClick={() => { setConfirmText(''); setDangerModalOpen(true); }} className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all font-black shadow-lg">
                                        <Trash2 size={20} /> RESET DE FÁBRICA
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
      <Modal isOpen={resetModalOpen} onClose={() => setResetModalOpen(false)} title="Segurança: Alterar Senha">
          <div className="space-y-4">
              <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200 text-sm text-yellow-800">Alterando senha de: <strong>{selectedUserEmail}</strong></div>
              <div><label className="block text-sm font-bold text-slate-700 mb-1">Nova Senha de Acesso</label><input type="password" value={newPasswordReset} onChange={(e) => setNewPasswordReset(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" placeholder="Digite a nova senha..." /></div>
              <button onClick={confirmPasswordReset} className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all">Confirmar Alteração</button>
          </div>
      </Modal>

      {/* MODAL RESET FÁBRICA */}
      <Modal isOpen={dangerModalOpen} onClose={() => setDangerModalOpen(false)} title="⚠️ AÇÃO IRREVERSÍVEL">
          <div className="space-y-4 text-center">
              <div className="bg-red-100 p-4 rounded-lg border border-red-200 text-sm text-red-900">
                  <p className="font-black mb-2">VOCÊ ESTÁ PRESTES A APAGAR TUDO.</p>
                  Clientes, contratos, extratos e logs serão destruídos permanentemente.
              </div>
              <div className="text-left">
                  <label className="block text-xs font-black text-slate-700 mb-2 uppercase">Para prosseguir, digite "CONFIRMAR":</label>
                  <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="w-full p-3 border border-red-200 rounded-xl outline-none focus:ring-2 focus:ring-red-500 font-bold" placeholder="CONFIRMAR" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setDangerModalOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl">Cancelar</button>
                <button onClick={handleFactoryReset} disabled={confirmText !== 'CONFIRMAR'} className={`flex-1 py-3 font-bold rounded-xl transition-all ${confirmText === 'CONFIRMAR' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>APAGAR TUDO</button>
              </div>
          </div>
      </Modal>
    </Layout>
  );
};

export default Settings;