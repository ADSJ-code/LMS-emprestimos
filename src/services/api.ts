import axios from 'axios';

// --- Interfaces (Contrato de Dados com o Back-end) ---

export interface PaymentRecord {
  date: string;
  amount: number;
  type: 'Entrada' | 'Renovação' | 'Amortização' | 'Quitação' | 'Abertura' | 'Parcela' | 'Juros' | 'Acordo' | string;
  note?: string;
  capitalPaid?: number;
  interestPaid?: number;
  registeredAt?: string;
}

export interface Loan {
  id: string;
  client: string;
  amount: number;
  installments: number;
  interestRate: number;
  startDate: string;
  nextDue: string;
  status: 'Em Dia' | 'Atrasado' | 'Pago' | 'Pendente' | 'Acordo';
  installmentValue: number;
  
  fineRate?: number;
  moraInterestRate?: number;
  
  clientBank?: string;
  paymentMethod?: string;
  justification?: string;
  checklistAtApproval?: string[];
  totalPaidInterest?: number;
  totalPaidCapital?: number;
  history?: PaymentRecord[];

  frequency?: 'DIARIO' | 'SEMANAL' | 'MENSAL';
  projectedProfit?: number;
  
  agreementDate?: string; 
  agreementValue?: number;

  affiliateName?: string;
  affiliateFee?: number; 
  affiliateNotes?: string; 

  interestType?: 'PRICE' | 'SIMPLE'; 
  guarantorName?: string;
  guarantorCPF?: string;
  guarantorAddress?: string;
}

export interface ClientDoc {
  name: string;
  data: string; // Base64
  type: string;
}

export interface Client {
  id: number | string;
  name: string;
  cpf: string;
  rg?: string;
  email: string;
  phone: string;
  status: 'Ativo' | 'Pendente' | 'Bloqueado';
  city: string;
  address?: string;
  number?: string;
  neighborhood?: string;
  state?: string;
  cep?: string;
  observations?: string;
  documents?: ClientDoc[];
}

export interface Affiliate {
  id: string;
  name: string;
  email: string;
  phone?: string;
  code?: string;
  pixKey?: string;
  fixedCommission?: number;
  earned?: number;
  status?: string;
}

export interface LogEntry {
  id?: string; // Opcional ao criar
  action: string;
  user: string;
  details: string;
  timestamp?: string;
}

export interface BlacklistEntry {
  id: string;
  name: string;
  cpf: string;
  reason: string;
  date: string;
  riskLevel?: string;
}

export interface SystemUser {
    id?: string;
    username: string;
    email: string;
    name?: string;
    role?: 'ADMIN' | 'USER' | 'MASTER' | string;
}

// --- Configuração da API ---

const API_BASE_URL = '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, 
  headers: {
    'Content-Type': 'application/json',
  }
});

