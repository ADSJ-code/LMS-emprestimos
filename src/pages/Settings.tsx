import React, { useState, useEffect, useRef } from "react";
import {
  Save,
  Building,
  Shield,
  CheckCircle,
  RefreshCw,
  Download,
  Users,
  Plus,
  Trash2,
  Key,
  X,
  AlertTriangle,
  Upload,
  Loader2,
  Bell,
  Lock,
  Calculator,
  MessageCircle,
  ArrowRight,
  Activity,
} from "lucide-react";
import Layout from "../components/Layout";
import {
  settingsService,
  clientService,
  loanService,
  authService,
} from "../services/api";

const getApiUrl = () =>
  `https://creditnow-prod-266321031136.us-central1.run.app`;
localStorage.setItem("getApiUrl", getApiUrl());

// --- COMPONENTE MODAL GENÉRICO ---
const Modal = ({ isOpen, onClose, title, children, color = "slate" }: any) => {
  if (!isOpen) return null;

  const headerColors: any = {
    slate: "bg-slate-50 border-slate-100",
    red: "bg-red-50 border-red-100 text-red-900",
    blue: "bg-blue-50 border-blue-100 text-blue-900",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div
          className={`px-6 py-4 border-b flex justify-between items-center ${headerColors[color] || headerColors.slate}`}
        >
          <h3 className="font-bold flex items-center gap-2">{title}</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
};

const Settings = () => {
  const [activeTab, setActiveTab] = useState<
    "empresa" | "sistema" | "usuarios" | "whatsapp"
  >("empresa");
  const [isLoading, setIsLoading] = useState(false);

  // --- AUTH & USER DATA ---
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // --- USER MANAGEMENT STATES ---
  const [users, setUsers] = useState<any[]>([]);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "" });
  const [isUserLoading, setIsUserLoading] = useState(false);

  // --- MODALS STATES ---
  const [showSuccess, setShowSuccess] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string | null>(
    null,
  );
  const [newPasswordReset, setNewPasswordReset] = useState("");

  // --- DANGER ZONE STATES (RESTORE/RESET) ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dangerModalOpen, setDangerModalOpen] = useState(false);
  const [dangerActionType, setDangerActionType] = useState<
    "RESET" | "RESTORE" | null
  >(null);
  const [securityCode, setSecurityCode] = useState("");
  const [confirmText, setConfirmText] = useState("");

  // --- SETTINGS FORM STATE ---
  const defaultSettings = {
    company: {
      name: localStorage.getItem("lms_company_name_cache") || "",
      cnpj: "",
      pixKey: "",
      email: "",
      phone: "",
      address: "",
    },
    system: {
      autoBackup: false,
      requireLogin: true,
      warningDays: 3,
    },
  };
  const [settings, setSettings] = useState<any>(defaultSettings);

  // MODO DE AMORTIZAÇÃO
  const [amortizationMode, setAmortizationMode] = useState<"LINEAR" | "PRICE">(
    (localStorage.getItem("amortizationMode") as "LINEAR" | "PRICE") ||
      "LINEAR",
  );

  // --- ESTADOS WHATSAPP ---
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrCodeBase64, setQrCodeBase64] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  // FUNÇÃO DE CONEXÃO INTEGRADA COM BACKEND GO
  const handleConnectWhatsApp = async (nome: string, phone: string) => {
    setIsConnecting(true);

    try {
      const response = await fetch(`${getApiUrl()}/api/instances/conectar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome, phone: phone }),
      });

      const data = await response.json();

      const statusText = String(data.details?.status || data.status || "");
      const messageText = String(
        data.details?.message || data.message || "",
      ).toLowerCase();

      const isMissing =
        statusText.includes("404") ||
        statusText.includes("405") ||
        messageText.includes("not found") ||
        messageText.includes("não encontrada");

      if (isMissing) {
        console.log("⚠️ Instância ausente detectada. Criando...");

        const createRes = await fetch(
          `${getApiUrl()}/api/instances/criar`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: nome,
              phone: phone,
            }),
          },
        );

        if (createRes.ok) {
          console.log("✅ Instância criada. Tentando conectar em 1.5s...");
          setTimeout(() => handleConnectWhatsApp(nome, phone), 1500);
          return;
        } else {
          alert("Erro ao criar instância.");
          setIsConnecting(false);
          return;
        }
      }

      const qrCode = data.details?.base64 || data.base64;

      if (qrCode) {
        setQrCodeBase64(qrCode);
        setShowQRModal(true);
      } else if (
        data.status === "CONNECTED" ||
        data.instance?.state === "open" ||
        messageText.includes("already connected")
      ) {
        alert("WhatsApp já está conectado!");
      } else {
        console.log("Resposta inesperada:", data);
        alert("Não foi possível obter o QR Code.");
      }
    } catch (error) {
      console.error("Erro na requisição:", error);
      alert("Erro de rede ao comunicar com o servidor.");
    } finally {
      setIsConnecting(false);
    }
  };

  // --- INITIAL LOAD ---
  useEffect(() => {
    let userObj = null;
    const sessionStr = localStorage.getItem("lms_active_session");

    if (sessionStr) {
      try {
        const sessionData = JSON.parse(sessionStr);
        userObj = sessionData.user || sessionData;
      } catch (e) {
        console.error(e);
      }
    }

    if (userObj) {
      setCurrentUser(userObj);
      const userRole = (userObj.role || "").toUpperCase();
      if (userRole.includes("ADMIN") || userRole.includes("MASTER")) {
        setIsAdmin(true);
      }
    }

    const fetchData = async () => {
      try {
        const data = await settingsService.get();
        if (data) {
          setSettings({
            company: { ...defaultSettings.company, ...data.company },
            system: { ...defaultSettings.system, ...data.system },
          });
        }
        const userList = await authService.listUsers();
        setUsers(userList || []);
      } catch (err) {
        console.error(err);
      }
    };
    fetchData();
  }, []);

  // --- HANDLERS: EMPRESA E SISTEMA ---
  const handleSave = async (e?: React.FormEvent) => {
    if(e) e.preventDefault();
    if (!isAdmin) {
      alert("Você não tem permissão para alterar as configurações.");
      return;
    }

    localStorage.setItem("companyName", settings.company.name);
    localStorage.setItem(
      "companyPhone",
      settings.company.phone.replace(/\D/g, "") || "",
    );
    
    setIsLoading(true);
    try {
      await settingsService.save(settings);
      if (settings.company?.name) {
        localStorage.setItem(
          "lms_company_name_cache",
          settings.company.name.toUpperCase(),
        );
      }
      localStorage.setItem("amortizationMode", amortizationMode);
      setIsLoading(false);
      setShowSuccess(true);
      window.dispatchEvent(new Event("settingsUpdated"));
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      alert("Falha ao salvar as configurações.");
      setIsLoading(false);
    }
  };

  const updateCompany = (f: string, v: string) => {
    setSettings((p: any) => ({ ...p, company: { ...p.company, [f]: v } }));
  };

  const updateSystem = (f: string, v: any) => {
    setSettings((p: any) => ({ ...p, system: { ...p.system, [f]: v } }));
  };

  // --- FUNÇÃO REAL DE BACKUP ---
  const handleExportBackup = async () => {
    try {
      setIsLoading(true);
      const [clientsData, loansData] = await Promise.all([
        clientService.getAll(),
        loanService.getAll()
      ]);
      
      const backupData = {
        exportedAt: new Date().toISOString(),
        settings: settings,
        clients: clientsData,
        loans: loansData
      };

      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `backup_sistema_${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      
      alert("✅ Backup gerado e baixado com sucesso!");
    } catch (error) {
      alert("❌ Erro ao gerar arquivo de backup.");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  // --- USUÁRIOS & SEGURANÇA ---
  const handleAddUser = async () => {
    if (!isAdmin) return;
    if (!newUser.name || !newUser.email || !newUser.password)
      return alert("Preencha tudo");
    setIsUserLoading(true);
    try {
      await authService.addUser(newUser);
      const updatedList = await authService.listUsers();
      setUsers(updatedList || []);
      setNewUser({ name: "", email: "", password: "" });
      alert("Usuário adicionado!");
    } catch (err) {
      alert("Erro ao adicionar");
    } finally {
      setIsUserLoading(false);
    }
  };

  const handleSecurityCheck = () => {
    if (securityCode !== "SUPORTE" && securityCode !== "admin123") {
      alert("Código incorreto.");
      return;
    }
    if (dangerActionType === "RESTORE") {
      setDangerModalOpen(false);
      fileInputRef.current?.click();
    } else if (dangerActionType === "RESET") {
      if (confirmText !== "CONFIRMAR") return;
      alert("Reset efetuado (simulação)");
      setDangerModalOpen(false);
    }
  };

  return (
    <Layout>
      <header className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800">Configurações</h2>
        <p className="text-slate-500">
          Gestão global, usuários e integração WhatsApp.
        </p>
      </header>

      <div className="flex flex-col lg:flex-row gap-8">
        <aside className="w-full lg:w-64 flex-shrink-0">
          <nav className="flex flex-col gap-2">
            {[
              { id: "empresa", label: "Dados da Empresa", icon: Building },
              { id: "usuarios", label: "Usuários do Sistema", icon: Users },
              { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
              { id: "sistema", label: "Sistema e Backup", icon: Shield },
            ].map((t: any) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-colors text-left ${activeTab === t.id ? "bg-slate-900 text-white shadow-md" : "bg-white text-slate-600 hover:bg-gray-50"}`}
              >
                <t.icon size={18} /> {t.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="flex-1">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 relative min-h-[500px]">
            {showSuccess && (
              <div className="absolute top-4 right-4 bg-green-100 text-green-800 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 z-10 animate-in fade-in">
                <CheckCircle size={16} /> Salvo com sucesso!
              </div>
            )}

            {!isAdmin && activeTab !== "whatsapp" && (
                <div className="mb-6 bg-orange-50 border border-orange-200 text-orange-800 px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-3">
                    <Lock size={18} className="text-orange-600" />
                    Modo Leitura: Apenas administradores podem alterar essas configurações.
                </div>
            )}

            {activeTab === "empresa" && (
              <form
                onSubmit={handleSave}
                className="space-y-6 animate-in fade-in"
              >
                <div className="flex items-center gap-3 border-b border-gray-100 pb-2">
                  <Building className="text-slate-400" />
                  <h3 className="text-lg font-bold text-slate-800">
                    Dados Cadastrais
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                      Nome Fantasia
                    </label>
                    <input
                      type="text"
                      value={settings.company.name}
                      onChange={(e) => updateCompany("name", e.target.value)}
                      disabled={!isAdmin}
                      className="w-full p-3 border border-slate-200 rounded-xl outline-none font-bold text-slate-700 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                      CNPJ
                    </label>
                    <input
                      type="text"
                      value={settings.company.cnpj}
                      onChange={(e) => updateCompany("cnpj", e.target.value)}
                      disabled={!isAdmin}
                      className="w-full p-3 border border-slate-200 rounded-xl outline-none disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                      Telefone / WhatsApp
                    </label>
                    <input
                      type="text"
                      value={settings.company.phone}
                      onChange={(e) => updateCompany("phone", e.target.value)}
                      disabled={!isAdmin}
                      className="w-full p-3 border border-slate-200 rounded-xl outline-none disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                      Email de Contato
                    </label>
                    <input
                      type="email"
                      value={settings.company.email}
                      onChange={(e) => updateCompany("email", e.target.value)}
                      disabled={!isAdmin}
                      className="w-full p-3 border border-slate-200 rounded-xl outline-none disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-green-700 uppercase mb-1">
                      Chave PIX Padrão
                    </label>
                    <input
                      type="text"
                      value={settings.company.pixKey}
                      onChange={(e) => updateCompany("pixKey", e.target.value)}
                      disabled={!isAdmin}
                      className="w-full p-3 border border-green-200 bg-green-50/30 text-green-800 font-mono rounded-xl outline-none disabled:bg-slate-50 disabled:text-slate-500 disabled:border-slate-200"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                      Endereço Completo
                    </label>
                    <input
                      type="text"
                      value={settings.company.address}
                      onChange={(e) => updateCompany("address", e.target.value)}
                      disabled={!isAdmin}
                      className="w-full p-3 border border-slate-200 rounded-xl outline-none disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                </div>
                
                {isAdmin && (
                    <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end">
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-slate-800 shadow-lg"
                    >
                        {isLoading ? (
                        <Loader2 className="animate-spin" size={18} />
                        ) : (
                        "Salvar Alterações"
                        )}
                    </button>
                    </div>
                )}
              </form>
            )}

            {activeTab === "usuarios" && (
              <div className="space-y-6 animate-in fade-in">
                <div className="flex items-center gap-3 border-b border-gray-100 pb-2">
                  <Users className="text-slate-400" />
                  <h3 className="text-lg font-bold text-slate-800">
                    Gerenciar Acessos
                  </h3>
                </div>
                <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-slate-100 text-xs font-bold text-slate-500 uppercase">
                      <tr>
                        <th className="p-4">Nome</th>
                        <th className="p-4">Email</th>
                        <th className="p-4 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {users.map((u, idx) => (
                        <tr
                          key={idx}
                          className="hover:bg-white transition-colors"
                        >
                          <td className="p-4 font-bold text-slate-700">
                            {u.name}
                          </td>
                          <td className="p-4 text-slate-600 text-sm">
                            {u.username || u.email}
                          </td>
                          <td className="p-4 text-right">
                            {isAdmin && (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  title="Alterar Senha"
                                  onClick={() => {
                                    setSelectedUserEmail(u.username || u.email);
                                    setResetModalOpen(true);
                                  }}
                                  className="text-blue-600 p-2 hover:bg-blue-50 rounded-lg transition-colors"
                                >
                                  <Key size={16} />
                                </button>
                                <button
                                  title="Excluir Usuário"
                                  onClick={() => {
                                    if(confirm("Deseja realmente remover este acesso?")) {
                                       alert("A exclusão de usuários deve estar conectada à API.");
                                    }
                                  }}
                                  className="text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {isAdmin && (
                  <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
                    <h4 className="font-bold text-slate-800 mb-4 text-sm uppercase">
                      Cadastrar Novo Usuário
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <input
                        type="text"
                        placeholder="Nome"
                        value={newUser.name}
                        onChange={(e) =>
                          setNewUser({ ...newUser, name: e.target.value })
                        }
                        className="p-3 border rounded-lg text-sm"
                      />
                      <input
                        type="email"
                        placeholder="Email"
                        value={newUser.email}
                        onChange={(e) =>
                          setNewUser({ ...newUser, email: e.target.value })
                        }
                        className="p-3 border rounded-lg text-sm"
                      />
                      <input
                        type="password"
                        placeholder="Senha"
                        value={newUser.password}
                        onChange={(e) =>
                          setNewUser({ ...newUser, password: e.target.value })
                        }
                        className="p-3 border rounded-lg text-sm"
                      />
                    </div>
                    <button
                      onClick={handleAddUser}
                      className="mt-4 w-full bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-slate-800"
                    >
                      Adicionar Usuário
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === "whatsapp" && (
              <div className="space-y-6 animate-in fade-in">
                <div className="flex items-center gap-3 border-b border-gray-100 pb-2">
                  <CheckCircle className="text-green-500" />
                  <h3 className="text-lg font-bold text-slate-800">
                    Integração WhatsApp
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <p className="text-sm text-slate-500">
                      Conecte sua instância para disparos automáticos.
                    </p>
                    <button
                      onClick={() =>
                        handleConnectWhatsApp(
                          settings.company.name,
                          settings.company.phone,
                        )
                      }
                      disabled={isConnecting}
                      className="w-full px-6 py-4 bg-[#25D366] text-white rounded-xl font-bold flex justify-between items-center hover:bg-[#128C7E] shadow-lg disabled:opacity-50"
                    >
                      <span>
                        {isConnecting
                          ? "Gerando QR Code..."
                          : "Conectar o WhatsApp"}
                      </span>
                      {!isConnecting && <ArrowRight size={20} />}
                    </button>
                  </div>
                  <div className="flex flex-col items-center justify-center p-8 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                    <Activity
                      className={
                        qrCodeBase64 ? "text-green-600" : "text-slate-400"
                      }
                      size={32}
                    />
                    <span className="text-sm font-bold mt-2 text-slate-700">
                      Status
                    </span>
                    <span className="text-xs">
                      {qrCodeBase64 ? "Pronto para Escanear" : "Desconectado"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "sistema" && (
              <div className="space-y-6 animate-in fade-in">
                <div className="flex items-center gap-3 border-b border-gray-100 pb-2">
                  <Shield className="text-slate-400" />
                  <h3 className="text-lg font-bold text-slate-800">
                    Manutenção do Sistema
                  </h3>
                </div>
                
                <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
                  <h4 className="font-bold text-sm uppercase flex items-center gap-2 text-slate-700">
                    <Calculator size={18} className="text-slate-500"/>
                    Modo de Amortização Financeira
                  </h4>
                  <div className="flex bg-slate-100 p-1 rounded-xl w-max">
                    <button
                      onClick={() => {
                        if(!isAdmin) return;
                        setAmortizationMode("LINEAR");
                        localStorage.setItem("amortizationMode", "LINEAR");
                      }}
                      disabled={!isAdmin}
                      className={`px-6 py-2 text-xs font-bold rounded-lg transition-all disabled:opacity-70 disabled:cursor-not-allowed ${amortizationMode === "LINEAR" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                    >
                      Linear
                    </button>
                    <button
                      onClick={() => {
                        if(!isAdmin) return;
                        setAmortizationMode("PRICE");
                        localStorage.setItem("amortizationMode", "PRICE");
                      }}
                      disabled={!isAdmin}
                      className={`px-6 py-2 text-xs font-bold rounded-lg transition-all disabled:opacity-70 disabled:cursor-not-allowed ${amortizationMode === "PRICE" ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
                    >
                      Tabela Price
                    </button>
                  </div>
                </div>

                {/* --- CONFIGURAÇÃO DE ALERTA DE VENCIMENTO RESTAURADA --- */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4">
                  <h4 className="font-bold text-sm uppercase flex items-center gap-2 text-slate-700">
                    <Bell size={18} className="text-slate-500"/>
                    Alertas e Notificações
                  </h4>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Dias de Antecedência para Vencimento</label>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={settings.system?.warningDays || 3}
                      onChange={(e) => updateSystem("warningDays", parseInt(e.target.value))}
                      disabled={!isAdmin}
                      className="w-full md:w-1/3 p-3 border border-slate-200 rounded-xl outline-none font-bold text-slate-700 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                    <p className="text-xs text-slate-400 mt-2">Os contratos serão destacados como "A Vencer" nesta quantidade de dias antes do prazo.</p>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <h4 className="font-bold text-slate-800 mb-2 text-sm uppercase flex items-center gap-2">
                    <Save size={16} className="text-blue-500" /> Backup e Restauração
                  </h4>
                  <p className="text-sm text-slate-500 mb-4">
                    Exporte todos os dados de forma manual ou restaure um arquivo de segurança.
                  </p>

                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept=".json"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      alert("Para restaurar o arquivo " + file.name + " em nuvem, a integração do Cloud Run precisa estar habilitada.");
                    }}
                  />

                  <div className="flex flex-col sm:flex-row gap-4">
                    {/* BOTÃO QUE GERA O JSON REAL */}
                    <button
                      onClick={handleExportBackup}
                      disabled={isLoading}
                      className="flex-1 py-3 bg-blue-50 text-blue-700 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-100 transition-colors border border-blue-200 disabled:opacity-50"
                    >
                      {isLoading ? <Loader2 className="animate-spin" size={18}/> : <Download size={18} />} 
                      Fazer Backup Local
                    </button>

                    {isAdmin && (
                        <button
                        onClick={() => {
                            setDangerActionType("RESTORE");
                            setDangerModalOpen(true);
                        }}
                        className="flex-1 py-3 bg-orange-50 text-orange-700 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-orange-100 transition-colors border border-orange-200"
                        >
                        <Upload size={18} /> Restaurar Backup
                        </button>
                    )}
                  </div>
                </div>

                {isAdmin && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-6">
                    <h4 className="text-red-700 font-bold mb-4 flex items-center gap-2 uppercase text-sm">
                       <AlertTriangle size={18} /> Zona de Perigo
                    </h4>
                    <p className="text-xs text-red-600 mb-4">A exclusão do sistema é irreversível e apagará todos os dados armazenados.</p>
                    <button
                      onClick={() => {
                        setDangerActionType("RESET");
                        setDangerModalOpen(true);
                      }}
                      className="w-full py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-900/20"
                    >
                      Reset de Fábrica
                    </button>
                  </div>
                )}

                {/* BOTÃO SALVAR DA ABA SISTEMA */}
                {isAdmin && (
                    <div className="mt-8 pt-6 border-t border-gray-100 flex justify-end">
                      <button
                          onClick={() => handleSave()}
                          disabled={isLoading}
                          className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-slate-800 shadow-lg"
                      >
                          {isLoading ? (
                          <Loader2 className="animate-spin" size={18} />
                          ) : (
                          "Salvar Configurações do Sistema"
                          )}
                      </button>
                    </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL QR CODE */}
      {showQRModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white p-8 rounded-3xl w-full max-w-sm flex flex-col items-center shadow-2xl animate-in zoom-in">
            <h3 className="text-xl font-bold mb-6 text-gray-800">
              Escaneie o Código
            </h3>
            <div className="bg-white p-2 border-2 border-gray-100 rounded-xl shadow-inner">
              <img src={qrCodeBase64} alt="QR Code" className="w-64 h-64" />
            </div>
            <p className="mt-6 text-xs text-slate-400 text-center">
              Abra o WhatsApp e escaneie para conectar.
            </p>
            <button
              onClick={() => setShowQRModal(false)}
              className="mt-8 w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* MODAL SEGURANÇA (RESET / RESTORE) */}
      <Modal
        isOpen={dangerModalOpen}
        onClose={() => setDangerModalOpen(false)}
        title="Ação Restrita"
        color="red"
      >
        <div className="space-y-4 text-center">
          <p className="text-xs text-red-800 font-bold mb-2">Digite o código de segurança para prosseguir:</p>
          <input
            type="password"
            placeholder="Senha de Segurança"
            value={securityCode}
            onChange={(e) => setSecurityCode(e.target.value)}
            className="w-full p-3 border rounded-xl text-center font-bold bg-white"
          />
          {dangerActionType === "RESET" && (
            <input
              type="text"
              placeholder='Digite "CONFIRMAR"'
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full p-3 border border-red-200 rounded-xl text-center text-red-600 bg-white"
            />
          )}
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setDangerModalOpen(false)}
              className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSecurityCheck}
              className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
            >
              Confirmar
            </button>
          </div>
        </div>
      </Modal>

      {/* MODAL RESET SENHA USUÁRIO */}
      <Modal
        isOpen={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        title="Alterar Senha"
        color="blue"
      >
        <div className="space-y-4">
          <input
            type="password"
            value={newPasswordReset}
            onChange={(e) => setNewPasswordReset(e.target.value)}
            className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100"
            placeholder="Nova Senha"
          />
          <button
            onClick={async () => {
              await authService.updateUser(selectedUserEmail!, {
                password: newPasswordReset,
              });
              alert("Senha alterada!");
              setResetModalOpen(false);
            }}
            className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors"
          >
            Salvar Senha
          </button>
        </div>
      </Modal>
    </Layout>
  );
};

export default Settings;