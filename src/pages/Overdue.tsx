import { useState, useEffect } from 'react';
import { Search, Filter, AlertTriangle, Phone, MessageCircle, MoreHorizontal, ArrowUpRight, CheckCircle, Gavel, Ban, FileText, Clock, RefreshCw, Loader2 } from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
// IMPORTAÇÃO DA CALCULADORA CENTRAL (Lembre-se do .ts se o seu ambiente exigir)
import { calculateOverdueValue, formatMoney } from '../utils/finance';
import { loanService } from '../services/api';

interface Debtor {
  id: string;
  name: string;
  contract: string;
  days: number;
  amount: number;
  updatedAmount: number;
  phone: string;
  status: 'Crítico' | 'Recente' | 'Promessa de Pagamento';
  nextDue: string;
  fineRate?: number;
  moraInterestRate?: number;
}

// Whasapp API Integration
const sendWhatsappApi = async (name: string, phone: string, contract: string, lateDays: number, updatedAmount: number) => {
  const response = await fetch("http://localhost:8080/api/message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userconectado: "teste",
      phone: phone, 
      delay: 1200, // Opcional
      name: name,
      lateDays: lateDays,
      updatedAmount: updatedAmount,
    }),
  });

  if (!response.ok) {
    throw new Error("Falha ao enviar mensagem via API");
  }

  return response.json();
};

