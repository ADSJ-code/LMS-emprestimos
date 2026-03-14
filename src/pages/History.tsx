import { useState, useEffect } from 'react';
import { 
  Search, Calendar, Filter, FileText, User, Shield, AlertCircle, 
  ChevronDown, RefreshCw, X, Database, ArrowLeftRight, Trash2, 
  UserPlus, LogIn, Settings, BadgePercent 
} from 'lucide-react';
import Layout from '../components/Layout';
import { historyService } from '../services/api';

interface Log {
  id: string;
  user: string;
  action: string;
  target: string;
  date: string; 
  rawDate: string;
  type: 'critical' | 'financial' | 'system' | 'client' | 'agreement' | 'undo';
}

const History = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'Todos' | 'critical' | 'financial' | 'system' | 'client' | 'agreement' | 'undo'>('Todos');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7days' | '30days'>('all'); 
  
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [showDateMenu, setShowDateMenu] = useState(false);
  const [logs, setLogs] = useState<Log[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Determina a categoria exata com base no texto da ação e detalhes
  const determineLogType = (action: string, details: string): Log['type'] => {
    const text = (action + ' ' + details).toLowerCase();
    
    if (text.includes('exclusão') || text.includes('deletado') || text.includes('crítica') || text.includes('bloqueio')) return 'critical';
    if (text.includes('acordo')) return 'agreement';
    if (text.includes('desfazer') || text.includes('estorno') || text.includes('reversão')) return 'undo';
    if (text.includes('baixa') || text.includes('pagamento') || text.includes('parcela') || text.includes('juros')) return 'financial';
    if (text.includes('cliente') || text.includes('cadastro')) return 'client';
    
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
      let backendLogs: any[] = [];
      try { backendLogs = await historyService.getLogs(); } catch (e) {}
      
      let localLogs: any[] = [];
      try { localLogs = JSON.parse(localStorage.getItem('lms_blackbox_logs') || '[]'); } catch (e) {}

      const mapLog = (l: any): Log => {
          const actionName = l.action || 'Ação Desconhecida';
          const details = l.details || l.target || '';
          
          return {
            id: l.id || Math.random().toString(),
            user: l.user || 'Sistema',
            action: actionName,
            target: details,
            date: formatDate(l.timestamp || new Date().toISOString()),
            rawDate: l.timestamp || new Date().toISOString(),
            type: determineLogType(actionName, details)
          };
      };

      const mappedLocal = localLogs.map((l: any) => mapLog(l));
      const mappedBackend = backendLogs.map((l: any) => mapLog(l));

      const uniqueLogs: Log[] = [];
      const signatures = new Set();
      
      [...mappedLocal, ...mappedBackend].forEach(log => {
          const sig = `${log.rawDate}-${log.action}-${log.target}`;
          if (!signatures.has(sig)) {
              uniqueLogs.push(log);
              signatures.add(sig);
          }
      });

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
      case 'critical': return <Trash2 size={16} className="text-red-500" />;
      case 'financial': return <FileText size={16} className="text-green-500" />;
      case 'agreement': return <BadgePercent size={16} className="text-orange-500" />;
      case 'undo': return <ArrowLeftRight size={16} className="text-purple-500" />;
      case 'client': return <UserPlus size={16} className="text-blue-500" />;
      case 'system': return <Settings size={16} className="text-slate-500" />;
      default: return <Database size={16} className="text-slate-500" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'critical': return 'Exclusão/Segurança';
      case 'financial': return 'Baixas/Financeiro';
      case 'agreement': return 'Acordos';
      case 'undo': return 'Estornos/Reversão';
      case 'system': return 'Sistema/Acesso';
      case 'client': return 'Cadastros';
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
        const logDate = new Date(log.rawDate);
        const today = new Date();
        today.setHours(0,0,0,0);
        
        if (dateFilter === 'today') {
            matchesDate = logDate.getTime() >= today.getTime();
        } else if (dateFilter === '7days') {
            const limit = new Date();
            limit.setDate(limit.getDate() - 7);
            matchesDate = logDate >= limit;
        } else if (dateFilter === '30days') {
             const limit = new Date();
             limit.setDate(limit.getDate() - 30);
             matchesDate = logDate >= limit;
        }
    }

    return matchesSearch && matchesType && matchesDate;
  });

  return (
    <Layout>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Histórico de Atividades</h2>
          <p className="text-slate-500">Rastreabilidade total: quem fez, o que fez e quando fez.</p>
        </div>
        
        <div className="flex gap-2">
            <button onClick={fetchAndGenerateLogs} className="p-2.5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 text-slate-600 transition-all shadow-sm group" title="Atualizar">
                <RefreshCw size={20} className={`${isLoading ? "animate-spin text-blue-600" : "group-hover:rotate-180"} transition-all duration-500`} />
            </button>

            <div className="relative">
            <button 
                onClick={() => setShowDateMenu(!showDateMenu)}
                className={`flex items-center gap-2 border px-4 py-2.5 rounded-xl text-sm font-bold transition-colors shadow-sm h-full
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

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-6 flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar por usuário, cliente ou tipo de ação..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 font-bold text-slate-700 transition-all shadow-inner bg-slate-50/30"
          />
        </div>
        
        <div className="relative">
          <button 
            onClick={() => setShowTypeMenu(!showTypeMenu)}
            className={`flex items-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-bold transition-colors w-full md:w-56 justify-between shadow-sm
              ${showTypeMenu || typeFilter !== 'Todos' ? 'border-slate-900 text-slate-900 bg-slate-50' : 'border-gray-200 text-slate-600 hover:bg-gray-50'}`}
          >
            <div className="flex items-center gap-2">
              <Filter size={16} />
              {typeFilter === 'Todos' ? 'Todas as Categorias' : getTypeLabel(typeFilter)}
            </div>
            <ChevronDown size={14} />
          </button>

          {showTypeMenu && (
            <div className="absolute right-0 top-12 w-56 bg-white border border-gray-100 rounded-xl shadow-xl z-10 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
              {['Todos', 'critical', 'financial', 'agreement', 'undo', 'client', 'system'].map((type) => (
                <button
                  key={type}
                  onClick={() => { setTypeFilter(type as any); setShowTypeMenu(false); }}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 font-bold text-slate-600 flex items-center gap-2 border-b border-gray-50 last:border-0"
                >
                  {type !== 'Todos' && getIcon(type)}
                  {type === 'Todos' ? 'Todas as Categorias' : getTypeLabel(type)}
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
              <tr className="bg-slate-50/80 border-b border-gray-200 text-[10px] uppercase text-slate-500 font-black tracking-widest">
                <th className="p-4 w-16 text-center">Cat.</th>
                <th className="p-4 w-44">Data e Hora</th>
                <th className="p-4 w-56">Responsável</th>
                <th className="p-4 w-60">Operação</th>
                <th className="p-4">Alvo / Detalhes do Registro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredLogs.length > 0 ? (
                filteredLogs.map((log) => (
                  <tr key={log.id} className={`hover:bg-slate-50/80 transition-colors text-sm group ${log.type === 'critical' ? 'bg-red-50/10' : log.type === 'undo' ? 'bg-purple-50/10' : ''}`}>
                    <td className="p-4 text-center">
                      <div className="bg-white p-2 rounded-xl inline-flex items-center justify-center border border-slate-100 shadow-sm group-hover:scale-110 transition-transform">
                        {getIcon(log.type)}
                      </div>
                    </td>
                    <td className="p-4 text-slate-500 font-mono text-[11px] tracking-tight">
                      {log.date}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black shadow-sm border ${log.user === 'Sistema' ? 'bg-slate-200 text-slate-500 border-slate-300' : 'bg-blue-600 text-white border-blue-700'}`}>
                            {log.user.charAt(0).toUpperCase()}
                        </div>
                        <span className={`font-bold ${log.user === 'Sistema' ? 'text-slate-400 italic' : 'text-slate-700'}`}>{log.user}</span>
                      </div>
                    </td>
                    <td className="p-4">
                        <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-tighter border ${
                            log.type === 'critical' ? 'bg-red-100 text-red-700 border-red-200' :
                            log.type === 'undo' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                            log.type === 'agreement' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                            log.type === 'financial' ? 'bg-green-100 text-green-700 border-green-200' :
                            'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                            {log.action}
                        </span>
                    </td>
                    <td className="p-4">
                      <p className="text-slate-600 font-medium leading-relaxed max-w-2xl">
                          {log.target}
                      </p>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="p-20 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-3">
                        <Search size={48} className="opacity-10" />
                        <p className="font-bold text-lg text-slate-300">Nenhum log encontrado para este filtro.</p>
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