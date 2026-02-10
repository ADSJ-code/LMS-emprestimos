import axios from 'axios';

// --- Interfaces (Contrato de Dados com o Back-end) ---

export interface PaymentRecord {
  date: string;
  amount: number;
  type: 'Entrada' | 'Renovação' | 'Amortização' | 'Quitação' | 'Abertura' | 'Parcela' | 'Juros' | string;
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
  status: 'Em Dia' | 'Atrasado' | 'Pago' | 'Pendente';
  installmentValue: number;
  fineRate?: number;
  clientBank?: string;
  paymentMethod?: string;
  moraInterestRate?: number;
  justification?: string;
  checklistAtApproval?: string[];
  totalPaidInterest?: number;
  totalPaidCapital?: number;
  history?: PaymentRecord[];

  // --- CORREÇÃO: AGORA TUDO MINÚSCULO (camelCase) PARA BATER COM O BACKEND ---
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
  id: string;
  action: string;
  user: string;
  details: string;
  timestamp: string;
}

export interface BlacklistEntry {
  id: string;
  name: string;
  cpf: string;
  reason: string;
  date: string;
  riskLevel?: string;
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

// --- SERVIÇOS CONECTADOS AO BACKEND GO ---

export const authService = {
  login: async (username: string, password: string) => {
    const response = await api.post('/auth/login', { username, password });
    if (response.data.token) {
        localStorage.setItem('token', response.data.token);
    }
    return response.data;
  },
  listUsers: async () => {
    const response = await api.get('/users');
    return response.data;
  },
  addUser: async (userData: any) => {
    const response = await api.post('/users', userData);
    return response.data;
  },
  updateUser: async (email: string, newData: any) => {
    const response = await api.put(`/users/${email}`, newData);
    return response.data;
  },
  removeUser: async (email: string) => {
    await api.delete(`/users/${email}`);
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('lms_active_session');
  }
};

export const loanService = {
  getAll: async (): Promise<Loan[]> => {
    const response = await api.get('/loans');
    return response.data;
  },
  create: async (loan: Loan): Promise<Loan> => {
    const response = await api.post('/loans', loan);
    return response.data;
  },
  update: async (id: string, loan: Loan): Promise<Loan> => {
    const response = await api.put(`/loans/${id}`, loan);
    return response.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/loans/${id}`);
  }
};

export const clientService = {
  getAll: async (): Promise<Client[]> => {
    const response = await api.get('/clients');
    return response.data;
  },
  create: async (client: Client): Promise<Client> => {
    const response = await api.post('/clients', client);
    return response.data;
  },
  update: async (id: number | string, client: Client): Promise<Client> => {
    const response = await api.put(`/clients/${id}`, client);
    return response.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/clients/${id}`);
  }
};

export const affiliateService = {
  getAll: async (): Promise<Affiliate[]> => {
    const response = await api.get('/affiliates');
    return response.data;
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
    return response.data;
  },
  create: async (entry: BlacklistEntry): Promise<BlacklistEntry> => {
    const response = await api.post('/blacklist', entry);
    return response.data;
  },
  update: async (id: string, entry: BlacklistEntry): Promise<BlacklistEntry> => {
    const response = await api.put(`/blacklist/${id}`, entry);
    return response.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/blacklist/${id}`);
  }
};

export const historyService = {
  getLogs: async (): Promise<LogEntry[]> => {
    const response = await api.get('/logs');
    return response.data;
  }
};

export const settingsService = {
  get: async () => {
    const response = await api.get('/settings');
    return response.data;
  },
  save: async (settings: any) => {
    let payload = settings;
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
                 requireLogin: true
             }
         };
    }
    const response = await api.post('/settings', payload);
    return response.data;
  },
  restoreBackup: async (backupData: any) => {
    const response = await api.post('/admin/restore', backupData);
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