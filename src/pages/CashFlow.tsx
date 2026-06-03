import React, { useState, useEffect, useMemo } from 'react';
import { Wallet, TrendingUp, TrendingDown, RefreshCw, Plus, Search, CheckCircle, Clock, FileUp, AlertCircle, PlusCircle, Trash2 } from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { cashFlowService, CashFlowEntry } from '../services/api';
import { formatMoney } from '../utils/finance';

interface BankTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'ENTRADA' | 'SAIDA';
  status: 'MATCH' | 'MISSING_IN_SYSTEM';
  systemEntry?: CashFlowEntry;
}

const CashFlow = () => {
  const [entries, setEntries] = useState<CashFlowEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // 🚀 Estados dos Novos Filtros (Período e Tipo)
  const [filterType, setFilterType] = useState<'TODOS' | 'ENTRADA' | 'SAIDA'>('TODOS');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Estado para o Modal de Novo Lançamento Manual
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newEntry, setNewEntry] = useState<Partial<CashFlowEntry>>({
    type: 'SAIDA',
    category: 'Despesa Operacional',
    description: '',
    amount: 0,
    status: 'Efetivado'
  });

  // Estados da Conciliação
  const [isReconModalOpen, setIsReconModalOpen] = useState(false);
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]);
  const [selectedBankTxs, setSelectedBankTxs] = useState<string[]>([]);
  const [isProcessingFile, setIsProcessingFile] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const data = await cashFlowService.getAll();
      setEntries(data || []);
    } catch (error) {
      console.error("Erro ao buscar fluxo de caixa:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEntry.description || !newEntry.amount) return;
    
    setIsLoading(true);
    try {
      await cashFlowService.addEntry(newEntry);
      setIsModalOpen(false);
      setNewEntry({ type: 'SAIDA', category: 'Despesa Operacional', description: '', amount: 0, status: 'Efetivado' });
      fetchData();
    } catch (error) {
      alert("Erro ao salvar o lançamento.");
    } finally {
      setIsLoading(false);
    }
  };

  // --- MOTOR DE CONCILIAÇÃO BANCÁRIA (OFX) ULTRA-TOLERANTE ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingFile(true);
    const reader = new FileReader();
    
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        let parsedTxs: BankTransaction[] = [];
        
        if (file.name.toLowerCase().endsWith('.ofx') || file.name.toLowerCase().endsWith('.txt')) {
          
          // 🚀 1. Fatiamento Bruto: Ignora o cabeçalho e divide o texto a cada transação
          const transactionsRaw = text.split(/<STMTTRN>/i).slice(1);

          parsedTxs = transactionsRaw.map((trnRaw, idx) => {
              // 🚀 2. Pescaria de Dados: Lê o conteúdo ignorando se a tag foi fechada ou não
              const amtMatch = trnRaw.match(/<TRNAMT>([^<\n\r]+)/i);
              const dtMatch = trnRaw.match(/<DTPOSTED>([^<\n\r]+)/i);
              const memoMatch = trnRaw.match(/<MEMO>([^<\n\r]+)/i);

              const amountRaw = amtMatch ? parseFloat(amtMatch[1].trim().replace(',', '.')) : 0;
              const dateStr = dtMatch ? dtMatch[1].trim() : '';
              const memo = memoMatch ? memoMatch[1].trim() : 'Transação Bancária';
              
              // 🚀 3. Formatação segura de Data
              let dateObj = new Date();
              if (dateStr && dateStr.length >= 8) {
                  const y = dateStr.substring(0,4);
                  const mo = dateStr.substring(4,6);
                  const d = dateStr.substring(6,8);
                  dateObj = new Date(`${y}-${mo}-${d}T12:00:00Z`);
              }

              return {
                id: `bank-${idx}-${Date.now()}`,
                date: dateObj.toISOString(),
                description: memo,
                amount: Math.abs(amountRaw),
                type: (amountRaw >= 0 ? 'ENTRADA' : 'SAIDA') as 'ENTRADA' | 'SAIDA',
                status: 'MISSING_IN_SYSTEM' as const
              };
          }).filter(tx => tx.amount > 0); // Garante que não vai pegar lixo vazio

        } else {
           alert("Formato não suportado. Por favor, envie arquivos OFX.");
           setIsProcessingFile(false);
           return;
        }

        if (parsedTxs.length === 0) {
           throw new Error("Nenhuma transação legível encontrada no arquivo.");
        }

        // 🚀 4. Inteligência de Cruzamento: Compara o Banco com o Sistema
        const enrichedTxs = parsedTxs.map(bankTx => {
          const bankTime = new Date(bankTx.date).getTime();
          
          // Acha lançamento no sistema com MESMO VALOR, TIPO e TOLERÂNCIA DE 3 DIAS
          const match = entries.find(sysTx => {
            if (sysTx.type !== bankTx.type || sysTx.amount !== bankTx.amount) return false;
            const sysTime = new Date(sysTx.date!).getTime();
            const diffDays = Math.abs(bankTime - sysTime) / (1000 * 3600 * 24);
            return diffDays <= 3; 
          });

          if (match) {
            return { ...bankTx, status: 'MATCH' as const, systemEntry: match };
          }
          return bankTx;
        });

        setBankTransactions(enrichedTxs);
        // Pré-seleciona apenas o que o sistema não encontrou (para facilitar a vida do Rodrigo)
        setSelectedBankTxs(enrichedTxs.filter(t => t.status === 'MISSING_IN_SYSTEM').map(t => t.id));
        setIsReconModalOpen(true);
        
      } catch (error) {
        console.error("Erro na leitura OFX:", error);
        alert("Falha ao ler este extrato. Verifique se o arquivo não está corrompido.");
      } finally {
        setIsProcessingFile(false);
        e.target.value = ''; // Reseta o input do botão
      }
    };
    reader.readAsText(file);
  };

  const handleImportSelected = async () => {
    const txsToImport = bankTransactions.filter(t => selectedBankTxs.includes(t.id));
    if (txsToImport.length === 0) return;

    setIsLoading(true);
    try {
      for (const tx of txsToImport) {
        await cashFlowService.addEntry({
          type: tx.type,
          category: tx.type === 'ENTRADA' ? 'Outras Entradas' : 'Despesa Operacional',
          description: `[BANCO] ${tx.description}`,
          amount: tx.amount,
          status: 'Efetivado',
          date: tx.date
        });
      }
      alert(`${txsToImport.length} transações importadas com sucesso!`);
      setIsReconModalOpen(false);
      fetchData();
    } catch (e) {
      alert("Erro ao importar do banco.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteEntry = async (id: string) => {
    if (window.confirm("Tem certeza de que deseja remover este lançamento do caixa? O saldo será recalculado.")) {
      setIsLoading(true);
      try {
        await cashFlowService.deleteEntry(id);
        fetchData();
      } catch (error) {
        alert("Erro ao remover o registro.");
      } finally {
        setIsLoading(false);
      }
    }
  };
  // --- FIM DO MOTOR ---

  // 🚀 Lógica de Filtragem de Período
  const entriesByDate = useMemo(() => {
    return entries.filter(e => {
      if (!e.date) return false;
      const entryTime = new Date(e.date).getTime();
      const start = startDate ? new Date(`${startDate}T00:00:00`).getTime() : 0;
      const end = endDate ? new Date(`${endDate}T23:59:59`).getTime() : Infinity;
      return entryTime >= start && entryTime <= end;
    });
  }, [entries, startDate, endDate]);

  // Cálculos Gerenciais Inteligentes (Agora respeitam o Período selecionado!)
  const metrics = useMemo(() => {
    let entradas = 0;
    let saidas = 0;

    entriesByDate.forEach(e => {
      if (e.status === 'Efetivado') {
        if (e.type === 'ENTRADA') entradas += Number(e.amount);
        if (e.type === 'SAIDA') saidas += Number(e.amount);
      }
    });

    return { entradas, saidas, saldo: entradas - saidas };
  }, [entriesByDate]);

  // 🚀 Filtragem Final para a Tabela (Aplica Busca e Tipo)
  const filteredEntries = entriesByDate.filter(e => {
    const matchSearch = e.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
                        e.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchType = filterType === 'TODOS' ? true : e.type === filterType;
    return matchSearch && matchType;
  });

  return (
    <Layout>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Wallet className="text-blue-600" /> Fluxo de Caixa Interno
          </h2>
          <p className="text-slate-500">Acompanhamento e conciliação de saldos da empresa.</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full md:w-auto mt-4 md:mt-0">
          <button onClick={fetchData} className="bg-white border text-slate-600 p-2.5 rounded-xl hover:bg-slate-50 transition-colors shadow-sm">
            <RefreshCw className={isLoading ? "animate-spin" : ""} size={20} />
          </button>
          
          {/* BOTÃO DE IMPORTAR EXTRATO BANCÁRIO */}
          <label className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-100 transition-all shadow-sm cursor-pointer">
            {isProcessingFile ? <RefreshCw className="animate-spin" size={18}/> : <FileUp size={18} />}
            Ler Extrato (OFX)
            <input type="file" accept=".ofx" className="hidden" onChange={handleFileUpload} />
          </label>

          <button onClick={() => setIsModalOpen(true)} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg">
            <Plus size={20} /> Manual
          </button>
        </div>
      </header>

      {/* DASHBOARD DO CAIXA */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="p-4 bg-green-50 text-green-600 rounded-xl"><TrendingUp size={28}/></div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total de Entradas</p>
            <p className="text-2xl font-black text-slate-800">R$ {formatMoney(metrics.entradas)}</p>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="p-4 bg-red-50 text-red-600 rounded-xl"><TrendingDown size={28}/></div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total de Saídas</p>
            <p className="text-2xl font-black text-slate-800">R$ {formatMoney(metrics.saidas)}</p>
          </div>
        </div>

        <div className={`p-6 rounded-2xl border-2 flex items-center gap-4 shadow-sm ${metrics.saldo >= 0 ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
          <div className={`p-4 rounded-xl ${metrics.saldo >= 0 ? 'bg-blue-600 text-white' : 'bg-red-600 text-white'}`}>
            <Wallet size={28}/>
          </div>
          <div>
            <p className={`text-xs font-bold uppercase tracking-widest ${metrics.saldo >= 0 ? 'text-blue-800' : 'text-red-800'}`}>Saldo Atual em Caixa</p>
            <p className={`text-3xl font-black ${metrics.saldo >= 0 ? 'text-blue-900' : 'text-red-900'}`}>R$ {formatMoney(metrics.saldo)}</p>
          </div>
        </div>
      </div>

      {/* EXTRATO BANCÁRIO */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <h3 className="font-bold text-slate-700">Extrato de Movimentações</h3>
          
          <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
            {/* 🚀 Filtro de Período (Data) */}
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm">
              <span className="text-[10px] font-bold text-slate-400 uppercase">De:</span>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-xs font-bold text-slate-600 outline-none bg-transparent cursor-pointer" />
              <span className="text-[10px] font-bold text-slate-400 uppercase border-l pl-2">Até:</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-xs font-bold text-slate-600 outline-none bg-transparent cursor-pointer" />
            </div>

            {/* 🚀 Filtro de Tipo (Entrada/Saída) */}
            <select value={filterType} onChange={(e: any) => setFilterType(e.target.value)} className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold text-slate-600 outline-none shadow-sm cursor-pointer">
              <option value="TODOS">Todas Movimentações</option>
              <option value="ENTRADA">🟢 Apenas Entradas</option>
              <option value="SAIDA">🔴 Apenas Saídas</option>
            </select>

            {/* Busca Original */}
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input type="text" placeholder="Buscar lançamento..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm"/>
            </div>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                <th className="p-4 w-32">Data/Hora</th>
                <th className="p-4">Descrição / Categoria</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-right">Valor Lançado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredEntries.length === 0 ? (
                <tr><td colSpan={4} className="p-8 text-center text-slate-400 italic">Nenhuma movimentação registrada no caixa.</td></tr>
              ) : (
                filteredEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 text-xs font-mono text-slate-500">
                      {new Date(entry.date!).toLocaleDateString('pt-BR')} <br/>
                      <span className="text-[9px] text-slate-400">{new Date(entry.date!).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}</span>
                    </td>
                    <td className="p-4">
                      <p className="font-bold text-slate-800">{entry.description}</p>
                      <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded uppercase font-bold">{entry.category}</span>
                      {entry.referenceId && <span className="ml-2 text-[10px] text-blue-500 bg-blue-50 px-2 py-0.5 rounded font-mono">Ref: {entry.referenceId}</span>}
                    </td>
                    <td className="p-4 text-center">
                      {entry.status === 'Efetivado' 
                        ? <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100 flex items-center gap-1 w-fit mx-auto"><CheckCircle size={12}/> EFETIVADO</span>
                        : <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded border border-orange-100 flex items-center gap-1 w-fit mx-auto"><Clock size={12}/> PENDENTE</span>
                      }
                    </td>
                    <td className={`p-4 text-right font-black text-sm ${entry.type === 'ENTRADA' ? 'text-green-600' : 'text-red-600'}`}>
                      {entry.type === 'ENTRADA' ? '+ ' : '- '}R$ {formatMoney(entry.amount)}
                    </td>
                    {/* 🚀 BOTÃO DE LIXEIRA ADICIONADO COMPATÍVEL COM LAYOUT */}
                    <td className="p-4 text-center w-10">
                      <button 
                        onClick={() => handleDeleteEntry(entry.id!)} 
                        title="Excluir Lançamento" 
                        className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL DE LANÇAMENTO MANUAL */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Novo Lançamento no Caixa">
        <form onSubmit={handleSaveEntry} className="space-y-4">
          <div className="flex bg-slate-100 p-1 rounded-xl">
              <button type="button" onClick={() => setNewEntry({...newEntry, type: 'SAIDA', category: 'Despesa Operacional'})} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${newEntry.type === 'SAIDA' ? 'bg-red-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Despesa (Saída)</button>
              <button type="button" onClick={() => setNewEntry({...newEntry, type: 'ENTRADA', category: 'Aporte de Capital'})} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${newEntry.type === 'ENTRADA' ? 'bg-green-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Receita (Entrada)</button>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Categoria</label>
            <select required value={newEntry.category} onChange={e => setNewEntry({...newEntry, category: e.target.value})} className="w-full p-2.5 border rounded-lg bg-white text-sm outline-none">
              {newEntry.type === 'SAIDA' ? (
                <>
                  <option value="Despesa Operacional">Despesa Operacional (Luz, Internet, etc)</option>
                  <option value="Pagamento de Salário">Pagamento de Salário / Comissão</option>
                  <option value="Retirada de Sócio">Retirada de Sócio / Lucro</option>
                  <option value="Impostos e Taxas">Impostos e Taxas Bancárias</option>
                  <option value="Outras Saídas">Outras Saídas</option>
                </>
              ) : (
                <>
                  <option value="Aporte de Capital">Aporte de Capital (Investimento)</option>
                  <option value="Rendimento Externo">Rendimento Externo / Juros Banco</option>
                  <option value="Outras Entradas">Outras Entradas</option>
                </>
              )}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Descrição</label>
            <input required placeholder="Ex: Pagamento da conta de luz" value={newEntry.description} onChange={e => setNewEntry({...newEntry, description: e.target.value})} className="w-full p-2.5 border rounded-lg text-sm outline-none" />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Valor (R$)</label>
            <input required type="number" step="0.01" min="0.01" placeholder="0.00" value={newEntry.amount || ''} onChange={e => setNewEntry({...newEntry, amount: Number(e.target.value)})} className="w-full p-2.5 border rounded-lg font-black text-lg outline-none" />
          </div>

          <div className="pt-4 border-t flex justify-end gap-3">
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-2 text-slate-500 font-bold hover:bg-slate-50 rounded-lg">Cancelar</button>
            <button type="submit" disabled={isLoading} className="bg-slate-900 text-white px-8 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800">
              {isLoading ? <RefreshCw className="animate-spin" size={18}/> : <CheckCircle size={18}/>} Registrar Lançamento
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL DE CONCILIAÇÃO BANCÁRIA */}
      <Modal isOpen={isReconModalOpen} onClose={() => setIsReconModalOpen(false)} title="Conciliação Bancária">
        <div className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-start gap-3">
            <AlertCircle className="text-blue-600 mt-0.5" size={20} />
            <div>
              <p className="text-sm font-bold text-blue-900">Resultado da Leitura do Extrato</p>
              <p className="text-xs text-blue-700 mt-1">
                O sistema cruzou os dados do arquivo do banco com os lançamentos já existentes. 
                Selecione as movimentações divergentes que faltam e clique em Importar para corrigi-las.
              </p>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto border border-slate-200 rounded-xl custom-scrollbar">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 sticky top-0 shadow-sm z-10">
                <tr>
                  <th className="p-3 w-10 text-center">
                    <input 
                      type="checkbox" 
                      className="cursor-pointer rounded border-slate-300"
                      checked={selectedBankTxs.length === bankTransactions.filter(t => t.status === 'MISSING_IN_SYSTEM').length && selectedBankTxs.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedBankTxs(bankTransactions.filter(t => t.status === 'MISSING_IN_SYSTEM').map(t => t.id));
                        else setSelectedBankTxs([]);
                      }}
                    />
                  </th>
                  <th className="p-3 font-bold text-slate-600 text-xs uppercase tracking-wider">Transação do Banco</th>
                  <th className="p-3 font-bold text-slate-600 text-right text-xs uppercase tracking-wider">Valor</th>
                  <th className="p-3 font-bold text-slate-600 text-center text-xs uppercase tracking-wider">Diagnóstico</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bankTransactions.map(tx => (
                  <tr key={tx.id} className={tx.status === 'MATCH' ? 'bg-green-50/40 opacity-80' : 'bg-white hover:bg-slate-50'}>
                    <td className="p-3 text-center">
                      <input 
                        type="checkbox" 
                        className="cursor-pointer rounded border-slate-300"
                        disabled={tx.status === 'MATCH'}
                        checked={selectedBankTxs.includes(tx.id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedBankTxs([...selectedBankTxs, tx.id]);
                          else setSelectedBankTxs(selectedBankTxs.filter(id => id !== tx.id));
                        }}
                      />
                    </td>
                    <td className="p-3">
                      <p className="font-bold text-slate-800 truncate max-w-[200px]" title={tx.description}>{tx.description}</p>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">{new Date(tx.date).toLocaleDateString('pt-BR')}</p>
                    </td>
                    <td className={`p-3 text-right font-black ${tx.type === 'ENTRADA' ? 'text-green-600' : 'text-red-600'}`}>
                      {tx.type === 'ENTRADA' ? '+' : '-'} R$ {formatMoney(tx.amount)}
                    </td>
                    <td className="p-3 text-center">
                      {tx.status === 'MATCH' ? (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-green-700 bg-green-100 px-2 py-1 rounded-md border border-green-200">
                          <CheckCircle size={12}/> JÁ NO SISTEMA
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-orange-700 bg-orange-100 px-2 py-1 rounded-md border border-orange-200">
                          <PlusCircle size={12}/> NÃO ENCONTRADO
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {bankTransactions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-400 italic">
                      O arquivo OFX selecionado não possui transações válidas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pt-4 border-t flex justify-between items-center">
            <span className="text-xs font-bold text-slate-500">
              {selectedBankTxs.length} transações divergentes marcadas
            </span>
            <div className="flex gap-3">
              <button onClick={() => setIsReconModalOpen(false)} className="px-6 py-2.5 text-slate-500 font-bold hover:bg-slate-50 rounded-xl">Cancelar</button>
              <button onClick={handleImportSelected} disabled={selectedBankTxs.length === 0 || isLoading} className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50 shadow-lg transition-all">
                {isLoading ? <RefreshCw className="animate-spin" size={18}/> : <FileUp size={18}/>} Injetar no Sistema
              </button>
            </div>
          </div>
        </div>
      </Modal>

    </Layout>
  );
};

export default CashFlow;