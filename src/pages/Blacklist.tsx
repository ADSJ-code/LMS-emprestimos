import { useState, useEffect } from 'react';
import { Search, ShieldAlert, Ban, FileWarning, Edit, AlertCircle, CheckCircle, Unlock } from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { blacklistService } from '../services/api';

interface BlockedUser {
  id: string;
  name: string;
  cpf: string;
  reason: string;
  date: string;
  riskLevel: 'Alto' | 'Médio' | 'Baixo';
  notes?: string;
}

const Blacklist = () => {
  const [isModalOpen, setIsModalOpen] = useState(false); 
  const [isUnblockModalOpen, setIsUnblockModalOpen] = useState(false); 

  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedUserForUnblock, setSelectedUserForUnblock] = useState<BlockedUser | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);

  useEffect(() => {
    const fetchBlacklist = async () => {
      try {
        const data = await blacklistService.getAll();
        setBlockedUsers(data as any);
      } catch (err) {
        console.error('Failed to fetch blacklist', err);
      }
    };
    fetchBlacklist();
  }, []);

  const [formData, setFormData] = useState({
    name: '', cpf: '', reason: 'Fraude Documental', riskLevel: 'Alto', notes: ''
  });
  
  const [unblockReason, setUnblockReason] = useState('');

  const filteredUsers = blockedUsers.filter(user => 
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.cpf.includes(searchTerm)
  );

  const handleEdit = (user: BlockedUser) => {
    setFormData({
      name: user.name,
      cpf: user.cpf,
      reason: user.reason,
      riskLevel: user.riskLevel,
      notes: user.notes || ''
    });
    setEditingId(user.id);
    setIsModalOpen(true);
  };

  const handleNew = () => {
    setFormData({ name: '', cpf: '', reason: 'Fraude Documental', riskLevel: 'Alto', notes: '' });
    setEditingId(null);
    setIsModalOpen(true);
  };

  const handleOpenUnblock = (user: BlockedUser) => {
    setSelectedUserForUnblock(user);
    setUnblockReason(''); 
    setIsUnblockModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        const updatedUser: any = {
          name: formData.name,
          cpf: formData.cpf,
          reason: formData.reason,
          riskLevel: formData.riskLevel as any,
          notes: formData.notes
        };
        await blacklistService.update(editingId, updatedUser);
        setBlockedUsers(blockedUsers.map(u => u.id === editingId ? { ...u, ...updatedUser } : u));
        alert(`✅ Registro atualizado para ${formData.name}.`);
      } else {
        const newUser: any = {
          name: formData.name,
          cpf: formData.cpf,
          reason: formData.reason,
          riskLevel: formData.riskLevel as any,
          date: new Date().toLocaleDateString('pt-BR'),
          notes: formData.notes
        };
        const saved = await blacklistService.create(newUser);
        setBlockedUsers([saved as any, ...blockedUsers]);
        alert(`⛔ BLOQUEIO CONFIRMADO\n\nO documento ${newUser.cpf} foi inserido na base.`);
      }
      setIsModalOpen(false);
    } catch (err) {
      alert('Falha ao salvar bloqueio.');
    }
  };

  const handleConfirmUnblock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUserForUnblock) {
      try {
        await blacklistService.delete(selectedUserForUnblock.id);
        setBlockedUsers(blockedUsers.filter(u => u.id !== selectedUserForUnblock.id));
        setIsUnblockModalOpen(false);

        alert(`🔓 DESBLOQUEIO REALIZADO COM SUCESSO\n\nUsuário: ${selectedUserForUnblock.name}\nMotivo: ${unblockReason}\n\nO CPF está liberado para novas consultas.`);
      } catch (err) {
        alert('Falha ao realizar desbloqueio.');
      }
    }
  };

  return (
    <Layout>
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <ShieldAlert className="text-red-600" size={28} />
            Lista Negra e Restrições
          </h2>
          <p className="text-slate-500">Gestão de CPFs e CNPJs bloqueados para novos créditos.</p>
        </div>
        <button 
          onClick={handleNew}
          className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition-colors shadow-lg shadow-red-900/20"
        >
          <Ban size={16} />
          Bloquear Novo CPF
        </button>
      </header>

      <div className="bg-red-50 border border-red-100 p-4 rounded-xl mb-6 flex items-start gap-3">
        <FileWarning className="text-red-500 mt-1" size={24} />
        <div>
          <h4 className="font-bold text-red-800">Atenção Operacional</h4>
          <p className="text-sm text-red-700">Clientes nesta lista são bloqueados automaticamente pelo sistema ao tentar simular um novo empréstimo. A remoção exige aprovação da diretoria.</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm mb-6">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Consultar CPF ou CNPJ na base de risco..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-slate-500 font-semibold">
              <th className="p-4">Nome / Razão Social</th>
              <th className="p-4">Documento</th>
              <th className="p-4">Motivo do Bloqueio</th>
              <th className="p-4">Data Inclusão</th>
              <th className="p-4">Risco</th>
              <th className="p-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredUsers.length > 0 ? (
              filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4 font-bold text-slate-800">{user.name}</td>
                  <td className="p-4 font-mono text-slate-600 bg-gray-50 rounded w-fit text-sm">{user.cpf}</td>
                  <td className="p-4 text-slate-600 max-w-xs truncate" title={user.reason}>{user.reason}</td>
                  <td className="p-4 text-slate-600">{user.date}</td>
                  <td className="p-4">
                    <span className={`text-xs font-bold px-2 py-1 rounded-full uppercase
                      ${user.riskLevel === 'Alto' ? 'bg-red-100 text-red-800' : 
                        user.riskLevel === 'Médio' ? 'bg-orange-100 text-orange-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {user.riskLevel}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => handleEdit(user)}
                        className="text-slate-400 hover:text-blue-600 p-2 hover:bg-blue-50 rounded-lg transition-colors" 
                        title="Editar Informações"
                      >
                        <Edit size={18} />
                      </button>
                      <button 
                        onClick={() => handleOpenUnblock(user)}
                        className="text-slate-400 hover:text-green-600 p-2 hover:bg-green-50 rounded-lg transition-colors" 
                        title="Realizar Desbloqueio"
                      >
                        <Unlock size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  Nenhum registro encontrado na lista negra.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        title={editingId ? "Editar Bloqueio Existente" : "Registrar Novo Bloqueio"}
      >
        <form onSubmit={handleSave} className="space-y-6">
          <div className={`border-l-4 p-4 ${editingId ? 'bg-blue-50 border-blue-400' : 'bg-yellow-50 border-yellow-400'}`}>
            <div className="flex gap-2">
              <AlertCircle size={20} className={editingId ? 'text-blue-600' : 'text-yellow-600'} />
              <p className={`text-xs ${editingId ? 'text-blue-800' : 'text-yellow-800'}`}>
                {editingId 
                  ? 'Você está alterando um registro legal. Todas as alterações ficam gravadas no histórico.' 
                  : 'Esta ação impedirá qualquer operação financeira para este documento em todas as filiais.'}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">CPF ou CNPJ</label>
            <input required type="text" value={formData.cpf} onChange={e => setFormData({...formData, cpf: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome Completo</label>
            <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Motivo</label>
              <select value={formData.reason} onChange={e => setFormData({...formData, reason: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 outline-none bg-white">
                <option value="Fraude Documental">Fraude Documental</option>
                <option value="Inadimplência Recorrente">Inadimplência Recorrente</option>
                <option value="Processo Judicial">Processo Judicial</option>
                <option value="Outros">Outros</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nível de Risco</label>
              <select value={formData.riskLevel} onChange={e => setFormData({...formData, riskLevel: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 outline-none bg-white">
                <option value="Alto">Alto</option>
                <option value="Médio">Médio</option>
                <option value="Baixo">Baixo</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Observações Internas</label>
            <textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 outline-none h-24"></textarea>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-gray-100 rounded-lg font-medium">Cancelar</button>
            <button type="submit" className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 flex items-center gap-2"><ShieldAlert size={18} /> {editingId ? 'Salvar' : 'Bloquear'}</button>
          </div>
        </form>
      </Modal>

      <Modal 
        isOpen={isUnblockModalOpen} 
        onClose={() => setIsUnblockModalOpen(false)}
        title="Realizar Desbloqueio de Documento"
      >
        <form onSubmit={handleConfirmUnblock} className="space-y-6">
          <div className="bg-green-50 border-l-4 border-green-500 p-4 flex gap-3">
             <CheckCircle className="text-green-600 flex-shrink-0" size={24} />
             <div>
               <h4 className="font-bold text-green-800">Liberar Crédito</h4>
               <p className="text-sm text-green-700">Esta ação irá remover <strong>{selectedUserForUnblock?.name}</strong> da Lista Negra e permitir novas operações imediatamente.</p>
             </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Motivo do Desbloqueio <span className="text-red-500">*</span></label>
            <select 
              required
              value={unblockReason}
              onChange={(e) => setUnblockReason(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none bg-white"
            >
              <option value="">Selecione um motivo...</option>
              <option value="Dívida Paga / Acordo Quitado">Dívida Paga / Acordo Quitado</option>
              <option value="Erro Operacional / Cadastro Indevido">Erro Operacional / Cadastro Indevido</option>
              <option value="Decisão Judicial (Liminar)">Decisão Judicial (Liminar)</option>
              <option value="Expiração do Prazo (5 anos)">Expiração do Prazo (5 anos)</option>
              <option value="Autorização Especial da Diretoria">Autorização Especial da Diretoria</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Justificativa / Protocolo</label>
            <textarea 
              required
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none h-24" 
              placeholder="Descreva o motivo ou insira o número do protocolo de atendimento..."
            ></textarea>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button 
              type="button"
              onClick={() => setIsUnblockModalOpen(false)}
              className="px-4 py-2 text-slate-600 hover:bg-gray-100 rounded-lg font-medium transition-colors"
            >
              Cancelar
            </button>
            <button 
              type="submit"
              className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              <Unlock size={18} />
              Confirmar Desbloqueio
            </button>
          </div>
        </form>
      </Modal>
    </Layout>
  );
};

export default Blacklist;