// Interceptor de Autenticação
api.interceptors.request.use(
  (config) => {
    let token = localStorage.getItem('token');
    if (!token) {
        const session = localStorage.getItem('lms_active_session');
        if (session) {
            try {
                const parsed = JSON.parse(session);
                token = parsed.token;
            } catch (e) {
                console.error("Erro ao ler token da sessão", e);
            }
        }
    }
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Interceptor de Erro (401 = Logout)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401 && !window.location.pathname.includes('/login')) {
        console.warn("Sessão expirada. Redirecionando para login.");
        authService.logout();
        window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ============================================================================
// O ESPIÃO DO HISTÓRICO: Registra ações automaticamente no banco de dados
// ============================================================================
const getLoggedUser = () => {
    try {
        const sessionStr = localStorage.getItem('lms_active_session');
        if (sessionStr) {
            const sessionData = JSON.parse(sessionStr);
            const user = sessionData.user || sessionData;
            return user.name || user.username || user.email || 'Usuário Desconhecido';
        }
        return 'Sistema';
    } catch (e) {
        return 'Sistema';
    }
};

const registerSystemLog = async (action: string, details: string) => {
    try {
        const log: LogEntry = {
            action,
            details,
            user: getLoggedUser(),
            timestamp: new Date().toISOString()
        };
        // Envia silenciosamente para o backend sem travar a interface
        await api.post('/logs', log).catch(() => {});
    } catch (e) {
        // Ignora erros para não quebrar as funções principais
    }
};


// --- SERVIÇOS CONECTADOS AO BACKEND GO ---

export const authService = {
  login: async (username: string, password: string) => {
    const response = await api.post('/auth/login', { username, password });
    if (response.data.token) {
        localStorage.setItem('token', response.data.token);
    }
    // Log de Login (Feito aqui porque o interceptor ainda não tinha o usuário)
    const userLog = response.data.user?.name || response.data.user?.username || username;
    api.post('/logs', { action: 'Login no Sistema', details: 'Autenticação bem sucedida', user: userLog, timestamp: new Date().toISOString() }).catch(()=>{});
    return response.data;
  },
  listUsers: async (): Promise<SystemUser[]> => {
    const response = await api.get('/users');
    return response.data;
  },
  addUser: async (userData: any) => {
    const response = await api.post('/users', userData);
    await registerSystemLog('Novo Usuário', `Usuário ${userData.email} adicionado`);
    return response.data;
  },
  updateUser: async (email: string, newData: any) => {
    const response = await api.put(`/users/${email}`, newData);
    await registerSystemLog('Edição de Usuário', `Senha/Dados do usuário ${email} alterados`);
    return response.data;
  },
  removeUser: async (email: string) => {
    await api.delete(`/users/${email}`);
    await registerSystemLog('Exclusão de Usuário', `Usuário ${email} removido`);
  },
  logout: () => {
    registerSystemLog('Logout do Sistema', 'Sessão encerrada');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('lms_active_session');
  }
};

export const loanService = {
  getAll: async (): Promise<Loan[]> => {
    const response = await api.get('/loans');
    return response.data || [];
  },
  create: async (loan: Loan): Promise<Loan> => {
    const response = await api.post('/loans', loan);
    await registerSystemLog('Novo Empréstimo', `Contrato ${loan.id} criado para ${loan.client} (R$ ${loan.amount})`);
    return response.data;
  },
  update: async (id: string, loan: Loan): Promise<Loan> => {
    const response = await api.put(`/loans/${id}`, loan);
    
    // Tenta ser inteligente para registrar a baixa
    if (loan.history && loan.history.length > 0) {
        const lastRecord = loan.history[loan.history.length - 1];
        // Se a data do registro for recente (último minuto), significa que acabou de ser feito
        if (lastRecord.registeredAt && (new Date().getTime() - new Date(lastRecord.registeredAt).getTime()) < 60000) {
            await registerSystemLog(`Registro de Baixa (${lastRecord.type})`, `R$ ${lastRecord.amount} no contrato ${loan.id} - ${loan.client}`);
        } else {
            // Caso seja apenas uma atualização de Acordo ou similar
            await registerSystemLog('Alteração Contratual', `Contrato ${loan.id} modificado`);
        }
    } else {
        await registerSystemLog('Alteração Contratual', `Contrato ${loan.id} modificado`);
    }

    return response.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/loans/${id}`);
    await registerSystemLog('Exclusão Crítica', `Contrato ${id} excluído do banco de dados`);
  }
};

export const clientService = {
  getAll: async (): Promise<Client[]> => {
    const response = await api.get('/clients');
    return response.data || [];
  },
  create: async (client: Client): Promise<Client> => {
    const response = await api.post('/clients', client);
    await registerSystemLog('Novo Cliente', `Cliente ${client.name} cadastrado`);
    return response.data;
  },
  update: async (id: number | string, client: Client): Promise<Client> => {
    const response = await api.put(`/clients/${id}`, client);
    await registerSystemLog('Atualização de Cliente', `Dados de ${client.name} atualizados`);
    return response.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/clients/${id}`);
    await registerSystemLog('Exclusão de Cliente', `Cliente ID ${id} removido`);
  }
};

export const affiliateService = {
  getAll: async (): Promise<Affiliate[]> => {
    const response = await api.get('/affiliates');
    return response.data || [];
  },
  create: async (affiliate: Affiliate): Promise<Affiliate> => {
    const response = await api.post('/affiliates', affiliate);
    await registerSystemLog('Novo Afiliado', `${affiliate.name} cadastrado`);
    return response.data;
  },
  update: async (id: string, affiliate: Affiliate): Promise<Affiliate> => {
    const response = await api.put(`/affiliates/${id}`, affiliate);
    await registerSystemLog('Edição de Afiliado', `Afiliado ${affiliate.name} atualizado`);
    return response.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/affiliates/${id}`);
    await registerSystemLog('Exclusão', `Afiliado ID ${id} removido`);
  }
};

export const blacklistService = {
  getAll: async (): Promise<BlacklistEntry[]> => {
    const response = await api.get('/blacklist');
    return response.data || [];
  },
  create: async (entry: BlacklistEntry): Promise<BlacklistEntry> => {
    const response = await api.post('/blacklist', entry);
    await registerSystemLog('Ação Restritiva', `${entry.name} adicionado à Lista Negra`);
    return response.data;
  },
  update: async (id: string, entry: BlacklistEntry): Promise<BlacklistEntry> => {
    const response = await api.put(`/blacklist/${id}`, entry);
    await registerSystemLog('Ação Restritiva', `Registro de ${entry.name} atualizado na Lista Negra`);
    return response.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/blacklist/${id}`);
    await registerSystemLog('Ação Liberada', `Registro ID ${id} removido da Lista Negra`);
  }
};

export const historyService = {
  getLogs: async (): Promise<LogEntry[]> => {
    const response = await api.get('/logs');
    return response.data || [];
  }
};

export const settingsService = {
  get: async () => {
    try {
        const response = await api.get('/settings');
        return response.data;
    } catch (e) {
        console.warn("Usando configurações padrão (API offline ou vazia)");
        return {
            company: { name: 'EMPRESA PADRÃO', cnpj: '', phone: '', email: '' },
            system: { warningDays: 3 }
        };
    }
  },
  save: async (settings: any) => {
    // Normalização de Payload para o Backend Go
    let payload = settings;
    
    // Se estiver no formato antigo (flat), converte para aninhado
    if (!settings.company && settings.name) {
         payload = {
             company: {
                 name: settings.name,
                 cnpj: settings.cnpj,
                 pixKey: settings.pixKey,
                 email: settings.email,
                 phone: settings.phone,
                 address: settings.address
             },
             system: {
                 autoBackup: settings.autoBackup || false,
                 requireLogin: true,
                 warningDays: settings.warningDays || 3
             }
         };
    }
    const response = await api.post('/settings', payload);
    await registerSystemLog('Configuração do Sistema', `Dados da empresa/sistema foram alterados`);
    return response.data;
  },
  restoreBackup: async (backupData: any) => {
    // Timeout estendido para restauração
    const response = await api.post('/admin/restore', backupData, { timeout: 60000 });
    // O log será disparado, mas como o sistema será zerado logo em seguida, pode não durar, o que é esperado num reset
    await registerSystemLog('Segurança Crítica', `Restauração completa de backup via arquivo JSON realizada`);
    return response.data;
  }
};

export const dashboardService = {
  getSummary: async () => {
    const response = await api.get('/dashboard/summary');
    return response.data;
  }
};

export default api;