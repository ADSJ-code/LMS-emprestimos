import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Search, Plus, MoreVertical, Edit2, Trash2, Eye, 
  MapPin, Phone, Mail, User, ShieldCheck, AlertCircle, RefreshCw, FileText, Upload, Loader2,
  DollarSign, CheckCircle, XCircle, Clock, TrendingUp, TrendingDown, Users, Calendar, Activity, List, Check, ShieldAlert,
  Home, Layers, CreditCard, Download, Filter, ChevronDown
} from 'lucide-react';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { clientService, loanService, Client, ClientDoc, Loan } from '../services/api';
import { formatMoney } from '../utils/finance';

interface ChecklistItem {
  id: string; label: string; weight: number; checked: boolean; stage: 1 | 2;
}

const Clients = () => {
  const navigate = useNavigate();

  // 🚀 EXTRAÇÃO DE APELIDO: Limpa o JSON [META:...] e mostra apenas a observação
  const getNickname = (obs?: string) => {
      if (!obs) return '';
      return obs.replace(/\[META:.*?\]/g, '').trim();
  };

  const [clients, setClients] = useState<Client[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]); 
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // 🚨 ESTADOS ADICIONADOS PARA EXPORTAÇÃO E FILTROS INTELIGENTES
  const [selectedIds, setSelectedIds] = useState<(string|number)[]>([]);
  const [filterStatus, setFilterStatus] = useState<'Todos' | 'Ativos' | 'Quitados' | 'Inadimplentes' | 'Acordo'>('Todos');
  // 🚀 NOVO ESTADO: Controla a ordenação da lista (A-Z, Mais Novo, Mais Antigo)
  const [sortOrder, setSortOrder] = useState<'alpha' | 'newest' | 'oldest'>('alpha');

  // 🚨 NOVO ESTADO: Controla o aviso de duplicidade em tempo real
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [modalTab, setModalTab] = useState<'dados' | 'financeiro' | 'analise'>('dados');
  
  const [globalMetricModal, setGlobalMetricModal] = useState<'base' | 'ativos' | 'emprestado' | 'lucro' | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null); // 🚀 Controle da Sanfona Mensal
  const [isCepLoading, setIsCepLoading] = useState(false);
  const [clientType, setClientType] = useState<'PF' | 'PJ'>('PF');

  const [formData, setFormData] = useState<Partial<Client> & {justification?: string, 
    checklist?: string[],
    nationality?: string,
    maritalStatus?: string,
    houseType?: 'CASA' | 'APARTAMENTO',
    block?: string,
    floor?: string,
    pixKeyType?: string,
    pixKey?: string,
    bankName?: string
  }>({
    name: '', cpf: '', rg: '', email: '', phone: '',
    nationality: 'Brasileiro(a)', maritalStatus: 'SOLTEIRO(A)',
    cep: '', address: '', number: '', neighborhood: '', city: '', state: '',
    observations: '', documents: [], status: 'Ativo', justification: '', checklist: [],
    houseType: 'CASA', block: '', floor: '',
    pixKeyType: 'CPF', pixKey: '', bankName: ''
  });

  const [openMenuId, setOpenMenuId] = useState<string | number | null>(null);
  const [activeStage, setActiveStage] = useState<1 | 2>(1);

  const initialChecklist: ChecklistItem[] = useMemo(() => [
    { id: 'q1', label: 'Nome Completo e Cadastro Básico', weight: 1, checked: false, stage: 1 },
    { id: 'q2', label: 'Vínculo CLT/Autônomo Validado', weight: 3, checked: false, stage: 1 },
    { id: 'q3', label: 'Tempo de Empresa (> 6 meses)', weight: 2, checked: false, stage: 1 },
    { id: 'q4', label: 'Salário e Benefícios Reais', weight: 3, checked: false, stage: 1 },
    { id: 'q5', label: 'Moradia Confirmada', weight: 1, checked: false, stage: 1 },
    { id: 'q6', label: 'Análise de Redes Sociais', weight: 1, checked: false, stage: 1 },
    { id: 'q7', label: 'Sem Restrição Crítica', weight: 3, checked: false, stage: 1 },
    { id: 'q8', label: 'Filtro de Apostas', weight: 3, checked: false, stage: 1 },
    { id: 'd1', label: 'Comprovante Endereço Anexado', weight: 3, checked: false, stage: 2 },
    { id: 'd2', label: 'Holerite ou Extratos', weight: 3, checked: false, stage: 2 },
    { id: 'd3', label: 'Selfie do Cliente', weight: 2, checked: false, stage: 2 },
    { id: 'd4', label: 'Contato de Referência', weight: 2, checked: false, stage: 2 },
    { id: 'd5', label: 'RG/CNH Anexado', weight: 3, checked: false, stage: 2 },
    { id: 'd6', label: 'Vídeo da Casa', weight: 3, checked: false, stage: 2 },
    { id: 'd7', label: 'Vídeo do Acordo', weight: 3, checked: false, stage: 2 },
    { id: 'd8', label: 'Dados Bancários Completos', weight: 2, checked: false, stage: 2 },
  ], []);

  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(initialChecklist);

  const totalWeight = checklistItems.reduce((acc, item) => acc + item.weight, 0);
  const currentScore = checklistItems.reduce((acc, item) => item.checked ? acc + item.weight : acc, 0);
  const progressPercentage = Math.round((currentScore / totalWeight) * 100);

  const toggleChecklistItem = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setChecklistItems(prev => prev.map(item => item.id === id ? { ...item, checked: !item.checked } : item));
  };

  const handleGoToContract = (contractId: string) => {
      sessionStorage.setItem('searchClient', contractId);
      navigate('/billing');
  };

  const maskCPF = (value: string) => value.replace(/\D/g, "").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})/, "$1-$2").replace(/(-\d{2})\d+?$/, "$1");
  const maskCNPJ = (value: string) => value.replace(/\D/g, "").replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2").slice(0, 18);
  const maskRG = (value: string) => value.replace(/\D/g, "").replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})/, "$1-$2").slice(0, 12);
  const maskPhone = (value: string) => value.replace(/\D/g, "").replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2").replace(/(-\d{4})\d+?$/, "$1");
  const maskCEP = (value: string) => value.replace(/\D/g, "").replace(/^(\d{5})(\d)/, "$1-$2").slice(0, 9);
  const handleCepBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    
    const cep = e.target.value.replace(/\D/g, '');
    if (cep.length === 8) {
      setIsCepLoading(true);
      try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await response.json();
        if (!data.erro) {
          setFormData(prev => ({
            ...prev,
            address: data.logradouro,
            neighborhood: data.bairro,
            city: data.localidade,
            state: data.uf
          }));
        }
      } catch (error) { console.error(error); } 
      finally { setIsCepLoading(false); }
    }
  };

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [clientsData, loansData] = await Promise.all([
          clientService.getAll(),
          loanService.getAll()
      ]);

      // 🚀 FILTRO GLOBAL DA LISTA NEGRA: Isola os banidos de toda a página
      const blockedNames = new Set((clientsData || []).filter(c => c.status === 'Bloqueado').map(c => c.name));
      const cleanClients = (clientsData || []).filter(c => c.status !== 'Bloqueado');
      const cleanLoans = (loansData || []).filter(l => !blockedNames.has(l.client));

      setClients(cleanClients); // <--- A partir de agora a matemática base só tem os limpos
      setLoans(cleanLoans);     // <--- Idem para os contratos
    } catch (err) { console.error(err); } 
    finally { setIsLoading(false); }
  };

  useEffect(() => {
    fetchData();
    const handleGlobalClick = () => setOpenMenuId(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  // 🚨 OLHEIRO EM TEMPO REAL: Verifica duplicidade informando NOME do cliente
  useEffect(() => {
      const cleanDoc = (formData.cpf || '').replace(/\D/g, '');
      if (cleanDoc.length === 11 || cleanDoc.length === 14) {
          const duplicateClient = clients.find(c => {
              const cClean = (c.cpf || '').replace(/\D/g, '');
              if (editingId && c.id === editingId) return false;
              return cClean === cleanDoc;
          });
          
          if (duplicateClient) {
              setDuplicateWarning(`⚠️ Este ${cleanDoc.length === 11 ? 'CPF' : 'CNPJ'} já está sendo usado pelo cliente: ${duplicateClient.name}`);
          } else {
              setDuplicateWarning(null);
          }
      } else {
          setDuplicateWarning(null);
      }
  }, [formData.cpf, clients, editingId]);

  const processedClients = useMemo(() => {
      const sortedByTime = [...clients].sort((a, b) => Number(a.id) - Number(b.id));
      return sortedByTime.map((c, index) => ({
          ...c,
          displayNumber: (c as any).clientNumber || (index + 1)
      })).reverse(); 
  }, [clients]);

  // 🚀 globalMetrics foi movido para baixo (após o getClientDebtStatus) para evitar tela branca (Temporal Dead Zone)

  // 🚀 NOVO MOTOR: Agrupamento de Pagamentos Reais Executados por Mês/Ano
  const monthlyData = useMemo(() => {
      const groups: any = {};
      loans.forEach(loan => {
          if (!loan.history) return;
          loan.history.forEach(h => {
              // Ignora aberturas, acordos vazios e erros
              if (h.amount <= 0 || h.type.includes('Abertura') || h.type === 'Acordo') return;
              
              const d = new Date(h.date);
              const mStr = String(d.getMonth() + 1).padStart(2, '0');
              const yStr = d.getFullYear();
              const monthYear = `${yStr}-${mStr}`; // Formato de chave (Ex: "2026-04")
              const label = `${mStr}/${yStr}`;     // Rótulo Visual (Ex: "04/2026")

              if (!groups[monthYear]) {
                  groups[monthYear] = { id: monthYear, label, cap: 0, int: 0, total: 0, clients: {} };
              }
              
              const capPaid = Number(h.capitalPaid) || 0;
              const intPaid = Number(h.interestPaid) || 0;
              
              groups[monthYear].cap += capPaid;
              groups[monthYear].int += intPaid;
              groups[monthYear].total += Number(h.amount);

              if (!groups[monthYear].clients[loan.client]) {
                  groups[monthYear].clients[loan.client] = { cap: 0, int: 0, total: 0, contracts: [] };
              }
              groups[monthYear].clients[loan.client].cap += capPaid;
              groups[monthYear].clients[loan.client].int += intPaid;
              groups[monthYear].clients[loan.client].total += Number(h.amount);
              
              groups[monthYear].clients[loan.client].contracts.push({
                  id: loan.id,
                  date: h.date,
                  cap: capPaid,
                  int: intPaid,
                  total: Number(h.amount)
              });
          });
      });
      // Devolve array ordenado do Mês Mais Recente para o Mais Antigo
      return Object.values(groups).sort((a: any, b: any) => b.id.localeCompare(a.id));
  }, [loans]);

  // 🚀 NOVO MOTOR: Agrupamento de Capital Emprestado (Dinheiro Liberado) por Mês/Ano
  const monthlyLentData = useMemo(() => {
      const groups: any = {};
      loans.forEach(loan => {
          if (!loan.startDate) return;
          const d = new Date(loan.startDate);
          const mStr = String(d.getMonth() + 1).padStart(2, '0');
          const yStr = d.getFullYear();
          const monthYear = `${yStr}-${mStr}`;
          const label = `${mStr}/${yStr}`;

          if (!groups[monthYear]) {
              groups[monthYear] = { id: monthYear, label, total: 0, clients: {} };
          }
          
          groups[monthYear].total += Number(loan.amount) || 0;

          if (!groups[monthYear].clients[loan.client]) {
              groups[monthYear].clients[loan.client] = { total: 0, contracts: [] };
          }
          groups[monthYear].clients[loan.client].total += Number(loan.amount) || 0;
          groups[monthYear].clients[loan.client].contracts.push({
              id: loan.id,
              date: loan.startDate,
              total: Number(loan.amount) || 0
          });
      });
      return Object.values(groups).sort((a: any, b: any) => b.id.localeCompare(a.id));
  }, [loans]);

  const calculateClientScore = (clientName: string) => {
      const clientLoans = loans.filter(l => l.client === clientName);
      let totalEmprestado = 0; let totalDevolvido = 0; let lucroReal = 0; let atrasos = 0;
      clientLoans.forEach(l => {
          const capPaid = Number(l.totalPaidCapital) || 0;
          const intPaid = Number(l.totalPaidInterest) || 0;
          const amount = Number(l.amount) || 0;
          totalEmprestado += amount; totalDevolvido += (capPaid + intPaid); lucroReal += intPaid;
          if (l.status === 'Atrasado') atrasos++;
      });
      const saldoFinal = totalDevolvido - totalEmprestado;
      return { totalEmprestado, totalDevolvido, lucroReal, saldoFinal, atrasos, contratos: clientLoans.length };
  };

  type DocType = 'RG_FRENTE' | 'RG_VERSO' | 'COMPROVANTE_RESIDENCIA';
  const getDoc = (type: DocType) => formData.documents?.find(d => d.name.startsWith(`[${type}]`));

  const handleSpecificUpload = (e: any, type: DocType) => {
      const file = e.target.files[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              const otherDocs = formData.documents?.filter(d => !d.name.startsWith(`[${type}]`)) || [];
              const newDoc: ClientDoc = { name: `[${type}] ${file.name}`, type: file.type, data: reader.result as string };
              setFormData(prev => ({ ...prev, documents: [...otherDocs, newDoc] }));
          };
          reader.readAsDataURL(file);
      }
  };

  const removeDoc = (type: DocType) => {
      if(confirm("Deseja remover?")) {
          const filtered = formData.documents?.filter(d => !d.name.startsWith(`[${type}]`)) || [];
          setFormData(prev => ({ ...prev, documents: filtered }));
      }
  };

  const viewDoc = (doc: ClientDoc) => {
      const w = window.open("");
      if (w) w.document.write(`<iframe src="${doc.data}" frameborder="0" style="border:0; width:100%; height:100%;" allowfullscreen></iframe>`);
  };

  const UploadSlot = ({ label, type }: { label: string, type: DocType }) => {
      const currentDoc = getDoc(type);
      return (
          <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase">{label}</span>
              {currentDoc ? (
                  <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl">
                      <div className="flex items-center gap-2 truncate">
                          <div className="bg-green-100 p-1.5 rounded text-green-700"><FileText size={16}/></div>
                          <span className="text-xs font-bold text-green-800 truncate max-w-[80px]">{currentDoc.name.replace(`[${type}] `, '')}</span>
                      </div>
                      <div className="flex gap-1">
                          <button type="button" onClick={() => viewDoc(currentDoc)} className="text-blue-500 p-1"><Eye size={14}/></button>
                          <button type="button" onClick={() => removeDoc(type)} className="text-red-400 p-1"><Trash2 size={14}/></button>
                      </div>
                  </div>
              ) : (
                  <label className="flex flex-col items-center justify-center p-2 border-2 border-dashed border-slate-300 rounded-xl text-slate-400 cursor-pointer hover:bg-slate-50 h-[62px]">
                      <input type="file" className="hidden" onChange={(e) => handleSpecificUpload(e, type)} />
                      <Upload size={16} /><span className="text-[9px] font-bold">Anexar</span>
                  </label>
              )}
          </div>
      );
  };

  const parseLocalDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    let cleanStr = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    if (cleanStr.includes('/')) {
        const [d, m, y] = cleanStr.split('/');
        return new Date(Number(y), Number(m) - 1, Number(d));
    }
    const [year, month, day] = cleanStr.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const getClientDebtStatus = (clientName: string) => {
    const clientLoans = loans.filter(l => l.client === clientName);
    if (clientLoans.length === 0) return { label: 'Sem Histórico', color: 'gray' };
    
    const hasOverdue = clientLoans.some(l => {
        if (l.status === 'Pago' || l.status === 'Quitado' || l.status === 'Acordo') return false;
        
        const validSlices = (l as any).multiDates?.filter((s: any) => s && s.day && !isNaN(Number(s.day)) && Number(s.day) > 0 && parseFloat(s.amount) > 0) || [];
        const today = new Date();
        today.setHours(0,0,0,0);
        const dueLocalDate = parseLocalDate(l.nextDue);

        if (validSlices.length > 0) {
            const currentMonth = dueLocalDate.getMonth();
            const currentYear = dueLocalDate.getFullYear();
            for (const slice of validSlices) {
                const sliceDate = new Date(currentYear, currentMonth, Number(slice.day));
                if (sliceDate < today) {
                    const baseAmount = parseFloat(slice.amount);
                    const slicePaidAmount = (l.history || []).reduce((acc: any, h: any) => {
                        const hDue = h.originalDueDate ? parseLocalDate(h.originalDueDate) : parseLocalDate(h.date);
                        if (hDue.getMonth() === currentMonth && hDue.getFullYear() === currentYear && h.note?.includes(`Dia ${slice.day}`)) {
                            return acc + parseFloat(h.amount);
                        }
                        return acc;
                    }, 0);
                    if (slicePaidAmount < (baseAmount - 0.05)) return true;
                }
            }
            return false;
        }
        return dueLocalDate < today;
    });
    
    if (hasOverdue) return { label: 'Inadimplente', color: 'red' };
    
    const hasAcordo = clientLoans.some(l => l.status === 'Acordo');
    if (hasAcordo) return { label: 'Em Acordo', color: 'orange' };
    
    if (clientLoans.some(l => l.status !== 'Pago' && l.status !== 'Quitado')) return { label: 'Em Dia (Ativo)', color: 'blue' };
    return { label: 'Quitado', color: 'green' };
  };

  // 🚀 MOTOR DE MÉTRICAS UNIFICADO: Sincroniza a contagem dos Cards diretamente com os filtros visuais da tabela
  const globalMetrics = useMemo(() => {
      let totalLent = 0;
      let totalProfit = 0;
      let countAtivos = 0;
      let countQuitados = 0;
      let validBaseCount = 0;

      // Filtra e valida os clientes ativos na base limpa
      processedClients.forEach(c => {
          if (!c.name) return; // Ignora cadastros fantasmas ou corrompidos
          validBaseCount++;
          
          const ds = getClientDebtStatus(c.name);
          if (ds.label.includes('Ativo') || ds.label === 'Inadimplente' || ds.label === 'Em Acordo') {
              countAtivos++;
          } else if (ds.label === 'Quitado') {
              countQuitados++;
          }
      });

      loans.forEach(l => {
          totalLent += Number(l.amount) || 0;
          totalProfit += Number(l.totalPaidInterest) || 0;
      });

      return { 
          totalLent, 
          totalProfit, 
          totalClients: validBaseCount, 
          activeClients: countAtivos,
          quitados: countQuitados
      };
  }, [loans, processedClients]);

  // 🚀 LIMPADOR DE ACENTOS E CARACTERES ESPECIAIS
  const normalizeString = (str: string) => {
      return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  };

  // 🚀 BUSCA INTELIGENTE DO RODRIGO: Sem acentos, obedece ao seletor de ordenação.
  const filteredClients = useMemo(() => {
    let result = processedClients.filter(c => {
      const searchLower = normalizeString(searchTerm);
      const searchNumbers = searchTerm.replace(/\D/g, '');
      const cNameNorm = normalizeString(c.name || '');
      
      const matchesSearch = (
        cNameNorm.includes(searchLower) || 
        (searchNumbers && (c.cpf || '').replace(/\D/g, '').includes(searchNumbers)) ||
        (c.displayNumber && c.displayNumber.toString() === searchNumbers)
      );

      let matchesStatus = true;
      if (filterStatus !== 'Todos') {
          const ds = getClientDebtStatus(c.name);
          if (filterStatus === 'Ativos') {
              // 🚀 AGORA INCLUI TUDO: Em Dia, Atrasados e Acordos
              matchesStatus = ds.label.includes('Ativo') || ds.label === 'Inadimplente' || ds.label === 'Em Acordo';
          }
          else if (filterStatus === 'Quitados') matchesStatus = ds.label === 'Quitado';
          else if (filterStatus === 'Inadimplentes') matchesStatus = ds.label === 'Inadimplente';
          else if (filterStatus === 'Acordo') matchesStatus = ds.label === 'Em Acordo';
      }

      return matchesSearch && matchesStatus;
    });

    result.sort((a, b) => {
      const aName = normalizeString(a.name || '');
      const bName = normalizeString(b.name || '');

      // 🚀 Se NÃO houver busca por texto, obedece rigorosamente ao seletor escolhido
      if (!searchTerm) {
          if (sortOrder === 'newest') return Number(b.id) - Number(a.id);
          if (sortOrder === 'oldest') return Number(a.id) - Number(b.id);
          return aName.localeCompare(bName); // 'alpha'
      }
      
      // Se houver busca, mantém a inteligência de colocar quem começa com o termo no topo
      const searchLower = normalizeString(searchTerm);
      const aStarts = aName.startsWith(searchLower);
      const bStarts = bName.startsWith(searchLower);
      
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      
      return aName.localeCompare(bName);
    });

    return result;
  }, [processedClients, searchTerm, filterStatus, sortOrder, loans]);

  const toggleSelectAll = () => { if (selectedIds.length === filteredClients.length) setSelectedIds([]); else setSelectedIds(filteredClients.map(c => c.id)); };
  const toggleSelectOne = (id: string | number) => { setSelectedIds(prev => prev.includes(id) ? prev.filter(curr => curr !== id) : [...prev, id]); };

  const handleExportExcel = async () => {
    // 🚀 Usa o 'filteredClients' em vez do 'clients' bruto para garantir que o Excel saia na exata ordem alfabética que está na tela
    const clientsToExport = filteredClients.filter(c => selectedIds.includes(c.id));

    if (clientsToExport.length === 0) { 
        alert("Nenhum cliente selecionado. Por favor, marque as caixas dos clientes que deseja exportar."); 
        return; 
    }
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Clientes');
    
    worksheet.columns = [
        { header: 'ID / Num', key: 'id', width: 10 },
        { header: 'Nome do Cliente', key: 'name', width: 35 },
        { header: 'CPF/CNPJ', key: 'cpf', width: 18 },
        { header: 'Telefone', key: 'phone', width: 18 },
        { header: 'Status Financeiro', key: 'status', width: 20 },
        { header: 'Observações / Tags', key: 'obs', width: 40 },
        { header: 'Endereço Completo', key: 'address', width: 50 },
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    clientsToExport.forEach(c => {
        const ds = getClientDebtStatus(c.name);
        
        const addrParts = [];
        if (c.address) addrParts.push(c.address);
        if (c.number) addrParts.push(c.number);
        if ((c as any).block) addrParts.push(`BLOCO ${(c as any).block}`);
        if ((c as any).floor) addrParts.push(`APTO ${(c as any).floor}`);
        if ((c as any).neighborhood) addrParts.push((c as any).neighborhood);
        if (c.city) addrParts.push(c.city);
        if (c.state) addrParts.push(c.state);
        if (c.cep) addrParts.push(`CEP: ${c.cep}`);
        const addressStr = addrParts.join(", ") || '-';

        worksheet.addRow({
            id: (c as any).displayNumber || c.id,
            name: c.name,
            cpf: c.cpf,
            phone: c.phone,
            status: ds.label,
            obs: getNickname(c.observations) || '-',
            address: addressStr
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Base_Clientes_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`);
  };

  // SISTEMA DE DESEMPACOTAMENTO DE DADOS (IMPEDE A PERDA DO PIX E DADOS ANTIGOS)
  const handleOpenModal = (client?: any, defaultTab: 'dados' | 'financeiro' | 'analise' = 'dados') => {
    setModalTab(defaultTab); 
    if (client) {
      setEditingId(client.id);
      
      // AUTO-DETECTA SE É PF OU PJ
      if (client.cpf && client.cpf.length > 14) {
          setClientType('PJ');
      } else {
          setClientType('PF');
      }

      const savedChecklist = client.checklist || [];
      const restoredItems = initialChecklist.map(item => ({ ...item, checked: savedChecklist.includes(item.id) }));
      setChecklistItems(restoredItems);
      
      let displayObs = client.observations || '';
      let metaData: any = {};

      // REGEX BLINDADA PARA LER CORRETAMENTE O JSON DO BANCO
      const metaMatch = displayObs.match(/\[META:(\{.*\})\]/);
      if (metaMatch) {
          try {
              metaData = JSON.parse(metaMatch[1]);
              displayObs = displayObs.replace(/\[META:\{.*\}\]/g, '').trim();
          } catch (e) {}
      }

      setFormData({ 
          ...client, 
          documents: client.documents || [], 
          justification: client.justification || '', 
          checklist: savedChecklist,
          observations: displayObs,
          
          nationality: metaData.nat || metaData.nationality || client.nationality || 'Brasileiro(a)', 
          maritalStatus: metaData.mar || metaData.maritalStatus || client.maritalStatus || 'SOLTEIRO(A)',
          houseType: metaData.ht || metaData.houseType || client.houseType || 'CASA', 
          block: metaData.bl || metaData.block || client.block || '', 
          floor: metaData.fl || metaData.floor || client.floor || '',
          pixKeyType: metaData.pixType || metaData.pixKeyType || client.pixKeyType || 'CPF', 
          pixKey: metaData.pixKey || client.pixKey || '',
          bankName: metaData.bn || metaData.bankName || client.bankName || ''
      });
    } else {
      setEditingId(null);
      setClientType('PF'); // Garante que novo cliente comece como PF
      setChecklistItems(initialChecklist);
      setFormData({ 
          name: '', cpf: '', rg: '', email: '', phone: '', cep: '', address: '', number: '', neighborhood: '', city: '', state: '', 
          observations: '', documents: [], status: 'Ativo', justification: '', checklist: [],
          nationality: 'Brasileiro(a)', maritalStatus: 'SOLTEIRO(A)', houseType: 'CASA', block: '', floor: '',
          pixKeyType: 'CPF', pixKey: '', bankName: ''
      });
    }
    setIsModalOpen(true);
    setOpenMenuId(null);
  };

  // SISTEMA DE EMPACOTAMENTO DE DADOS E SALVAMENTO
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // 🚨 TRAVA DE SEGURANÇA: Impede envio se o CPF for duplicado
    const cleanDoc = (formData.cpf || '').replace(/\D/g, '');
    if (cleanDoc) {
        const isDuplicate = clients.some(c => {
            const cClean = (c.cpf || '').replace(/\D/g, '');
            if (editingId && c.id === editingId) return false;
            return cClean === cleanDoc;
        });

        if (isDuplicate) {
            alert(`❌ ERRO: Este ${clientType === 'PF' ? 'CPF' : 'CNPJ'} já está cadastrado no sistema!`);
            setIsLoading(false);
            return;
        }
    }

    try {
      const checkedIds = checklistItems.filter(i => i.checked).map(i => i.id);
      
      let cleanObs = (formData.observations || '').replace(/\[META:\{.*\}\]/g, '').trim();
      // Dupla garantia contra lixo residual antigo
      cleanObs = cleanObs.replace(/\[META:.*?\]/g, '').trim();

      const meta = {
          pixType: formData.pixKeyType, pixKey: formData.pixKey,
          nat: formData.nationality, mar: formData.maritalStatus,
          ht: formData.houseType, bl: formData.block, fl: formData.floor,
          bn: formData.bankName
      };
      const finalObs = `${cleanObs} [META:${JSON.stringify(meta)}]`.trim();

      const payload = { ...formData, checklist: checkedIds, observations: finalObs };
      
      if (editingId) {
        await clientService.update(editingId, payload as Client);
        alert('Atualizado com sucesso!');
      } else {
        const maxNum = processedClients.reduce((max, c) => Math.max(max, c.displayNumber), 0);
        await clientService.create({ ...payload, id: Date.now(), clientNumber: maxNum + 1 } as Client);
        alert('Cadastrado com sucesso!');
      }
      setIsModalOpen(false); fetchData();
    } catch (err) { alert("Erro ao salvar."); } finally { setIsLoading(false); }
  };

  const handleDelete = async (id: string | number) => {
    if (confirm('Excluir cliente?')) { try { await clientService.delete(id.toString()); fetchData(); } catch (err) { alert('Erro.'); } }
  };

  return (
    <Layout>
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div><h2 className="text-2xl font-bold text-slate-800">Clientes</h2><p className="text-slate-500">Gestão e análise da base.</p></div>
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          <button onClick={fetchData} className="bg-white border p-2.5 rounded-xl shadow-sm hover:bg-slate-50 transition-colors"><RefreshCw className={isLoading ? "animate-spin text-slate-500" : "text-slate-500"} size={18} /></button>
          <button onClick={() => handleOpenModal()} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg"><Plus size={20} /> Novo Cliente</button>
        </div>
      </header>

      {/* DASHBOARD INTELIGENTE */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div onClick={() => { setFilterStatus('Todos'); }} className={`p-6 rounded-2xl border cursor-pointer hover:shadow-md transition-all flex items-center gap-4 ${filterStatus === 'Todos' ? 'bg-slate-50 border-slate-200 shadow-sm' : 'bg-white'}`}>
              <div className="p-3 bg-slate-100 text-slate-600 rounded-xl"><Users size={24}/></div>
              <div><p className="text-[10px] font-bold text-slate-500 uppercase">Base Válida</p><p className="text-2xl font-black text-slate-800">{globalMetrics.totalClients}</p></div>
          </div>
          <div onClick={() => { setFilterStatus('Ativos'); }} className={`p-6 rounded-2xl border cursor-pointer hover:shadow-md transition-all flex items-center gap-4 ${filterStatus === 'Ativos' ? 'bg-blue-50 border-blue-200 shadow-sm' : 'bg-white'}`}>
              <div className="p-3 bg-blue-100 text-blue-600 rounded-xl"><Activity size={24}/></div>
              <div><p className="text-[10px] font-bold text-blue-600 uppercase">Clientes Ativos</p><p className="text-2xl font-black text-slate-800">{globalMetrics.activeClients}</p></div>
          </div>
          <div onClick={() => { setFilterStatus('Quitados'); }} className={`p-6 rounded-2xl border cursor-pointer hover:shadow-md transition-all flex items-center gap-4 ${filterStatus === 'Quitados' ? 'bg-green-50 border-green-200 shadow-sm' : 'bg-white'}`}>
              <div className="p-3 bg-green-100 text-green-600 rounded-xl"><CheckCircle size={24}/></div>
              <div>
                  <p className="text-[10px] font-bold text-green-600 uppercase">Clientes Quitados</p>
                  <p className="text-2xl font-black text-slate-800">{globalMetrics.quitados}</p>
              </div>
          </div>
          <div onClick={() => setGlobalMetricModal('emprestado')} className="bg-white p-6 rounded-2xl border cursor-pointer hover:shadow-md transition-all flex items-center gap-4">
              <div className="p-3 bg-orange-50 text-orange-600 rounded-xl"><DollarSign size={24}/></div>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase">Emprestado</p><p className="text-xl font-black text-slate-800">R$ {formatMoney(globalMetrics.totalLent)}</p></div>
          </div>
          <div onClick={() => setGlobalMetricModal('lucro')} className="bg-white p-6 rounded-2xl border cursor-pointer hover:shadow-md transition-all flex items-center gap-4 text-green-600">
              <div className="p-3 bg-green-50 text-green-700 rounded-xl"><TrendingUp size={24}/></div>
              <div><p className="text-[10px] font-bold text-slate-400 uppercase">Lucro</p><p className="text-xl font-black">R$ {formatMoney(globalMetrics.totalProfit)}</p></div>
          </div>
      </div>

      {/* TABELA COM FILTROS */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden min-h-[400px]">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input type="text" placeholder="Buscar cliente por nome ou CPF..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm"/>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
             {/* 🚀 DROPDOWN DE ORDENAÇÃO */}
             <div className="relative">
                 <select value={sortOrder} onChange={(e: any) => setSortOrder(e.target.value)} className="appearance-none bg-white pl-4 pr-8 py-2.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 shadow-sm outline-none focus:ring-2 focus:ring-slate-900/10 cursor-pointer">
                     <option value="alpha">Ordem Alfabética (A-Z)</option>
                     <option value="newest">Mais Recentes</option>
                     <option value="oldest">Mais Antigos (Inicia no #1)</option>
                 </select>
                 <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16}/>
             </div>

             {/* FILTRO DE STATUS */}
             <div className="relative">
                 <select value={filterStatus} onChange={(e: any) => setFilterStatus(e.target.value)} className="appearance-none bg-white pl-4 pr-8 py-2.5 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 shadow-sm outline-none focus:ring-2 focus:ring-slate-900/10 cursor-pointer">
                     <option value="Todos">Toda a Base</option>
                     <option value="Ativos">Somente Ativos (Em Dia)</option>
                     <option value="Inadimplentes">Inadimplentes</option>
                     <option value="Acordo">Em Acordo</option>
                     <option value="Quitados">Quitados</option>
                 </select>
                 <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16}/>
             </div>

             {selectedIds.length > 0 && (
                 <button onClick={handleExportExcel} className="flex items-center gap-2 bg-[#1E293B] text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors shadow-lg animate-in fade-in zoom-in">
                     <Download size={18} /> Exportar ({selectedIds.length})
                 </button>
             )}
          </div>
        </div>
        
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
              <th className="p-4 text-center w-10"><input type="checkbox" onChange={toggleSelectAll} checked={filteredClients.length > 0 && selectedIds.length === filteredClients.length} className="w-4 h-4 rounded border-gray-300 text-slate-900 cursor-pointer"/></th>
              <th className="p-4">Cliente</th>
              <th className="p-4">Contato</th>
              <th className="p-4 text-center">Status</th>
              <th className="p-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredClients.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-slate-400 italic">Nenhum cliente atende a este filtro.</td></tr>
            ) : (
                filteredClients.map((client: Client) => {
                  const ds = getClientDebtStatus(client.name);
                  return (
                    <tr key={client.id} className={`transition-colors cursor-pointer group ${selectedIds.includes(client.id) ? "bg-blue-50/50" : "hover:bg-slate-50/80"}`} onClick={() => handleOpenModal(client, 'financeiro')}>
                      <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.includes(client.id)} onChange={() => toggleSelectOne(client.id)} className="w-4 h-4 rounded border-gray-300 text-slate-900 cursor-pointer"/>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-slate-900 flex items-center justify-center text-white font-bold text-xs shadow-sm group-hover:bg-blue-600 transition-colors">#{(client as any).displayNumber}</div>
                          <div>
                            <p className="font-bold text-slate-800 group-hover:text-blue-700 transition-colors">{client.name}</p>
                            {/* 🚀 EXIBINDO O APELIDO/OBSERVAÇÃO COM DESTAQUE */}
                            {getNickname(client.observations) && (
                               <p className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full inline-block mt-1 truncate max-w-[200px]" title={getNickname(client.observations)}>
                                 {getNickname(client.observations)}
                               </p>
                            )}
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">{client.cpf}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-xs text-slate-600"><Mail size={12} className="inline mr-1 text-slate-400"/> {client.email || '-'}<br/><Phone size={12} className="inline mr-1 text-slate-400 mt-1"/> {client.phone}</td>
                      <td className="p-4 text-center">
                          <span className={`px-3 py-1 rounded-full text-[9px] font-bold uppercase shadow-sm border ${ds.color === 'red' ? 'bg-red-50 text-red-600 border-red-100' : ds.color === 'orange' ? 'bg-orange-50 text-orange-600 border-orange-100' : ds.color === 'blue' ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-green-50 text-green-600 border-green-100'}`}>{ds.label}</span>
                      </td>
                      <td className="p-4 text-right relative">
                        <button onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === client.id ? null : client.id); }} className="p-2 rounded-lg hover:bg-slate-200 text-slate-400 transition-colors"><MoreVertical size={16} /></button>
                        {openMenuId === client.id && (
                            <div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-2xl border border-slate-100 z-[100] overflow-hidden animate-in fade-in zoom-in-95 origin-top-right">
                                <button onClick={() => handleOpenModal(client, 'dados')} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"><Edit2 size={14}/> Editar Dados</button>
                                <button onClick={() => handleOpenModal(client, 'analise')} className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"><ShieldCheck size={14}/> Ficha de Triagem</button>
                                <div className="border-t border-slate-100"></div>
                                <button onClick={() => handleDelete(client.id)} className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 size={14}/> Excluir</button>
                            </div>
                        )}
                      </td>
                    </tr>
                  )
                })
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL PRINCIPAL */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? `Ficha #${(formData as any).displayNumber}` : "Novo Cliente"}>
        <div className="flex border-b mb-6 font-bold text-sm">
            <button onClick={() => setModalTab('dados')} className={`flex-1 pb-3 border-b-2 ${modalTab === 'dados' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>1. Dados</button>
            <button onClick={() => setModalTab('analise')} className={`flex-1 pb-3 border-b-2 ${modalTab === 'analise' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>2. Triagem</button>
            {editingId && <button onClick={() => setModalTab('financeiro')} className={`flex-1 pb-3 border-b-2 ${modalTab === 'financeiro' ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400'}`}>3. Financeiro</button>}
        </div>

        {modalTab === 'dados' ? (
            <form onSubmit={handleSave} className="space-y-4">
                
                {/* BOTÕES DE SELEÇÃO PF / PJ */}
                <div className="flex bg-slate-100 p-1 rounded-xl">
                    <button 
                        type="button" 
                        onClick={() => setClientType('PF')} 
                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${clientType === 'PF' ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Pessoa Física (PF)
                    </button>
                    <button 
                        type="button" 
                        onClick={() => setClientType('PJ')} 
                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${clientType === 'PJ' ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Empresa (PJ)
                    </button>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border space-y-3">
                    <input 
                        required 
                        placeholder={clientType === 'PF' ? "Nome Completo" : "Razão Social / Nome Fantasia"} 
                        value={formData.name} 
                        onChange={e => setFormData({...formData, name: e.target.value})} 
                        className="w-full p-2.5 border rounded-lg font-bold text-slate-800" 
                    />
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <input 
                                required 
                                placeholder={clientType === 'PF' ? "CPF" : "CNPJ"} 
                                value={formData.cpf} 
                                onChange={e => {
                                    const val = clientType === 'PF' ? maskCPF(e.target.value) : maskCNPJ(e.target.value);
                                    setFormData(prev => {
                                        const autoSync = (prev.pixKeyType === 'CPF' || prev.pixKeyType === 'CNPJ') && (!prev.pixKey || prev.pixKey === prev.cpf);
                                        return { 
                                            ...prev, 
                                            cpf: val, 
                                            ...(autoSync ? { pixKey: val, pixKeyType: clientType === 'PF' ? 'CPF' : 'CNPJ' } : {}) 
                                        };
                                    });
                                }} 
                                className={`w-full p-2.5 border rounded-lg font-mono text-sm ${duplicateWarning ? 'border-red-400 bg-red-50 focus:ring-red-500' : ''}`} 
                            />
                            {duplicateWarning && (
                                <p className="text-[9px] font-bold text-red-500 mt-1 flex items-center gap-1 animate-in fade-in">
                                    <AlertCircle size={10} /> {duplicateWarning}
                                </p>
                            )}
                        </div>
                        <input
                            placeholder={clientType === 'PF' ? "RG (Opcional)" : "Inscrição Estadual (Opcional)"} 
                            value={formData.rg} 
                            onChange={e => {
                                const val = clientType === 'PF' ? maskRG(e.target.value) : e.target.value.toUpperCase();
                                setFormData({...formData, rg: val});
                            }} 
                            className="w-full p-2.5 border rounded-lg text-sm uppercase" 
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <input placeholder="Nacionalidade" value={formData.nationality} onChange={e => setFormData({...formData, nationality: e.target.value})} className="w-full p-2.5 border rounded-lg" />
                        <select value={formData.maritalStatus} onChange={e => setFormData({...formData, maritalStatus: e.target.value})} className="w-full p-2.5 border rounded-lg bg-white text-xs"><option value="SOLTEIRO(A)">Solteiro(a)</option><option value="CASADO(A)">Casado(a)</option><option value="DIVORCIADO(A)">Divorciado(a)</option><option value="VIÚVO(A)">Viúvo(a)</option><option value="UNIÃO ESTÁVEL">União Estável</option></select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <input required placeholder="WhatsApp" value={formData.phone} maxLength={15} onChange={e => {
                            const val = maskPhone(e.target.value);
                            setFormData(prev => {
                                const autoSync = prev.pixKeyType === 'TELEFONE' && (!prev.pixKey || prev.pixKey === prev.phone);
                                return { ...prev, phone: val, ...(autoSync ? { pixKey: val } : {}) };
                            });
                        }} className="w-full p-2.5 border rounded-lg" />
                        <input type="email" placeholder="Email" value={formData.email} onChange={e => {
                            const val = e.target.value;
                            setFormData(prev => {
                                const autoSync = prev.pixKeyType === 'EMAIL' && (!prev.pixKey || prev.pixKey === prev.email);
                                return { ...prev, email: val, ...(autoSync ? { pixKey: val } : {}) };
                            });
                        }} className="w-full p-2.5 border rounded-lg" />
                    </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border space-y-3">
                    <h4 className="text-[10px] font-black uppercase text-slate-400 mb-2 flex items-center gap-1"><CreditCard size={12}/> Dados Bancários / PIX</h4>
                    <div className="mb-3">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Banco do Cliente</label>
                        <input 
                            list="bank-options"
                            placeholder="Digite ou selecione o banco..."
                            value={formData.bankName || ''} 
                            onChange={e => setFormData({...formData, bankName: e.target.value})} 
                            className="w-full p-2.5 border rounded-lg bg-white text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-slate-900/5"
                        />
                        <datalist id="bank-options">
                            <option value="Itaú" />
                            <option value="Bradesco" />
                            <option value="Santander" />
                            <option value="Nubank" />
                            <option value="Inter" />
                            <option value="Caixa Econômica" />
                            <option value="Banco do Brasil" />
                            <option value="C6 Bank" />
                            <option value="PagBank" />
                            <option value="Mercado Pago" />
                        </datalist>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <select value={formData.pixKeyType || 'CPF'} onChange={e => {
                            const type = e.target.value;
                            setFormData(prev => {
                                let pKey = prev.pixKey;
                                if (type === 'CPF' && prev.cpf) pKey = prev.cpf;
                                else if (type === 'TELEFONE' && prev.phone) pKey = prev.phone;
                                else if (type === 'EMAIL' && prev.email) pKey = prev.email;
                                else if (type === 'ALEATORIA' || type === 'DADOS_BANCARIOS' || type === 'CNPJ') pKey = '';
                                return { ...prev, pixKeyType: type, pixKey: pKey };
                            });
                        }} className="w-full p-2.5 border rounded-lg bg-white text-xs font-bold text-slate-600 outline-none">
                            <option value="CPF">CPF</option>
                            <option value="CNPJ">CNPJ</option>
                            <option value="TELEFONE">Telefone</option>
                            <option value="EMAIL">E-mail</option>
                            <option value="ALEATORIA">Aleatória</option>
                            <option value="DADOS_BANCARIOS">Agência/Conta</option>
                        </select>
                        <input placeholder="Digite a Chave Pix ou Conta" value={formData.pixKey || ''} onChange={e => setFormData({...formData, pixKey: e.target.value})} className="col-span-2 w-full p-2.5 border rounded-lg text-sm" />
                    </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border space-y-3">
                    <h4 className="text-[10px] font-black uppercase text-slate-400 mb-2">Localização {isCepLoading && <Loader2 className="animate-spin inline" size={10}/>}</h4>
                    <div className="grid grid-cols-3 gap-3">
                        <input placeholder="CEP" value={formData.cep} onBlur={handleCepBlur} onChange={e => setFormData({...formData, cep: maskCEP(e.target.value)})} className="w-full p-2.5 border rounded-lg" />
                        <input placeholder="Rua" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="col-span-2 w-full p-2.5 border rounded-lg" />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <input placeholder="Nº" value={formData.number} onChange={e => setFormData({...formData, number: e.target.value})} className="w-full p-2.5 border rounded-lg" />
                        <select value={formData.houseType} onChange={e => setFormData({...formData, houseType: e.target.value as any})} className="w-full p-2.5 border rounded-lg bg-white text-xs font-bold"><option value="CASA">Casa</option><option value="APARTAMENTO">Apto</option></select>
                        <input placeholder="Bairro" value={formData.neighborhood} onChange={e => setFormData({...formData, neighborhood: e.target.value})} className="w-full p-2.5 border rounded-lg" />
                    </div>
                    {formData.houseType === 'APARTAMENTO' && (
                        <div className="grid grid-cols-2 gap-3 animate-in slide-in-from-top-1">
                            <div className="flex items-center gap-2 bg-white p-1 border rounded-lg"><Home size={14} className="text-slate-400 ml-1" /><input placeholder="Bloco" value={formData.block} onChange={e => setFormData({...formData, block: e.target.value})} className="w-full p-1 outline-none text-xs" /></div>
                            <div className="flex items-center gap-2 bg-white p-1 border rounded-lg"><Layers size={14} className="text-slate-400 ml-1" /><input placeholder="Andar / Apto" value={formData.floor} onChange={e => setFormData({...formData, floor: e.target.value})} className="w-full p-1 outline-none text-xs" /></div>
                        </div>
                    )}
                    <div className="grid grid-cols-3 gap-3">
                        <input placeholder="Cidade" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="col-span-2 w-full p-2.5 border rounded-lg" />
                        <input placeholder="UF" value={formData.state} maxLength={2} onChange={e => setFormData({...formData, state: e.target.value.toUpperCase()})} className="w-full p-2.5 border rounded-lg uppercase" />
                    </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border">
                    <label className="block text-[10px] font-black uppercase text-slate-400 mb-2">Observações Livres / Informações de Avalistas</label>
                    <textarea value={formData.observations} onChange={e => setFormData({...formData, observations: e.target.value})} className="w-full p-2.5 border rounded-lg outline-none text-sm" placeholder="Anotações gerais ou dados de avalistas frequentes..."></textarea>
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <UploadSlot label="RG Frente" type="RG_FRENTE" /><UploadSlot label="RG Verso" type="RG_VERSO" /><UploadSlot label="Residência" type="COMPROVANTE_RESIDENCIA" />
                </div>

                <div className="pt-4 border-t flex justify-end gap-3">
                    <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-2.5 text-slate-500 font-bold">Cancelar</button>
                    <button type="submit" disabled={isLoading} className="bg-slate-900 text-white px-8 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg">
                        {isLoading ? <Loader2 className="animate-spin" size={18}/> : <CheckCircle size={18}/>} Salvar
                    </button>
                </div>
            </form>
        ) : modalTab === 'analise' ? (
            <div className="space-y-6">
                <div className="bg-slate-900 p-5 rounded-2xl text-white">
                    <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Score</p>
                    <p className="text-4xl font-black text-blue-400">{progressPercentage}%</p>
                    <div className="w-full bg-white/10 rounded-full h-2 mt-3 overflow-hidden"><div className="bg-blue-400 h-full" style={{ width: `${progressPercentage}%` }}></div></div>
                </div>
                <div className="flex border-b gap-4 text-sm font-bold"><button onClick={() => setActiveStage(1)} className={`pb-2 ${activeStage === 1 ? 'border-b-2 border-slate-900' : 'text-slate-400'}`}>1. Perfil</button><button onClick={() => setActiveStage(2)} className={`pb-2 ${activeStage === 2 ? 'border-b-2 border-slate-900' : 'text-slate-400'}`}>2. Docs</button></div>
                <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2">
                    {checklistItems.filter(i => i.stage === activeStage).map(item => (
                        <div key={item.id} onClick={(e) => toggleChecklistItem(item.id, e)} className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer ${item.checked ? 'bg-green-50 border-green-200' : 'bg-white'}`}><div className={`w-5 h-5 rounded border flex items-center justify-center ${item.checked ? 'bg-green-500 border-green-500 text-white' : 'bg-white'}`}>{item.checked && <Check size={12} strokeWidth={4}/>}</div><span className={`text-xs font-bold ${item.checked ? 'text-green-800' : 'text-slate-600'}`}>{item.label}</span></div>
                    ))}
                </div>
                <div className="bg-orange-50 p-4 rounded-xl border border-orange-200"><textarea value={formData.justification} onChange={e => setFormData({...formData, justification: e.target.value})} className="w-full p-3 h-20 text-xs rounded-lg outline-none border-none bg-white/60" placeholder="Parecer da análise..." /></div>
                <button onClick={handleSave} className="w-full py-3 bg-green-600 text-white font-bold rounded-xl shadow-lg">Salvar Análise</button>
            </div>
        ) : (
            <div className="space-y-4">
                {(() => {
                    const st = calculateClientScore(formData.name || '');
                    const red = st.saldoFinal < 0;
                    const clientLoans = loans.filter(l => l.client === formData.name);
                    return (
                        <>
                            <div className={`p-6 rounded-2xl border-2 flex justify-between items-center ${red ? 'bg-red-50 border-red-100 text-red-700' : 'bg-green-50 border-green-100 text-green-700'}`}><div><p className="text-[10px] font-black uppercase opacity-60">Rentabilidade</p><p className="text-3xl font-black">R$ {formatMoney(st.saldoFinal)}</p></div>{red ? <TrendingDown size={40} className="opacity-20"/> : <TrendingUp size={40} className="opacity-20"/>}</div>
                            <div className="grid grid-cols-2 gap-3"><div className="bg-slate-50 p-3 rounded-xl border"><p className="text-[10px] font-bold text-slate-400 uppercase">Emprestado</p><p className="text-lg font-black">R$ {formatMoney(st.totalEmprestado)}</p></div><div className="bg-slate-50 p-3 rounded-xl border"><p className="text-[10px] font-bold text-slate-400 uppercase">Devolvido</p><p className="text-lg font-black">R$ {formatMoney(st.totalDevolvido)}</p></div></div>
                            
                            <div className="mt-6 border-t border-slate-100 pt-4">
                                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2"><List size={14}/> Contratos do Cliente</h4>
                                <div className="max-h-[250px] overflow-y-auto space-y-3 custom-scrollbar pr-2">
                                    {clientLoans.length === 0 ? <p className="text-xs text-slate-400 italic text-center py-4">Sem contratos.</p> : clientLoans.map(l => {
                                        const isClosed = l.status === 'Pago' || l.status === 'Quitado';
                                        return (
                                        <div key={l.id} className={`p-4 border rounded-xl flex justify-between items-center transition-all ${isClosed ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-blue-200 shadow-sm'}`}>
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <p className="font-black text-slate-800 text-sm">#{l.id}</p>
                                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${isClosed ? 'bg-slate-200 text-slate-500' : 'bg-blue-100 text-blue-600'}`}>{l.status}</span>
                                                </div>
                                                <p className="text-[10px] text-slate-400 font-medium">Início: {new Date(l.startDate).toLocaleDateString('pt-BR')}</p>
                                                <p className="font-black text-slate-800 mt-1">R$ {formatMoney(l.amount)}</p>
                                            </div>
                                            <button onClick={() => handleGoToContract(l.id)} className="px-4 py-2 bg-slate-900 text-white text-[10px] uppercase font-bold rounded-lg hover:bg-blue-600 transition-colors shadow-md">Ir para Fatura ➔</button>
                                        </div>
                                    )})}
                                </div>
                            </div>
                        </>
                    )
                })()}
                <button type="button" onClick={() => setIsModalOpen(false)} className="w-full py-4 bg-slate-900 text-white font-bold rounded-xl mt-4">Fechar</button>
            </div>
        )}
      </Modal>

      <Modal 
          isOpen={!!globalMetricModal} 
          onClose={() => { setGlobalMetricModal(null); setExpandedMonth(null); }} 
          title={globalMetricModal === 'lucro' ? 'Fechamento Mensal (Entradas)' : globalMetricModal === 'emprestado' ? 'Histórico de Empréstimos (Saídas)' : globalMetricModal === 'ativos' ? 'Clientes com Dívida Ativa' : 'Consolidado da Base'}
      >
          <div className="max-h-[500px] overflow-y-auto pr-2 space-y-3 custom-scrollbar">
              
              {/* --- CASO 1: LUCRO (ENTRADAS DE DINHEIRO) --- */}
              {globalMetricModal === 'lucro' && (
                  monthlyData.length === 0 ? (
                      <div className="text-center py-8 text-slate-400 italic">Nenhum pagamento registrado ainda.</div>
                  ) : (
                      monthlyData.map((month: any) => (
                          <div key={month.id} className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm transition-all">
                              {/* BARRA DO MÊS (CLICÁVEL PARA EXPANDIR) */}
                              <div 
                                  onClick={() => setExpandedMonth(expandedMonth === month.id ? null : month.id)}
                                  className={`p-4 flex justify-between items-center cursor-pointer transition-colors ${expandedMonth === month.id ? 'bg-slate-50 border-b border-slate-200' : 'hover:bg-slate-50'}`}
                              >
                                  <div className="flex items-center gap-3">
                                      <div className={`p-2.5 rounded-xl text-white ${expandedMonth === month.id ? 'bg-green-600' : 'bg-slate-800'}`}><Calendar size={20}/></div>
                                      <div>
                                          <p className="font-black text-slate-800 text-lg">{month.label}</p>
                                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{Object.keys(month.clients).length} Clientes Pagaram</p>
                                      </div>
                                  </div>
                                  <div className="text-right">
                                      <p className="font-black text-green-600 text-lg">R$ {formatMoney(month.int)}</p>
                                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mt-0.5">Lucro Obtido</span>
                                  </div>
                              </div>
                              
                              {/* CONTEÚDO EXPANDIDO: DETALHES DOS CLIENTES */}
                              {expandedMonth === month.id && (
                                  <div className="p-4 bg-slate-50/50 space-y-4">
                                      <div className="grid grid-cols-2 gap-3 mb-4">
                                          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm text-center">
                                              <span className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Capital Amortizado</span>
                                              <span className="font-black text-slate-700">R$ {formatMoney(month.cap)}</span>
                                          </div>
                                          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm text-center">
                                              <span className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Receita Bruta Total</span>
                                              <span className="font-black text-blue-600">R$ {formatMoney(month.total)}</span>
                                          </div>
                                      </div>
                                      
                                      {Object.entries(month.clients).map(([clientName, data]: any) => {
                                          const clientObj = clients.find(c => c.name === clientName);
                                          return (
                                          <div key={clientName} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                              <div 
                                                  className="p-3 bg-slate-100/50 hover:bg-blue-50 border-b border-slate-100 flex justify-between items-center cursor-pointer transition-colors group"
                                                  onClick={() => {
                                                      if (clientObj) {
                                                          setGlobalMetricModal(null); setExpandedMonth(null);
                                                          handleOpenModal(clientObj, 'financeiro'); 
                                                      }
                                                  }}
                                              >
                                                  <div className="flex items-center gap-2">
                                                      <span className="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition-colors">{clientName}</span>
                                                      <span className="text-[9px] text-blue-500 bg-blue-100 px-1.5 py-0.5 rounded uppercase font-bold opacity-0 group-hover:opacity-100 transition-opacity">Ver Perfil</span>
                                                  </div>
                                                  <span className="text-[10px] font-black text-green-700 bg-green-100 px-2 py-1 rounded-md border border-green-200 uppercase">+ R$ {formatMoney(data.int)} Lucro</span>
                                              </div>
                                              <div className="p-3 divide-y divide-slate-50">
                                                  {data.contracts.map((ct: any, i: number) => (
                                                      <div key={i} className="py-2 flex justify-between items-center group/ctr">
                                                          <div className="cursor-pointer" onClick={() => { setGlobalMetricModal(null); setExpandedMonth(null); handleGoToContract(ct.id); }}>
                                                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest group-hover/ctr:text-blue-600 transition-colors flex items-center gap-1">
                                                                  CTR: {ct.id} <span className="opacity-0 group-hover/ctr:opacity-100 transition-opacity text-[8px] bg-blue-100 text-blue-600 px-1 rounded">Abrir Fatura ➔</span>
                                                              </p>
                                                              <p className="text-[10px] text-slate-500 font-medium mt-0.5">{new Date(ct.date).toLocaleDateString('pt-BR')} às {new Date(ct.date).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}</p>
                                                          </div>
                                                          <div className="text-right">
                                                              <p className="text-xs font-black text-slate-700">R$ {formatMoney(ct.total)}</p>
                                                              <div className="flex gap-2 justify-end mt-0.5">
                                                                  <span className="text-[9px] font-bold text-slate-400 uppercase">Cap: {formatMoney(ct.cap)}</span>
                                                                  <span className="text-[9px] font-bold text-green-500 uppercase">Jur: {formatMoney(ct.int)}</span>
                                                              </div>
                                                          </div>
                                                      </div>
                                                  ))}
                                              </div>
                                          </div>
                                      )})}
                                  </div>
                              )}
                          </div>
                      ))
                  )
              )}

              {/* --- CASO 2: EMPRESTADO (SAÍDAS DE DINHEIRO) --- */}
              {globalMetricModal === 'emprestado' && (
                  monthlyLentData.length === 0 ? (
                      <div className="text-center py-8 text-slate-400 italic">Nenhum empréstimo registrado ainda.</div>
                  ) : (
                      monthlyLentData.map((month: any) => (
                          <div key={month.id} className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm transition-all">
                              <div 
                                  onClick={() => setExpandedMonth(expandedMonth === month.id ? null : month.id)}
                                  className={`p-4 flex justify-between items-center cursor-pointer transition-colors ${expandedMonth === month.id ? 'bg-slate-50 border-b border-slate-200' : 'hover:bg-slate-50'}`}
                              >
                                  <div className="flex items-center gap-3">
                                      <div className={`p-2.5 rounded-xl text-white ${expandedMonth === month.id ? 'bg-orange-600' : 'bg-slate-800'}`}><DollarSign size={20}/></div>
                                      <div>
                                          <p className="font-black text-slate-800 text-lg">{month.label}</p>
                                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{Object.keys(month.clients).length} Clientes Pegaram</p>
                                      </div>
                                  </div>
                                  <div className="text-right">
                                      <p className="font-black text-orange-600 text-lg">R$ {formatMoney(month.total)}</p>
                                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mt-0.5">Total Liberado</span>
                                  </div>
                              </div>
                              
                              {expandedMonth === month.id && (
                                  <div className="p-4 bg-slate-50/50 space-y-4">
                                      {Object.entries(month.clients).map(([clientName, data]: any) => {
                                          const clientObj = clients.find(c => c.name === clientName);
                                          return (
                                          <div key={clientName} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                              <div 
                                                  className="p-3 bg-slate-100/50 hover:bg-blue-50 border-b border-slate-100 flex justify-between items-center cursor-pointer transition-colors group"
                                                  onClick={() => {
                                                      if (clientObj) {
                                                          setGlobalMetricModal(null); setExpandedMonth(null);
                                                          handleOpenModal(clientObj, 'financeiro'); 
                                                      }
                                                  }}
                                              >
                                                  <div className="flex items-center gap-2">
                                                      <span className="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition-colors">{clientName}</span>
                                                      <span className="text-[9px] text-blue-500 bg-blue-100 px-1.5 py-0.5 rounded uppercase font-bold opacity-0 group-hover:opacity-100 transition-opacity">Ver Perfil</span>
                                                  </div>
                                                  <span className="text-[10px] font-black text-orange-700 bg-orange-100 px-2 py-1 rounded-md border border-orange-200 uppercase">R$ {formatMoney(data.total)} Liberado</span>
                                              </div>
                                              <div className="p-3 divide-y divide-slate-50">
                                                  {data.contracts.map((ct: any, i: number) => (
                                                      <div key={i} className="py-2 flex justify-between items-center group/ctr">
                                                          <div className="cursor-pointer" onClick={() => { setGlobalMetricModal(null); setExpandedMonth(null); handleGoToContract(ct.id); }}>
                                                              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest group-hover/ctr:text-blue-600 transition-colors flex items-center gap-1">
                                                                  CTR: {ct.id} <span className="opacity-0 group-hover/ctr:opacity-100 transition-opacity text-[8px] bg-blue-100 text-blue-600 px-1 rounded">Abrir Fatura ➔</span>
                                                              </p>
                                                              <p className="text-[10px] text-slate-500 font-medium mt-0.5">{new Date(ct.date).toLocaleDateString('pt-BR')}</p>
                                                          </div>
                                                          <div className="text-right">
                                                              <p className="text-xs font-black text-slate-700">R$ {formatMoney(ct.total)}</p>
                                                          </div>
                                                      </div>
                                                  ))}
                                              </div>
                                          </div>
                                      )})}
                                  </div>
                              )}
                          </div>
                      ))
                  )
              )}

              {/* --- CASO 3 e 4: BASE e ATIVOS (LISTA DE CLIENTES) --- */}
              {(globalMetricModal === 'base' || globalMetricModal === 'ativos') && (
                  processedClients.filter(c => {
                      if (!c.name) return false; 
                      const ds = getClientDebtStatus(c.name);
                      if (globalMetricModal === 'ativos') {
                          // 🚀 Sincronizado com o Card: Mostra inadimplentes e acordos aqui também
                          return ds.label.includes('Ativo') || ds.label === 'Inadimplente' || ds.label === 'Em Acordo';
                      }
                      return true;
                  }).map(c => (
                      <div 
                          key={c.id} 
                          className="p-3 border rounded-xl flex justify-between items-center bg-white hover:bg-blue-50 transition-colors cursor-pointer group"
                          onClick={() => { setGlobalMetricModal(null); handleOpenModal(c, 'financeiro'); }}
                      >
                          <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center text-[10px] font-bold group-hover:bg-blue-600 transition-colors">#{c.displayNumber}</div>
                              <p className="text-sm font-bold text-slate-700 group-hover:text-blue-700 transition-colors">{c.name}</p>
                          </div>
                          <span className={`text-[10px] px-2 py-1 rounded-md font-bold uppercase tracking-wider ${c.status === 'Bloqueado' ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-green-50 text-green-600 border border-green-100'}`}>{c.status}</span>
                      </div>
                  ))
              )}
          </div>
          
          <div className="mt-4 pt-4 border-t border-slate-100">
              <button onClick={() => { setGlobalMetricModal(null); setExpandedMonth(null); }} className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20">Fechar Janela</button>
          </div>
      </Modal>
    </Layout>
  );
};

export default Clients;