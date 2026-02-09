import React, { useState, useEffect } from 'react';
import { Search, ShieldAlert, Ban, FileWarning, Edit, AlertCircle, CheckCircle, Unlock, Plus, Trash2, AlertOctagon } from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal'; // Se não tiver esse componente, use o Modal simples interno
import { blacklistService } from '../services/api';

// --- COMPONENTE MODAL INTERNO (FALLBACK) ---
// Caso o import '../components/Modal' falhe, use este.
const SimpleModal = ({ isOpen, onClose, title, children }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

// --- MÁSCARA CPF/CNPJ ---
const maskCpfCnpj = (value: string) => {
  const v = value.replace(/\D/g, '');
  if (v.length <= 11) {
    return v.replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  } else {
    return v.replace(/^(\d{2})(\d)/, '$1.$2')
            .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
            .replace(/\.(\d{3})(\d)/, '.$1/$2')
            .replace(/(\d{4})(\d)/, '$1-$2')
            .slice(0, 18);
  }
};

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
  const [isLoading, setIsLoading] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedUserForUnblock, setSelectedUserForUnblock] = useState<BlockedUser | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);

  // Estado do Formulário
  const [formData, setFormData] = useState({
    name: '', cpf: '', reason: 'Fraude Documental', riskLevel: 'Alto', notes: ''
  });
  
  const [unblockReason, setUnblockReason] = useState('');

  useEffect(() => {
    fetchBlacklist();
  }, []);

  const fetchBlacklist = async () => {
    try {
      const data = await blacklistService.getAll();
      setBlockedUsers(data as any);
    } catch (err) {
      console.error('Failed to fetch blacklist', err);
    }
  };

  const filteredUsers = blockedUsers.filter(user => 
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.cpf.includes(searchTerm)
  );

  const handleEdit = (user: BlockedUser) => {
    setFormData({
      name: user.name,
      cpf: user.cpf,
      reason: user.reason,
      riskLevel: user.riskLevel as string,
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
    if (!formData.cpf || !formData.name) return alert("Preencha os campos obrigatórios.");
    
    setIsLoading(true);
    try {
      if (editingId) {
        const updatedUser: any = {
          ...formData,
          riskLevel: formData.riskLevel as any
        };
        await blacklistService.update(editingId, updatedUser);
        alert(`✅ Registro atualizado para ${formData.name}.`);
      } else {
        const newUser: any = {
          ...formData,
          riskLevel: formData.riskLevel as any,
          date: new Date().toLocaleDateString('pt-BR')
        };
        await blacklistService.create(newUser);
        alert(`⛔ BLOQUEIO CONFIRMADO\n\nO documento ${newUser.cpf} foi inserido na base de risco.`);
      }
      setIsModalOpen(false);
      fetchBlacklist();
    } catch (err: any) {
      alert('Falha ao salvar: ' + (err.response?.data || err.message));
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmUnblock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUserForUnblock) {
      try {
        await blacklistService.delete(selectedUserForUnblock.id);
        setIsUnblockModalOpen(false);
        fetchBlacklist();
        alert(`🔓 DESBLOQUEIO REALIZADO\n\nO CPF de ${selectedUserForUnblock.name} foi removido da lista.`);
      } catch (err) {
        alert('Falha ao realizar desbloqueio.');
      }
    }
  };

  // Se o componente Modal externo existir, use-o. Senão, use o SimpleModal.
  const ModalComponent = (typeof Modal !== 'undefined') ? Modal : SimpleModal;

  return (
    <Layout>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <ShieldAlert className="text-red-600" size={28} />
            Lista Negra e Restrições
          </h2>
          <p className="text-slate-500">Gestão de CPFs e CNPJs bloqueados para novos créditos.</p>
        </div>
        <button 
          onClick={handleNew}
          className="flex items-center gap-2 bg-red-600 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-red-700 transition-transform active:scale-95 shadow-lg shadow-red-900/20"
        >
          <Ban size={18} />
          Bloquear Novo CPF
        </button>
      </header>

      <div className="bg-red-50 border border-red-100 p-4 rounded-xl mb-6 flex items-start gap-3">
        <FileWarning className="text-red-500 mt-1 flex-shrink-0" size={24} />
        <div>
          <h4 className="font-bold text-red-800">Atenção Operacional</h4>
          <p className="text-sm text-red-700">Clientes nesta lista são bloqueados automaticamente pelo sistema ao tentar simular um novo empréstimo. A remoção é auditada.</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm mb-6 border border-slate-200">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Consultar CPF, CNPJ ou Nome na base de risco..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-lg bg-slate-50 border border-transparent focus:bg-white focus:border-red-300 focus:ring-4 focus:ring-red-50 outline-none transition-all"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-slate-200">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100 text-xs uppercase text-slate-500 font-bold">
              <th className="p-4">Nome / Razão Social</th>
              <th className="p-4">Documento</th>
              <th className="p-4">Motivo</th>
              <th className="p-4">Data</th>
              <th className="p-4">Risco</th>
              <th className="p-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredUsers.length > 0 ? (
              filteredUsers.map((user) => (
                <tr key={user.id} className="hover:bg-red-50/50 transition-colors group">
                  <td className="p-4 font-bold text-slate-800">{user.name}</td>
                  <td className="p-4 font-mono text-slate-600 bg-slate-50 rounded w-fit text-sm border border-slate-100 px-3 py-1">
                    {user.cpf}
                  </td>
                  <td className="p-4 text-slate-600 max-w-xs truncate" title={user.reason}>{user.reason}</td>
                  <td className="p-4 text-slate-500 text-sm">{user.date}</td>
                  <td className="p-4">
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase border
                      ${user.riskLevel === 'Alto' ? 'bg-red-100 text-red-700 border-red-200' : 
                        user.riskLevel === 'Médio' ? 'bg-orange-100 text-orange-700 border-orange-200' : 'bg-yellow-100 text-yellow-700 border-yellow-200'}`}>
                      {user.riskLevel}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
                <td colSpan={6} className="p-12 text-center text-slate-400 flex flex-col items-center justify-center">
                  <ShieldAlert size={48} className="mb-4 opacity-20"/>
                  <p>Nenhum registro encontrado na lista negra.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL DE CADASTRO/EDIÇÃO */}
      <SimpleModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)}
        title={editingId ? "Editar Bloqueio" : "Registrar Novo Bloqueio"}
      >
        <form onSubmit={handleSave} className="space-y-5">
          <div className={`border-l-4 p-4 rounded-r-lg ${editingId ? 'bg-blue-50 border-blue-400' : 'bg-red-50 border-red-500'}`}>
            <div className="flex gap-3">
              <AlertOctagon size={20} className={editingId ? 'text-blue-600' : 'text-red-600'} />
              <p className={`text-xs leading-relaxed ${editingId ? 'text-blue-800' : 'text-red-800'}`}>
                {editingId 
                  ? 'Você está alterando um registro legal. Todas as alterações ficam gravadas no histórico.' 
                  : 'ATENÇÃO: Esta ação impedirá qualquer operação financeira para este documento em todas as filiais imediatamente.'}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">CPF ou CNPJ <span className="text-red-500">*</span></label>
            <input 
                required 
                type="text" 
                value={formData.cpf} 
                onChange={e => setFormData({...formData, cpf: maskCpfCnpj(e.target.value)})} 
                className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-red-500 outline-none font-mono text-lg tracking-wide" 
                placeholder="000.000.000-00"
                maxLength={18}
            />
          </div>
          
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome Completo <span className="text-red-500">*</span></label>
            <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-400 outline-none" />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Motivo</label>
              <select value={formData.reason} onChange={e => setFormData({...formData, reason: e.target.value})} className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-400 outline-none bg-white">
                <option value="Fraude Documental">Fraude Documental</option>
                <option value="Inadimplência Recorrente">Inadimplência Recorrente</option>
                <option value="Processo Judicial">Processo Judicial</option>
                <option value="Golpe Confirmado">Golpe Confirmado</option>
                <option value="Outros">Outros</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nível de Risco</label>
              <select value={formData.riskLevel} onChange={e => setFormData({...formData, riskLevel: e.target.value})} className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-400 outline-none bg-white">
                <option value="Alto">Alto 🔴</option>
                <option value="Médio">Médio 🟠</option>
                <option value="Baixo">Baixo 🟡</option>
              </select>
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Observações Internas</label>
            <textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-400 outline-none h-24 resize-none" placeholder="Detalhes adicionais sobre o bloqueio..."></textarea>
          </div>
          
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 text-slate-600 hover:bg-gray-50 rounded-xl font-bold transition-colors">Cancelar</button>
            <button type="submit" disabled={isLoading} className="px-6 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 flex items-center gap-2 shadow-lg disabled:opacity-50">
                {isLoading ? 'Salvando...' : <><ShieldAlert size={18} /> {editingId ? 'Salvar Alterações' : 'Confirmar Bloqueio'}</>}
            </button>
          </div>
        </form>
      </SimpleModal>

      {/* MODAL DE DESBLOQUEIO */}
      <SimpleModal 
        isOpen={isUnblockModalOpen} 
        onClose={() => setIsUnblockModalOpen(false)}
        title="Realizar Desbloqueio de Documento"
      >
        <form onSubmit={handleConfirmUnblock} className="space-y-6">
          <div className="bg-green-50 border-l-4 border-green-500 p-4 flex gap-3 rounded-r-lg">
             <CheckCircle className="text-green-600 flex-shrink-0" size={24} />
             <div>
               <h4 className="font-bold text-green-800">Liberar Crédito</h4>
               <p className="text-sm text-green-700">Esta ação irá remover <strong>{selectedUserForUnblock?.name}</strong> da Lista Negra e permitir novas operações imediatamente.</p>
             </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Motivo do Desbloqueio <span className="text-red-500">*</span></label>
            <select 
              required
              value={unblockReason}
              onChange={(e) => setUnblockReason(e.target.value)}
              className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none bg-white"
            >
              <option value="">Selecione um motivo...</option>
              <option value="Dívida Paga / Acordo Quitado">Dívida Paga / Acordo Quitado</option>
              <option value="Erro Operacional / Cadastro Indevido">Erro Operacional / Cadastro Indevido</option>
              <option value="Decisão Judicial (Liminar)">Decisão Judicial (Liminar)</option>
              <option value="Autorização Especial da Diretoria">Autorização Especial da Diretoria</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button 
              type="button"
              onClick={() => setIsUnblockModalOpen(false)}
              className="px-6 py-3 text-slate-600 hover:bg-gray-50 rounded-xl font-bold transition-colors"
            >
              Cancelar
            </button>
            <button 
              type="submit"
              className="px-6 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors flex items-center gap-2 shadow-lg shadow-green-900/20"
            >
              <Unlock size={18} />
              Confirmar Desbloqueio
            </button>
          </div>
        </form>
      </SimpleModal>
    </Layout>
  );
};

export default Blacklist;