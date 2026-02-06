import { useState, useEffect } from 'react';
import { Search, Share2, Plus, DollarSign, UserCheck, Save, Edit, Trash2 } from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { affiliateService } from '../services/api';

interface Affiliate {
  id: string;
  name: string;
  email: string;
  phone: string;
  code: string;
  referrals: number;
  commissionRate: number;
  earned: number;
  status: 'Ativo' | 'Pendente' | 'Inativo';
  pixKey: string;
}

const Affiliates = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);

  useEffect(() => {
    const fetchAffiliates = async () => {
      try {
        const data = await affiliateService.getAll();
        setAffiliates(data as any);
      } catch (err) {
        console.error('Failed to fetch affiliates', err);
      }
    };
    fetchAffiliates();
  }, []);

  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', commissionRate: '', pixKey: ''
  });

  const totalReferrals = affiliates.reduce((acc, curr) => acc + curr.referrals, 0);
  const totalPaid = affiliates.reduce((acc, curr) => acc + curr.earned, 0);
  const totalPending = totalPaid * 0.2; 

  const filteredAffiliates = affiliates.filter(aff => 
    aff.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    aff.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCopyLink = (code: string) => {
    const link = `https://creditnow.com.br/pedir-emprestimo?ref=${code}`;
    navigator.clipboard.writeText(link);
    alert(`🔗 Link copiado para a área de transferência!\n\n${link}`);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Tem certeza que deseja remover este parceiro?')) {
      try {
        await affiliateService.delete(id);
        setAffiliates(affiliates.filter(a => a.id !== id));
      } catch (err) {
        alert('Falha ao remover parceiro.');
      }
    }
  };

  const handleEdit = (aff: Affiliate) => {
    setFormData({
      name: aff.name,
      email: aff.email,
      phone: aff.phone,
      commissionRate: aff.commissionRate.toString(),
      pixKey: aff.pixKey
    });
    setEditingId(aff.id);
    setIsModalOpen(true);
  };

  const handleNew = () => {
    setFormData({ name: '', email: '', phone: '', commissionRate: '10', pixKey: '' });
    setEditingId(null);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (editingId) {
        const updatedAff: any = {
            name: formData.name,
            email: formData.email,
            phone: formData.phone,
            commissionRate: parseFloat(formData.commissionRate),
            pixKey: formData.pixKey
          };
          await affiliateService.update(editingId, updatedAff);
          setAffiliates(affiliates.map(a => a.id === editingId ? { ...a, ...updatedAff } : a));
          alert('Parceiro atualizado com sucesso!');
      } else {
        const codeName = formData.name.split(' ')[0].toUpperCase().substring(0, 4);
        const randomNum = Math.floor(Math.random() * 999);

        const newAffiliate: any = {
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          code: `REF-${codeName}-${randomNum}`,
          referrals: 0,
          commissionRate: parseFloat(formData.commissionRate),
          earned: 0.00,
          status: 'Ativo',
          pixKey: formData.pixKey
        };

        const saved = await affiliateService.create(newAffiliate);
        setAffiliates([saved as any, ...affiliates]);
        alert(`🎉 Parceiro criado!\nCódigo de indicação: ${newAffiliate.code}`);
      }
      setIsModalOpen(false);
    } catch (err) {
      alert('Falha ao salvar afiliado.');
    }
  };

  return (
    <Layout>
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            Gestão de Afiliados
          </h2>
          <p className="text-slate-500">Parceiros comerciais e controle de comissões.</p>
        </div>
        <button 
          onClick={handleNew}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/20"
        >
          <Plus size={16} />
          Novo Afiliado
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-primary">
          <div className="flex justify-between items-start mb-2">
            <span className="text-slate-500 text-sm font-medium">Total de Indicações</span>
            <UserCheck size={20} className="text-primary" />
          </div>
          <h3 className="text-2xl font-bold text-slate-800">{totalReferrals} Clientes</h3>
          <p className="text-slate-400 text-xs mt-1">Vindos de parceiros este mês</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-green-500">
          <div className="flex justify-between items-start mb-2">
            <span className="text-slate-500 text-sm font-medium">Comissões Pagas</span>
            <DollarSign size={20} className="text-green-500" />
          </div>
          <h3 className="text-2xl font-bold text-slate-800">R$ {totalPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-yellow-400">
          <div className="flex justify-between items-start mb-2">
            <span className="text-slate-500 text-sm font-medium">A Pagar (Pendente)</span>
            <DollarSign size={20} className="text-yellow-400" />
          </div>
          <h3 className="text-2xl font-bold text-slate-800">R$ {totalPending.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm mb-6">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar afiliado por nome ou código..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent input-focus"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-slate-500 font-semibold">
              <th className="p-4">Parceiro</th>
              <th className="p-4">Código Indicação</th>
              <th className="p-4">Performance</th>
              <th className="p-4">Comissão (%)</th>
              <th className="p-4">Total Gerado</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredAffiliates.map((affiliate) => (
              <tr key={affiliate.id} className="hover:bg-slate-50 transition-colors">
                <td className="p-4 font-medium text-slate-800">
                  {affiliate.name}
                  <div className="text-xs text-slate-400">{affiliate.email}</div>
                </td>
                <td className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="bg-slate-100 border border-slate-200 border-dashed px-3 py-1 rounded text-xs font-mono text-slate-700 font-bold tracking-wider select-all cursor-pointer hover:bg-white hover:border-primary transition-colors" onClick={() => handleCopyLink(affiliate.code)} title="Clique para copiar">
                        {affiliate.code}
                      </div>
                    </div>
                </td>
                <td className="p-4 text-slate-600">{affiliate.referrals} indicações</td>
                <td className="p-4 text-slate-800 font-bold">{affiliate.commissionRate}%</td>
                <td className="p-4 text-green-600 font-bold">R$ {affiliate.earned.toFixed(2)}</td>
                <td className="p-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                    ${affiliate.status === 'Ativo' ? 'bg-green-100 text-green-800' : 
                      affiliate.status === 'Pendente' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}`}>
                    {affiliate.status}
                  </span>
                </td>
                <td className="p-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button 
                      onClick={() => handleCopyLink(affiliate.code)} 
                      className="text-slate-400 hover:text-green-600 p-2 hover:bg-green-50 rounded-lg transition-colors" 
                      title="Copiar Link e Enviar"
                    >
                      <Share2 size={18} />
                    </button>
                    <button 
                      onClick={() => handleEdit(affiliate)} 
                      className="text-slate-400 hover:text-blue-600 p-2 hover:bg-blue-50 rounded-lg transition-colors" 
                      title="Editar Parceiro"
                    >
                      <Edit size={18} />
                    </button>
                    <button 
                      onClick={() => handleDelete(affiliate.id)} 
                      className="text-slate-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors" 
                      title="Remover"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredAffiliates.length === 0 && (
               <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">Nenhum afiliado encontrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        title={editingId ? "Editar Parceiro" : "Cadastrar Novo Parceiro"}
      >
        <form onSubmit={handleSave} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Parceiro / Empresa</label>
            <input 
              required
              type="text" 
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary outline-none" 
              placeholder="Ex: Consultoria ABC" 
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email de Contato</label>
              <input 
                required
                type="email" 
                value={formData.email}
                onChange={e => setFormData({...formData, email: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary outline-none" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Telefone / WhatsApp</label>
              <input 
                required
                type="text" 
                value={formData.phone}
                onChange={e => setFormData({...formData, phone: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary outline-none" 
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Comissão (%)</label>
              <input 
                required
                type="number" 
                step="0.1"
                value={formData.commissionRate}
                onChange={e => setFormData({...formData, commissionRate: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary outline-none" 
                placeholder="10" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Chave PIX</label>
              <input 
                required
                type="text" 
                value={formData.pixKey}
                onChange={e => setFormData({...formData, pixKey: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary outline-none" 
                placeholder="CPF, Email ou Aleatória" 
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button 
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 text-slate-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
            >
              Cancelar
            </button>
            <button 
              type="submit"
              className="px-4 py-2 bg-primary text-white rounded-lg font-medium hover:bg-slate-800 transition-colors flex items-center gap-2"
            >
              <Save size={18} />
              {editingId ? 'Salvar Alterações' : 'Criar Parceiro'}
            </button>
          </div>
        </form>
      </Modal>
    </Layout>
  );
};

export default Affiliates;