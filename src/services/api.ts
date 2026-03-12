import axios from 'axios';

export interface PaymentRecord {
  date: string;
  amount: number;
  type: 'Entrada' | 'Renovação' | 'Amortização' | 'Quitação' | 'Abertura' | 'Parcela' | 'Juros' | 'Acordo' | string;
  note?: string;
  capitalPaid?: number;
  interestPaid?: number;
  registeredAt?: string;
  originalDueDate?: string; 
}

export interface Loan {
  id: string;
  client: string;
  amount: number;
  installments: number;
  interestRate: number;
  startDate: string;
  nextDue: string;
  status: 'Em Dia' | 'Atrasado' | 'Pago' | 'Pendente' | 'Acordo' | 'Quitado';
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
  data: string; 
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
  id?: string;
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
    role?: string;
}

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
            try { token = JSON.parse(session).token; } catch (e) {}
        }
    }
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401 && !window.location.pathname.includes('/login')) {
        authService.logout();
        window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ============================================================================
// INTELIGÊNCIA DA CAIXA-PRETA (BLACKBOX LOGS)
// ============================================================================
export const getLoggedUser = () => {
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
            if (userObj?.email) return userObj.email;
        }
        return 'Administrador Mestre'; 
    } catch (e) { return 'Administrador Mestre'; }
};

export const registerSystemLog = async (action: string, details: string) => {
    const logEntry: LogEntry = {
        id: 'loc-' + Date.now() + Math.floor(Math.random() * 1000),
        action,
        details,
        user: getLoggedUser(),
        timestamp: new Date().toISOString()
    };

    // 1. Salva na Nuvem (Tenta usar a API do Go)
    try {
        const token = localStorage.getItem('token') || '';
        await axios.post(`${API_BASE_URL}/logs`, logEntry, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch (e) { /* Ignora se o Go recusar */ }

    // 2. Salva na Caixa Preta (Garantia de que a tela de histórico sempre verá)
    try {
        const local = JSON.parse(localStorage.getItem('lms_blackbox_logs') || '[]');
        local.push(logEntry);
        if (local.length > 300) local.shift(); // Evita sobrecarga de memória
        localStorage.setItem('lms_blackbox_logs', JSON.stringify(local));
    } catch (e) {}
};

// --- SERVIÇOS ---

export const authService = {
  login: async (username: string, password: string) => {
    const response = await api.post('/auth/login', { username, password });
    if (response.data.token) localStorage.setItem('token', response.data.token);
    await registerSystemLog('ACESSO', `Login autorizado no sistema`);
    return response.data;
  },
  listUsers: async (): Promise<SystemUser[]> => {
    const response = await api.get('/users');
    return response.data;
  },
  addUser: async (userData: any) => {
    const response = await api.post('/users', userData);
    await registerSystemLog('NOVO USUÁRIO', `Criou acesso para ${userData.email}`);
    return response.data;
  },
  updateUser: async (email: string, newData: any) => {
    const response = await api.put(`/users/${email}`, newData);
    await registerSystemLog('EDIÇÃO', `Alterou dados do usuário ${email}`);
    return response.data;
  },
  removeUser: async (email: string) => {
    await api.delete(`/users/${email}`);
    await registerSystemLog('EXCLUSÃO', `Usuário ${email} deletado`);
  },
  logout: () => {
    registerSystemLog('SAÍDA', `Sessão encerrada voluntariamente`);
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
    await registerSystemLog('CONTRATO CRIADO', `Valor de R$ ${loan.amount} para o cliente ${loan.client}`);
    return response.data;
  },
  // ATUALIZADO: Aceita os parâmetros dinâmicos de log
  update: async (id: string, loan: Loan, logAction?: string, logDetails?: string): Promise<Loan> => {
    const response = await api.put(`/loans/${id}`, loan);
    const action = logAction || 'ATUALIZAÇÃO GERAL';
    const details = logDetails || `Alteração nos dados do contrato de ${loan.client}`;
    await registerSystemLog(action, details);
    return response.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/loans/${id}`);
    await registerSystemLog('EXCLUSÃO CRÍTICA', `Contrato ID ${id} foi completamente deletado do sistema.`);
  }
};

export const clientService = {
  getAll: async (): Promise<Client[]> => {
    const response = await api.get('/clients');
    return response.data || [];
  },
  create: async (client: Client): Promise<Client> => {
    const response = await api.post('/clients', client);
    await registerSystemLog('CLIENTE CRIADO', `Cadastrou o cliente: ${client.name}`);
    return response.data;
  },
  update: async (id: number | string, client: Client): Promise<Client> => {
    const response = await api.put(`/clients/${id}`, client);
    await registerSystemLog('CLIENTE EDITADO', `Atualizou os dados de: ${client.name}`);
    return response.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/clients/${id}`);
    await registerSystemLog('EXCLUSÃO DE CLIENTE', `O cliente ID ${id} foi removido`);
  }
};

export const affiliateService = {
  getAll: async (): Promise<Affiliate[]> => {
    const response = await api.get('/affiliates');
    return response.data || [];
  },
  create: async (affiliate: Affiliate): Promise<Affiliate> => {
    const response = await api.post('/affiliates', affiliate);
    return response.data;
  },
  update: async (id: string, affiliate: Affiliate): Promise<Affiliate> => {
    const response = await api.put(`/affiliates/${id}`, affiliate);
    return response.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/affiliates/${id}`);
  }
};

export const blacklistService = {
  getAll: async (): Promise<BlacklistEntry[]> => {
    const response = await api.get('/blacklist');
    return response.data || [];
  },
  create: async (entry: BlacklistEntry): Promise<BlacklistEntry> => {
    const response = await api.post('/blacklist', entry);
    await registerSystemLog('LISTA NEGRA', `Bloqueou o CPF ${entry.cpf} - Motivo: ${entry.reason}`);
    return response.data;
  },
  update: async (id: string, entry: BlacklistEntry): Promise<BlacklistEntry> => {
    const response = await api.put(`/blacklist/${id}`, entry);
    return response.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/blacklist/${id}`);
    await registerSystemLog('LISTA NEGRA', `Removeu o bloqueio do ID ${id}`);
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
        return {
            company: { name: 'EMPRESA PADRÃO', cnpj: '', phone: '', email: '' },
            system: { warningDays: 3 }
        };
    }
  },
  save: async (settings: any) => {
    let payload = settings;
    if (!settings.company && settings.name) {
         payload = {
             company: { name: settings.name, cnpj: settings.cnpj, pixKey: settings.pixKey, email: settings.email, phone: settings.phone, address: settings.address },
             system: { autoBackup: settings.autoBackup || false, requireLogin: true, warningDays: settings.warningDays || 3 }
         };
    }
    const response = await api.post('/settings', payload);
    await registerSystemLog('CONFIGURAÇÕES', `Alterou os parâmetros vitais do sistema`);
    return response.data;
  },
  restoreBackup: async (backupData: any) => {
    const response = await api.post('/admin/restore', backupData, { timeout: 60000 });
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