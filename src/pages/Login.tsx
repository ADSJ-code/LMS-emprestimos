import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Lock, Mail, ArrowRight, CheckCircle, Loader2, AlertCircle, ArrowLeft, PhoneCall } from 'lucide-react';
import { authService, settingsService } from '../services/api';

const Login = () => {
  const navigate = useNavigate();
  
  // Estados
  const [view, setView] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // ESTADO PARA NOME DA EMPRESA (Dinâmico)
  const [companyName, setCompanyName] = useState('Credit Now');
  const [initials, setInitials] = useState('CN');

  // 1. EFEITO: CARREGAR CONFIGURAÇÕES E "MANTER CONECTADO"
  useEffect(() => {
    // Carrega nome da empresa
    const loadSettings = async () => {
        try {
            const data = await settingsService.get();
            const legacyData = data as any;
            let name = 'Credit Now';
            
            if (data?.company?.name) name = data.company.name;
            else if (legacyData?.general?.companyName) name = legacyData.general.companyName;

            setCompanyName(name);
            setInitials(name.substring(0, 2).toUpperCase());
        } catch (e) { console.error('Erro ao carregar marca', e); }
    };
    loadSettings();

    // Carrega usuário lembrado
    const savedEmail = localStorage.getItem('lms_remember_user');
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  // 2. LÓGICA DE LOGIN
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    
    try {
      const response = await authService.login(email, password);

      const sessionData = JSON.stringify({
        token: response.token,
        user: response.user,
        loginTime: new Date().toISOString()
      });
      localStorage.setItem('lms_active_session', sessionData);

      // Lógica do "Manter Conectado"
      if (rememberMe) {
          localStorage.setItem('lms_remember_user', email);
      } else {
          localStorage.removeItem('lms_remember_user');
      }

      setIsLoading(false);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'E-mail ou senha incorretos.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 font-sans relative overflow-hidden">
      
      {/* Background Decorativo */}
      <div className="absolute inset-0 z-0 opacity-40">
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '32px 32px' }}></div>
      </div>
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
         <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-400/20 rounded-full blur-3xl"></div>
         <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-yellow-400/20 rounded-full blur-3xl"></div>
      </div>

      <div className="bg-white rounded-3xl shadow-2xl flex w-full max-w-5xl overflow-hidden min-h-[600px] animate-in fade-in zoom-in-95 duration-300 relative z-10">
        
        {/* LADO ESQUERDO (FORMULÁRIO) */}
        <div className="w-full md:w-1/2 flex flex-col justify-center p-8 md:p-12 relative transition-all">
          <div className="max-w-md mx-auto w-full space-y-6">
            
            <div className="text-left">
              <div className="inline-flex items-center gap-2 mb-6">
                <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-yellow-400 font-bold">{initials}</div>
                <span className="font-bold text-slate-900 text-lg tracking-tight">{companyName}</span>
              </div>
              
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">
                {view === 'login' ? 'Área Restrita' : 'Recuperar Acesso'}
              </h1>
              <p className="text-slate-500">
                {view === 'login' 
                  ? 'Acesso exclusivo para colaboradores autorizados.' 
                  : 'Instruções para redefinição de senha.'}
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-lg flex items-center gap-2 text-red-600 text-sm animate-in shake duration-300">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            {view === 'login' ? (
              /* --- FORMULÁRIO DE LOGIN --- */
              <form onSubmit={handleLogin} className="space-y-5 animate-in slide-in-from-left-4 duration-300">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">E-mail Corporativo</label>
                    <div className="relative group">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={20} />
                      <input 
                        type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                        className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all font-medium text-slate-700"
                        placeholder="usuario@creditnow.com"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Senha</label>
                    <div className="relative group">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={20} />
                      <input 
                        type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                        className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary outline-none transition-all font-medium text-slate-700"
                        placeholder="••••••••"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary" 
                    />
                    <span className="ml-2 text-sm text-slate-600 font-medium">Lembrar meu e-mail</span>
                  </label>
                  <button 
                    type="button" 
                    onClick={() => { setView('forgot'); setError(''); }}
                    className="text-sm font-bold text-primary hover:text-slate-800 transition-colors"
                  >
                    Esqueceu a senha?
                  </button>
                </div>

                <button 
                  type="submit" disabled={isLoading}
                  className="w-full group flex justify-center items-center gap-2 py-3.5 px-4 rounded-xl shadow-lg shadow-primary/30 text-base font-bold text-white bg-slate-900 hover:bg-slate-800 hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-70"
                >
                  {isLoading ? <><Loader2 className="animate-spin" /> Validando...</> : <>Entrar no Sistema <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" /></>}
                </button>
              </form>
            ) : (
              /* --- TELA DE "ESQUECI A SENHA" (INFORMATIVA) --- */
              <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                <div className="p-6 bg-blue-50 border border-blue-100 rounded-xl text-center">
                    <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-3">
                        <PhoneCall size={24} />
                    </div>
                    <h3 className="font-bold text-slate-800 mb-2">Contate o Administrador</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">
                        Este sistema opera em ambiente seguro local. Para redefinir sua senha, solicite diretamente ao <strong>Gestor do Sistema</strong>.
                    </p>
                </div>
                
                <button 
                  type="button" 
                  onClick={() => setView('login')}
                  className="w-full flex justify-center items-center gap-2 py-3 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors"
                >
                  <ArrowLeft size={16} /> Voltar para Login
                </button>
              </div>
            )}
          </div>
        </div>

        {/* LADO DIREITO (BANNER) */}
        <div className="hidden md:flex w-1/2 bg-slate-900 relative overflow-hidden flex-col justify-between p-12 text-white">
          <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-400 rounded-full blur-[100px] opacity-20 -mr-16 -mt-16 pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-600 rounded-full blur-[100px] opacity-30 -ml-16 -mb-16 pointer-events-none"></div>
          
          <div className="relative z-10 mt-10">
            <div className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center mb-8 border border-white/10 shadow-inner">
               <LogIn className="text-yellow-400" size={32} />
            </div>
            <h2 className="text-3xl font-bold leading-tight mb-4">Gestão de Crédito <br/>Alta Performance</h2>
            <p className="text-slate-400 text-lg leading-relaxed max-w-sm">
              Segurança e agilidade no controle de contratos e recuperação de crédito.
            </p>
          </div>

          <div className="relative z-10 space-y-4">
            <div className="flex items-center gap-3 text-sm font-medium text-slate-300">
              <CheckCircle size={18} className="text-green-400" />
              <span>Criptografia de dados locais</span>
            </div>
            <div className="flex items-center gap-3 text-sm font-medium text-slate-300">
              <CheckCircle size={18} className="text-green-400" />
              <span>Controle de acesso por operador</span>
            </div>
          </div>

          <p className="text-xs text-slate-600 font-mono relative z-10 mt-8">System v2.6.0</p>
        </div>

      </div>
    </div>
  );
};

export default Login;