import { useState, useEffect } from 'react';
import { Search, Calendar, Filter, FileText, User, Shield, AlertCircle, ChevronDown, RefreshCw, X, Database } from 'lucide-react';
import Layout from '../components/Layout';
import { historyService } from '../services/api';

interface Log {
  id: string;
  user: string;
  action: string;
  target: string;
  date: string; 
  rawDate: string;
  type: 'critical' | 'financial' | 'system' | 'client';
}

const History = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'Todos' | 'critical' | 'financial' | 'system' | 'client'>('Todos');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7days' | '30days'>('all'); 
  
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [showDateMenu, setShowDateMenu] = useState(false);
  const [logs, setLogs] = useState<Log[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const getCurrentUser = () => {
      try {
          const sessionStr = localStorage.getItem('lms_active_session');
          if (sessionStr) {
              const user = JSON.parse(sessionStr).user;
              if (user?.name) return user.name;
              if (user?.email) return user.email;
              if (user?.username) return user.username;
          }
          const userStr = localStorage.getItem('user');
          if (userStr) {
              const userObj = JSON.parse(userStr);
              if (userObj?.name) return userObj.name;
          }
          return 'Administrador Mestre'; 
      } catch (e) { return 'Administrador Mestre'; }
  };

  const determineLogType = (action: string, details: string): Log['type'] => {
    const text = (action + ' ' + details).toLowerCase();
    if (text.includes('erro') || text.includes('exclusão') || text.includes('deletado') || text.includes('crítica') || text.includes('bloqueio')) return 'critical';
    if (text.includes('pagamento') || text.includes('empréstimo') || text.includes('financeiro') || text.includes('contrato') || text.includes('baixa') || text.includes('acordo')) return 'financial';
    if (text.includes('cliente') || text.includes('cadastro') || text.includes('perfil')) return 'client';
    return 'system';
  };

  const formatDate = (isoString: string) => {
    try {
        const date = new Date(isoString);
        return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' às ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return isoString; }
  };

  const fetchAndGenerateLogs = async () => {
    setIsLoading(true);
    try {
      const currentUser = getCurrentUser();

      let backendLogs: any[] = [];
      try { backendLogs = await historyService.getLogs(); } catch (e) {}
      
      let localLogs: any[] = [];
      try { localLogs = JSON.parse(localStorage.getItem('lms_blackbox_logs') || '[]'); } catch (e) {}

      const mapLog = (l: any, isLocal: boolean): Log => {
          let actionName = l.action || 'Ação Desconhecida';
          let details = l.details || l.target || '';
          let userName = l.user;

          const text = (actionName + ' ' + details).toUpperCase();
          const isHumanAction = text.includes('NOVO') || text.includes('EMPRÉSTIMO') || 
                                text.includes('EXCLUSÃO') || text.includes('BAIXA') || 
                                text.includes('CLIENTE') || text.includes('ACORDO') || 
                                text.includes('EDIÇÃO') || text.includes('CONFIGURAÇÕES');

          if (!userName || userName === 'Sistema' || userName === '') {
              if (isHumanAction || isLocal) {
                  userName = currentUser; 
              } else {
                  userName = 'Sistema'; 
              }
          }

          return {
            id: l.id || Math.random().toString(),
            user: userName,
            action: actionName,
            target: details,
            date: formatDate(l.timestamp || new Date().toISOString()),
            rawDate: l.timestamp || new Date().toISOString(),
            type: determineLogType(actionName, details)
          };
      };

      const mappedLocal = localLogs.map((l: any) => mapLog(l, true));
      const mappedBackend = backendLogs.map((l: any) => mapLog(l, false));

      const uniqueLogs: Log[] = [];
      const localSignatures = new Set();
      
      for (const log of mappedLocal) {
          uniqueLogs.push(log);
          localSignatures.add(`${log.date}-${log.type}`);
      }

      for (const log of mappedBackend) {
          const sig = `${log.date}-${log.type}`;
          if (!localSignatures.has(sig)) {
              uniqueLogs.push(log);
              localSignatures.add(sig);
          }
      }

      uniqueLogs.sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());

      setLogs(uniqueLogs);
    } catch (err) {
      console.error(err);
    } finally {
        setIsLoading(false);
    }
  };

  useEffect(() => { fetchAndGenerateLogs(); }, []);

  const getIcon = (type: string) => {
    switch (type) {
      case 'critical': return <Shield size={16} className="text-red-500" />;
      case 'financial': return <FileText size={16} className="text-green-500" />;
      case 'client': return <User size={16} className="text-blue-500" />;
      default: return <Database size={16} className="text-slate-500" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'critical': return 'Segurança';
      case 'financial': return 'Financeiro';
      case 'system': return 'Sistema';
      case 'client': return 'Clientes';
      default: return type;
    }
  };

  const getDateLabel = (filter: string) => {
    switch (filter) {
      case 'today': return 'Apenas Hoje';
      case '7days': return 'Últimos 7 Dias';
      case '30days': return 'Últimos 30 Dias';
      default: return 'Todo o Período';
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.user.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.target.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesType = typeFilter === 'Todos' || log.type === typeFilter;

    let matchesDate = true;
    if (dateFilter !== 'all') {
        const logDate = new Date(log.date.split(' às ')[0].split('/').reverse().join('-')); 
        const today = new Date();
        today.setHours(0,0,0,0);
        
        if (dateFilter === 'today') {
            matchesDate = logDate.getTime() === today.getTime() || log.date.includes('Hoje');
        } else if (dateFilter === '7days') {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            matchesDate = logDate >= sevenDaysAgo;
        } else if (dateFilter === '30days') {
             const thirtyDaysAgo = new Date();
             thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
             matchesDate = logDate >= thirtyDaysAgo;
        }
    }

    return matchesSearch && matchesType && matchesDate;
  });

  return (
    <Layout>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Histórico de Atividades</h2>
          <p className="text-slate-500">Logs de auditoria, exclusões e rastreabilidade.</p>
        </div>
        
        <div className="flex gap-2">
            <button onClick={fetchAndGenerateLogs} className="p-2.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-slate-600 transition-all shadow-sm" title="Atualizar">
                <RefreshCw size={20} className={isLoading ? "animate-spin text-blue-600" : ""} />
            </button>

            <div className="relative">
            <button 
                onClick={() => setShowDateMenu(!showDateMenu)}
                className={`flex items-center gap-2 border px-4 py-2.5 rounded-lg text-sm font-bold transition-colors shadow-sm h-full
                ${showDateMenu || dateFilter !== 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-gray-200 text-slate-600 hover:bg-gray-50'}`}
            >
                <Calendar size={16} />
                {getDateLabel(dateFilter)}
                <ChevronDown size={14} />
            </button>

            {showDateMenu && (
                <div className="absolute right-0 top-12 w-48 bg-white border border-gray-100 rounded-xl shadow-xl z-20 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                {['all', 'today', '7days', '30days'].map((filter) => (
                    <button
                    key={filter}
                    onClick={() => { setDateFilter(filter as any); setShowDateMenu(false); }}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center justify-between
                        ${dateFilter === filter ? 'text-blue-600 font-bold bg-blue-50' : 'text-slate-600'}`}
                    >
                    {getDateLabel(filter)}
                    {dateFilter === filter && <div className="w-2 h-2 rounded-full bg-blue-600"></div>}
                    </button>
                ))}
                </div>
            )}
            </div>
        </div>
      </header>

      <div className="bg-white p-4 rounded-xl shadow-sm mb-6 flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar por usuário, exclusões ou contratos..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 font-bold text-slate-700 transition-all shadow-inner"
          />
        </div>
        
        <div className="relative">
          <button 
            onClick={() => setShowTypeMenu(!showTypeMenu)}
            className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-bold transition-colors w-full md:w-48 justify-between shadow-sm
              ${showTypeMenu || typeFilter !== 'Todos' ? 'border-slate-900 text-slate-900 bg-slate-50' : 'border-gray-200 text-slate-600 hover:bg-gray-50'}`}
          >
            <div className="flex items-center gap-2">
              <Filter size={16} />
              {typeFilter === 'Todos' ? 'Filtrar Tipo' : getTypeLabel(typeFilter)}
            </div>
            <ChevronDown size={14} />
          </button>

          {showTypeMenu && (
            <div className="absolute right-0 top-12 w-48 bg-white border border-gray-100 rounded-xl shadow-xl z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
              {['Todos', 'critical', 'financial', 'system', 'client'].map((type) => (
                <button
                  key={type}
                  onClick={() => { setTypeFilter(type as any); setShowTypeMenu(false); }}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 font-bold text-slate-600 flex items-center gap-2 border-b border-gray-50 last:border-0"
                >
                  {type !== 'Todos' && getIcon(type)}
                  {type === 'Todos' ? 'Todos os Tipos' : getTypeLabel(type)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-200 text-xs uppercase text-slate-500 font-black tracking-wider">
                <th className="p-4 w-16 text-center">Tipo</th>
                <th className="p-4 w-48">Data e Hora</th>
                <th className="p-4 w-48">Usuário Responsável</th>
                <th className="p-4 w-56">Ação Realizada</th>
                <th className="p-4">Alvo / Detalhes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredLogs.length > 0 ? (
                filteredLogs.map((log) => (
                  <tr key={log.id} className={`hover:bg-slate-50 transition-colors text-sm group ${log.type === 'critical' ? 'bg-red-50/20' : ''}`}>
                    <td className="p-4 text-center">
                      <div className="bg-white p-2 rounded-lg inline-flex items-center justify-center border border-gray-200 shadow-sm group-hover:scale-110 transition-transform">
                        {getIcon(log.type)}
                      </div>
                    </td>
                    <td className="p-4 text-slate-500 font-mono text-[11px] tracking-tight">
                      {log.date}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shadow-sm border ${log.user === 'Sistema' ? 'bg-slate-200 text-slate-500 border-slate-300' : 'bg-blue-100 text-blue-700 border-blue-200'}`}>
                            {log.user.charAt(0).toUpperCase()}
                        </div>
                        <span className={`font-bold ${log.user === 'Sistema' ? 'text-slate-500' : 'text-blue-900'}`}>{log.user}</span>
                      </div>
                    </td>
                    <td className={`p-4 font-black text-xs uppercase tracking-wider ${log.type === 'critical' ? 'text-red-700' : 'text-slate-800'}`}>
                      {log.action}
                    </td>
                    <td className="p-4 text-slate-600 font-medium">
                      {log.target}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="p-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-3">
                        <Search size={40} className="opacity-20" />
                        <p className="font-medium text-lg">Nenhuma atividade detectada.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
};

export default History;