const Overdue = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'Todos' | 'Crítico' | 'Recente'>('Todos');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [isOptionsModalOpen, setIsOptionsModalOpen] = useState(false);
  
  const [selectedDebtor, setSelectedDebtor] = useState<Debtor | null>(null);
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadOverdueContracts();
  }, []);

  const loadOverdueContracts = async () => {
    setIsLoading(true);
    try {
      const contracts = await loanService.getAll();
      const today = new Date();
      today.setHours(0, 0, 0, 0); 
      
      const overdueList: Debtor[] = [];

      contracts.forEach((contract: any) => {
        const dueDate = new Date(contract.nextDue);
        dueDate.setMinutes(dueDate.getMinutes() + dueDate.getTimezoneOffset());

        if (dueDate < today && contract.status !== 'Pago') {
          const diffTime = Math.abs(today.getTime() - dueDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

          // --- LOGICA UNIFICADA E SNAPSHOT ---
          // Usa a calculadora central passando as taxas salvas no contrato
          const totalDevido = calculateOverdueValue(
            contract.installmentValue || 0,
            contract.nextDue,
            'Atrasado',
            contract.fineRate || 2,
            contract.moraInterestRate || 1
          );

          let status: 'Crítico' | 'Recente' = 'Recente';
          if (diffDays > 30) status = 'Crítico';

          overdueList.push({
            id: contract.id,
            name: contract.client,
            contract: `CTR-${contract.id.substring(0, 6).toUpperCase()}`,
            days: diffDays,
            amount: contract.installmentValue || 0,
            updatedAmount: totalDevido,
            phone: contract.phone || '(11)99027-7630', // Placeholder
            status: status,
            nextDue: contract.nextDue,
            fineRate: contract.fineRate,
            moraInterestRate: contract.moraInterestRate
          });
        }
      });
      
      setDebtors(overdueList);
    } catch (err) {
        console.error("Erro ao carregar contratos em atraso", err);
    }
    setIsLoading(false);
  };

  const filteredDebtors = debtors.filter(d => {
    const matchesSearch = d.name.toLowerCase().includes(searchTerm.toLowerCase()) || d.contract.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'Todos' || d.status === filterType;
    return matchesSearch && matchesFilter;
  });

  const handleWhatsApp = async (debtor: Debtor) => {
    
    try {
      await sendWhatsappApi(
        debtor.name,
        debtor.phone,
        debtor.contract,
        debtor.days,
        debtor.updatedAmount
      );

      console.log(
        "Enviando para nome: ",
        debtor.name,
        "\n contato: ",
        debtor.contract,
        "\n dias de atraso: ",
        debtor.days,
        "\n updatedAmount: ",
        debtor.updatedAmount,
        "\n phone: ",
        debtor.phone,
      );

      alert(`✅ Mensagem enviada com sucesso para ${debtor.name}!`);
    } catch (error) {
      const message = `Olá ${debtor.name}, somos da Credit Now.\n\nConsta em nosso sistema uma pendência referente ao contrato ${debtor.contract}.\n\n*Vencimento:* ${debtor.nextDue.split("-").reverse().join("/")}\n*Dias em atraso:* ${debtor.days}\n*Valor Atualizado:* ${formatMoney(debtor.updatedAmount)}\n\nPodemos negociar uma condição especial para regularização hoje?`;

      console.error(error);
      alert(
        "❌ Erro ao enviar mensagem pelo servidor. Tentando via link direto...",
      );

      // Fallback: Se a API falhar, abre o link tradicional do WhatsApp Web
      const url = `https://wa.me/${debtor.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
      window.open(url, "_blank");
    }
  };

  const handleRegisterAgreement = () => {
    if (selectedDebtor) {
      const updatedList = debtors.map(d => d.id === selectedDebtor.id ? { ...d, status: 'Promessa de Pagamento' as const } : d);
      setDebtors(updatedList);
      setIsModalOpen(false);
      alert(`✅ Acordo registrado para ${selectedDebtor.name}. Cobrança pausada.`);
    }
  };

  const totalOverdueSum = filteredDebtors.reduce((acc, curr) => acc + curr.updatedAmount, 0);

  return (
    <Layout>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            Gestão de Inadimplência
            <span className="bg-red-100 text-red-600 text-xs px-2 py-1 rounded-full font-bold">{debtors.length} Casos</span>
          </h2>
          <p className="text-slate-500">Recuperação de crédito e gestão de contratos em atraso.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={loadOverdueContracts} className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm font-medium text-slate-600 hover:bg-gray-50"><RefreshCw size={16} /></button>
          <button onClick={() => setFilterType(filterType === 'Todos' ? 'Crítico' : 'Todos')} className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium transition-colors ${filterType === 'Crítico' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-gray-200 text-slate-600 hover:bg-gray-50'}`}><Filter size={16} />{filterType === 'Crítico' ? 'Mostrando Críticos' : 'Filtrar por Gravidade'}</button>
          <button onClick={() => setIsRuleModalOpen(true)} className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition-colors shadow-lg shadow-red-500/20"><AlertTriangle size={16} />Régua de Cobrança</button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-gradient-to-br from-red-500 to-red-600 p-6 rounded-xl shadow-lg text-white">
          <div className="flex justify-between items-start mb-2"><span className="text-white/80 text-sm font-medium">Total em Atraso (Atualizado)</span><AlertTriangle size={20} className="text-white" /></div>
          <h3 className="text-3xl font-bold">{formatMoney(totalOverdueSum)}</h3>
          <p className="text-white/70 text-xs mt-1">Valores com multas e juros contratuais</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-2"><span className="text-slate-500 text-sm font-medium">Recuperado Hoje</span><ArrowUpRight size={20} className="text-green-500" /></div>
          <h3 className="text-2xl font-bold text-slate-800">R$ 0,00</h3>
          <div className="w-full bg-gray-100 rounded-full h-1.5 mt-3"><div className="bg-green-500 h-1.5 rounded-full" style={{ width: '0%' }}></div></div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-2"><span className="text-slate-500 text-sm font-medium">Eficiência de Contato</span><Phone size={20} className="text-blue-500" /></div>
          <h3 className="text-2xl font-bold text-slate-800">12%</h3>
          <p className="text-slate-400 text-xs mt-1 flex items-center gap-1"><Clock size={12} /> Melhor horário: 14h-16h</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm mb-6">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input type="text" placeholder="Buscar devedor por nome, contrato..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent" />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-slate-500 font-semibold">
              <th className="p-4">Devedor / Contrato</th>
              <th className="p-4">Dias em Atraso</th>
              <th className="p-4 text-right">Valor Parcela</th>
              <th className="p-4 text-right">Valor Atualizado (+Juros)</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Ações de Cobrança</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-500">Sincronizando valores...</td></tr>
            ) : filteredDebtors.length > 0 ? (
              filteredDebtors.map((debtor) => (
                <tr key={debtor.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="p-4">
                    <div className="font-bold text-slate-800">{debtor.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{debtor.contract}</div>
                  </td>
                  <td className="p-4"><span className="font-bold text-red-600">{debtor.days} dias</span></td>
                  <td className="p-4 text-slate-600 text-right">{formatMoney(debtor.amount)}</td>
                  <td className="p-4 font-bold text-slate-800 text-right">{formatMoney(debtor.updatedAmount)}</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${debtor.status === 'Crítico' ? 'bg-red-100 text-red-800' : debtor.status === 'Promessa de Pagamento' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {debtor.status}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => handleWhatsApp(debtor)} className="p-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors" title="WhatsApp"><MessageCircle size={18} /></button>
                      <button onClick={() => alert(`Ligando para ${debtor.name}...`)} className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors" title="Ligar"><Phone size={18} /></button>
                      <button onClick={() => { setSelectedDebtor(debtor); setIsModalOpen(true); }} className="p-2 bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 transition-colors" title="Acordo"><CheckCircle size={18} /></button>
                      <button onClick={() => { setSelectedDebtor(debtor); setIsOptionsModalOpen(true); }} className="p-2 hover:bg-gray-100 text-slate-400 rounded-lg" title="Opções"><MoreHorizontal size={18} /></button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={6} className="p-12 text-center text-slate-500"><CheckCircle size={48} className="text-green-500 mx-auto mb-2 opacity-30"/><p>Nenhum contrato em atraso!</p></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* MODAIS (MANTIDAS COMO ANTERIORMENTE) */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Registrar Acordo">
        <div className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-100"><h4 className="font-bold text-blue-900 mb-1">Cliente: {selectedDebtor?.name}</h4><p className="text-sm text-blue-700">O status mudará para "Promessa de Pagamento".</p></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Data Prevista</label><input type="date" className="w-full p-2 border border-gray-300 rounded-lg" /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Observações</label><textarea className="w-full p-2 border border-gray-300 rounded-lg h-24" placeholder="Ex: Cliente vai pagar via PIX amanhã..."></textarea></div>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
             <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-gray-100 rounded-lg font-medium">Cancelar</button>
            <button onClick={handleRegisterAgreement} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center gap-2"><CheckCircle size={18} /> Confirmar Acordo</button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isRuleModalOpen} onClose={() => setIsRuleModalOpen(false)} title="Régua de Cobrança">
        <div className="relative border-l-2 border-gray-200 ml-4 space-y-8 py-2">
          <div className="relative pl-8"><span className="absolute -left-[9px] top-0 bg-green-500 h-4 w-4 rounded-full border-2 border-white shadow"></span><h4 className="font-bold text-slate-800">Dia 1: Lembrete Amigável</h4><p className="text-sm text-slate-500">Envio automático de SMS e E-mail.</p></div>
          <div className="relative pl-8"><span className="absolute -left-[9px] top-0 bg-blue-500 h-4 w-4 rounded-full border-2 border-white shadow"></span><h4 className="font-bold text-slate-800">Dia 5: Contato Telefônico</h4><p className="text-sm text-slate-500">O cliente entra na fila de discagem.</p></div>
          <div className="relative pl-8"><span className="absolute -left-[9px] top-0 bg-red-600 h-4 w-4 rounded-full border-2 border-white shadow"></span><h4 className="font-bold text-slate-800">Dia 30: Negativação (SPC)</h4><p className="text-sm text-slate-500">Envio automático para órgãos de proteção ao crédito.</p></div>
        </div>
      </Modal>

      <Modal isOpen={isOptionsModalOpen} onClose={() => setIsOptionsModalOpen(false)} title={`Ações para ${selectedDebtor?.name}`}>
        <div className="grid gap-3">
          <button className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 text-left"><div className="p-2 bg-blue-50 text-blue-600 rounded"><FileText size={20} /></div><div><h4 className="font-bold text-slate-800">Ver Contrato</h4><p className="text-xs text-slate-500">Visualizar PDF.</p></div></button>
          <button className="flex items-center gap-3 p-4 border border-red-200 bg-red-50/50 rounded-lg hover:bg-red-50 text-left"><div className="p-2 bg-red-100 text-red-600 rounded"><Ban size={20} /></div><div><h4 className="font-bold text-red-800">Negativar (SPC)</h4><p className="text-xs text-red-600">Restrição externa.</p></div></button>
        </div>
      </Modal>
    </Layout>
  );
};

export default Overdue;