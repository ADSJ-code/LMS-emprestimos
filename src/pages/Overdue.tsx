import { useState, useEffect } from 'react';
import { 
  Search, AlertTriangle, Phone, Calendar, ArrowRight, 
  DollarSign, RefreshCw, Filter, MessageCircle, Send
} from 'lucide-react';
import Layout from '../components/Layout';
import { loanService, clientService, Loan, Client } from '../services/api'; // Adicionado clientService e Client
import { calculateOverdueValue, formatMoney } from '../utils/finance';

const Overdue = () => {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [clients, setClients] = useState<Client[]>([]); // Novo estado para clientes
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Métricas do Dashboard
  const [metrics, setMetrics] = useState({
    totalOverdue: 0,
    recoveredToday: 0,
    efficiency: 0,
    count: 0
  });

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Buscamos Clientes e Empréstimos em paralelo para cruzar o telefone
      const [loansData, clientsData] = await Promise.all([
          loanService.getAll(),
          clientService.getAll()
      ]);
      setLoans(loansData || []);
      setClients(clientsData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- FUNÇÃO DO WHATSAPP (PREPARADA) ---
  const handleWhatsApp = (loan: Loan, updatedValue: number) => {
      // 1. Acha o cliente dono do empréstimo para pegar o telefone
      const client = clients.find(c => c.name === loan.client);
      
      if (!client || !client.phone) {
          alert("❌ Erro: Telefone do cliente não encontrado no cadastro.");
          return;
      }

      // 2. Limpa o telefone (remove ( ) - e espaços)
      const cleanPhone = client.phone.replace(/\D/g, '');
      
      // Validação básica de número brasileiro (com ou sem 9)
      if (cleanPhone.length < 10 || cleanPhone.length > 11) {
          alert("⚠️ O número de telefone parece inválido.");
          return;
      }

      // 3. Monta a Mensagem Personalizada
      const firstName = loan.client.split(' ')[0];
      const message = `Olá ${firstName}, identificamos uma pendência no valor atualizado de R$ ${formatMoney(updatedValue)} referente ao seu contrato. Podemos agendar o pagamento para regularizar?`;

      // 4. LÓGICA DE ENVIO
      
      // --- OPÇÃO A: API AUTOMÁTICA (DESATIVADO - FUTURO) ---
      /*
      try {
          await api.post('/integrations/whatsapp/send', {
              number: `55${cleanPhone}`,
              message: message
          });
          alert("Mensagem enviada para a fila de disparo!");
      } catch (e) {
          alert("Erro na API de WhatsApp");
      }
      */

      // --- OPÇÃO B: LINK DIRETO (ATIVO - OPERAÇÃO MANUAL) ---
      // Isso abre o WhatsApp Web ou App com a mensagem pronta, o operador só aperta enviar.
      const url = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
  };

  // --- LÓGICA DE CÁLCULO DAS MÉTRICAS ---
  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); 

    let sumOverdue = 0;
    let sumRecoveredToday = 0;
    let overdueCount = 0;
    let payingCount = 0;

    loans.forEach(loan => {
      const dueDate = new Date(loan.nextDue);
      dueDate.setMinutes(dueDate.getMinutes() + dueDate.getTimezoneOffset());
      dueDate.setHours(0, 0, 0, 0);

      const isOverdue = dueDate < today && loan.status !== 'Pago';

      if (isOverdue) {
        const value = calculateOverdueValue(
            loan.installmentValue, 
            loan.nextDue, 
            'Atrasado', 
            loan.fineRate || 2, 
            loan.moraInterestRate || 1
        );
        sumOverdue += value;
        overdueCount++;
      }

      if (loan.history && loan.history.length > 0) {
        loan.history.forEach(record => {
            const payDate = new Date(record.date);
            payDate.setMinutes(payDate.getMinutes() + payDate.getTimezoneOffset());

            const type = record.type ? record.type.toLowerCase() : '';
            if (type.includes('abertura') || type.includes('empréstimo') || type.includes('contrato')) {
                return;
            }

            if (
                payDate.getDate() === today.getDate() &&
                payDate.getMonth() === today.getMonth() &&
                payDate.getFullYear() === today.getFullYear()
            ) {
                sumRecoveredToday += record.amount;
                payingCount++; 
            }
        });
      }
    });

    const eff = overdueCount > 0 ? Math.round((payingCount / (overdueCount + payingCount)) * 100) : (sumRecoveredToday > 0 ? 100 : 0);

    setMetrics({
        totalOverdue: sumOverdue,
        recoveredToday: sumRecoveredToday,
        efficiency: eff,
        count: overdueCount
    });

  }, [loans]);

  const filteredOverdue = loans.filter(l => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const dueDate = new Date(l.nextDue);
    dueDate.setMinutes(dueDate.getMinutes() + dueDate.getTimezoneOffset());
    
    const isOverdue = dueDate < today && l.status !== 'Pago';
    const matchesSearch = (l.client || '').toLowerCase().includes(searchTerm.toLowerCase());

    return isOverdue && matchesSearch;
  });

  return (
    <Layout>
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Cobrança de Inadimplentes</h2>
          <p className="text-slate-500">Gestão de contratos em atraso e recuperação.</p>
        </div>
        <button 
            onClick={fetchData} 
            className="flex items-center gap-2 bg-white border border-gray-200 text-slate-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors shadow-sm font-bold"
        >
            <RefreshCw className={isLoading ? "animate-spin" : ""} size={18} /> Atualizar
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-red-50 p-6 rounded-2xl border border-red-100 shadow-sm relative overflow-hidden">
            <div className="flex justify-between items-start mb-2">
                <span className="text-red-600 font-bold text-sm uppercase tracking-wider">Total em Atraso (Atualizado)</span>
                <AlertTriangle className="text-red-500" size={24} />
            </div>
            <h3 className="text-3xl font-black text-slate-800">R$ {formatMoney(metrics.totalOverdue)}</h3>
            <p className="text-xs text-red-400 mt-1">Valores com multas e juros contratuais</p>
        </div>

        <div className="bg-green-50 p-6 rounded-2xl border border-green-100 shadow-sm">
            <div className="flex justify-between items-start mb-2">
                <span className="text-green-700 font-bold text-sm uppercase tracking-wider">Recuperado Hoje</span>
                <DollarSign className="text-green-600" size={24} />
            </div>
            <h3 className="text-3xl font-black text-slate-800">R$ {formatMoney(metrics.recoveredToday)}</h3>
            <p className="text-xs text-green-600 mt-1">Baixas realizadas em {new Date().toLocaleDateString('pt-BR')}</p>
        </div>

        <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 shadow-sm">
            <div className="flex justify-between items-start mb-2">
                <span className="text-blue-700 font-bold text-sm uppercase tracking-wider">Eficiência de Contato</span>
                <MessageCircle className="text-blue-600" size={24} />
            </div>
            <h3 className="text-3xl font-black text-slate-800">{metrics.efficiency}%</h3>
            <div className="w-full bg-blue-200 rounded-full h-1.5 mt-3">
                <div className="bg-blue-600 h-1.5 rounded-full transition-all" style={{ width: `${metrics.efficiency}%` }}></div>
            </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-50 bg-slate-50/30 flex justify-between items-center">
            <div className="relative w-96">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                    type="text" 
                    placeholder="Buscar cliente inadimplente..." 
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-slate-900/5 transition-all"
                />
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
                <Filter size={16}/>
                <span className="font-bold">{filteredOverdue.length}</span> contratos críticos
            </div>
        </div>

        <table className="w-full text-left">
            <thead>
                <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                    <th className="p-4">Cliente / Contrato</th>
                    <th className="p-4">Vencimento Original</th>
                    <th className="p-4">Dias em Atraso</th>
                    <th className="p-4 text-right">Valor Original</th>
                    <th className="p-4 text-right">Valor Atualizado</th>
                    <th className="p-4 text-center">Ação</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
                {filteredOverdue.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-slate-400 italic">Nenhum contrato em atraso no momento.</td></tr>
                ) : (
                    filteredOverdue.map(loan => {
                        const dueDate = new Date(loan.nextDue);
                        dueDate.setMinutes(dueDate.getMinutes() + dueDate.getTimezoneOffset());
                        const today = new Date();
                        today.setHours(0,0,0,0);
                        const diffTime = Math.abs(today.getTime() - dueDate.getTime());
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        const updatedValue = calculateOverdueValue(loan.installmentValue, loan.nextDue, 'Atrasado', loan.fineRate || 2, loan.moraInterestRate || 1);

                        return (
                            <tr key={loan.id} className="hover:bg-red-50/30 transition-colors group">
                                <td className="p-4">
                                    <div className="font-bold text-slate-800">{loan.client}</div>
                                    <div className="text-[10px] text-slate-400 font-mono">ID: {loan.id}</div>
                                </td>
                                <td className="p-4 flex items-center gap-2 text-red-600 font-bold text-sm">
                                    <Calendar size={14}/>
                                    {dueDate.toLocaleDateString('pt-BR')}
                                </td>
                                <td className="p-4">
                                    <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold border border-red-200">
                                        {diffDays} dias
                                    </span>
                                </td>
                                <td className="p-4 text-right text-slate-500">
                                    R$ {formatMoney(loan.installmentValue)}
                                </td>
                                <td className="p-4 text-right font-black text-slate-800 text-lg">
                                    R$ {formatMoney(updatedValue)}
                                </td>
                                <td className="p-4 text-center">
                                    {/* BOTÃO WHATSAPP CONECTADO */}
                                    <button 
                                        onClick={() => handleWhatsApp(loan, updatedValue)}
                                        className="text-green-600 hover:bg-green-100 hover:text-green-800 p-2 rounded-lg transition-all flex items-center justify-center gap-2 w-full font-bold text-xs border border-green-200 shadow-sm"
                                        title="Enviar mensagem de cobrança"
                                    >
                                        <Phone size={14}/> WhatsApp
                                    </button>
                                </td>
                            </tr>
                        );
                    })
                )}
            </tbody>
        </table>
      </div>
    </Layout>
  );
};

export default Overdue;