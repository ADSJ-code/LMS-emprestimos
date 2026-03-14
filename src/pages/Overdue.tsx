import { useState, useEffect, useMemo } from "react";
import {
  Search,
  AlertTriangle,
  Phone,
  Calendar,
  ArrowRight,
  DollarSign,
  RefreshCw,
  Filter,
  MessageCircle,
  Eye,
  Info,
  List,
} from "lucide-react";
import Layout from "../components/Layout";
import Modal from "../components/Modal";
import { loanService, clientService, Loan, Client } from "../services/api";
import { calculateOverdueValue, formatMoney } from "../utils/finance";

interface LoanExtended extends Loan {
  diffDays: number;
  snowball: {
    totalOriginal: number;
    totalUpdated: number;
    missedInstallments: any[];
  };
}

const getApiUrl = localStorage.getItem("getApiUrl") || "";

const sendWhatsappApi = async (
  name: string,
  phone: string,
  contract: string,
  lateDays: number,
  updatedAmount: number,
  companyName: string,
  token: string,
) => {
  const response = await fetch(getApiUrl+`/api/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userconectado: companyName,
      phone: phone,
      delay: 1,
      name: name,
      lateDays: lateDays,
      updatedAmount: updatedAmount,
      apiKey: token,
    }),
  });

  if (!response.ok) throw new Error("Falha ao enviar via API");
  return response.json();
};

const Overdue = () => {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSnowball, setSelectedSnowball] = useState<any>(null);

  const [metrics, setMetrics] = useState({
    totalOverdue: 0,
    recoveredToday: 0,
    recoveredCapital: 0,
    recoveredInterest: 0,
    efficiency: 0,
    count: 0,
  });

  const parseLocalDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    const cleanStr = dateStr.split("T")[0];
    const [year, month, day] = cleanStr.split("-").map(Number);
    return new Date(year, month - 1, day);
  };

  const getSnowballDetails = (loan: Loan) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let tempDue = parseLocalDate(loan.nextDue);
    let totalOriginal = 0;
    let totalUpdated = 0;
    let missedInstallments = [];
    let count = 0;

    const baseAmount =
      loan.status === "Acordo"
        ? loan.installmentValue + (loan.agreementValue || 0)
        : loan.installmentValue;

    const remainingInstallments =
      loan.interestType === "SIMPLE" ? 999 : loan.installments || 1;

    while (tempDue < today) {
      const dateStr = tempDue.toISOString().split("T")[0];
      const updatedVal = calculateOverdueValue(
        baseAmount,
        dateStr,
        "Atrasado",
        loan.fineRate ?? 2,
        loan.moraInterestRate ?? 1,
        loan.amount,
      );

      missedInstallments.push({
        date: dateStr,
        original: baseAmount,
        updated: updatedVal,
      });

      totalOriginal += baseAmount;
      totalUpdated += updatedVal;

      if (loan.status === "Acordo") break;

      count++;
      if (count >= remainingInstallments) break;
      if (count > 60) break;

      if (loan.frequency === "SEMANAL") tempDue.setDate(tempDue.getDate() + 7);
      else if (loan.frequency === "DIARIO")
        tempDue.setDate(tempDue.getDate() + 1);
      else tempDue.setMonth(tempDue.getMonth() + 1);
    }

    if (missedInstallments.length === 0 && loan.status === "Atrasado") {
      const dateStr = loan.nextDue.split("T")[0];
      const updatedVal = calculateOverdueValue(
        baseAmount,
        dateStr,
        "Atrasado",
        loan.fineRate ?? 2,
        loan.moraInterestRate ?? 1,
        loan.amount,
      );
      missedInstallments.push({
        date: dateStr,
        original: baseAmount,
        updated: updatedVal,
      });
      totalOriginal += baseAmount;
      totalUpdated += updatedVal;
    }

    return { totalOriginal, totalUpdated, missedInstallments };
  };

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [loansData, clientsData] = await Promise.all([
        loanService.getAll(),
        clientService.getAll(),
      ]);
      setLoans(loansData || []);
      setClients(clientsData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- FUNÇÃO DO WHATSAPP COM BOLA DE NEVE ---
  const getInstanceToken = async (
    targetName: string,
  ): Promise<string | null> => {
    try {
      // Busca o telefone da empresa via API (igual ao Billing.tsx)
      let companyPhone = "";
      try {
        const authToken = localStorage.getItem("token");
        const settingsRes = await fetch(getApiUrl + `/api/settings`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (settingsRes.ok) {
          const settingsData = await settingsRes.json();
          companyPhone = settingsData?.company?.phone || "";
        }
      } catch {
        companyPhone = localStorage.getItem("companyPhone") || "";
      }

      const response = await fetch(getApiUrl + "/api/instances/ver");

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const list = Array.isArray(data)
        ? data
        : data.data || data.instances || [];

      if (list.length === 0) {
        console.warn("A lista de instâncias veio vazia.");
        return null;
      }

      // Tenta encontrar pelo telefone primeiro (igual ao Billing.tsx)
      let targetPhone = companyPhone.replace(/\D/g, "");
      if (targetPhone.length >= 10 && !targetPhone.startsWith("55")) {
        targetPhone = "55" + targetPhone;
      }

      if (targetPhone) {
        const phoneMatch = list.find(
          (inst: any) =>
            inst.instance.status === "open" &&
            inst.instance.owner &&
            inst.instance.owner.includes(targetPhone),
        );
        if (phoneMatch) return phoneMatch.instance.apikey;
      }

      // Fallback: busca pelo nome da instância
      const nameMatch = list.find(
        (inst: any) =>
          inst.instance.instanceName?.toString().trim().toLowerCase() ===
          targetName.trim().toLowerCase(),
      );

      if (nameMatch?.instance?.apikey) return nameMatch.instance.apikey;

      console.warn(`❌ Instância "${targetName}" não encontrada.`);
      return null;
    } catch (error) {
      console.error("❌ Erro fatal no getInstanceToken:", error);
      return null;
    }
  };

  const handleWhatsApp = async (loan: LoanExtended, snowball: any) => {
    const companyName = localStorage.getItem("companyName") || "";
    const client = clients.find((c) => c.name === loan.client);

    console.log("Cliente encontrado:", loan);
    if (!client || !client.phone) {
      alert("❌ Erro: Telefone do cliente não encontrado.");
      return;
    }

    const cleanPhone = client.phone.replace(/\D/g, "");
    const firstName = loan.client.split(" ")[0];
    const parcelasText =
      snowball.missedInstallments.length > 1
        ? `${snowball.missedInstallments.length} parcelas pendentes`
        : `uma pendência`;

    // Dados para a API
    const contractCode = `CTR-${loan.id?.substring(0, 6).toUpperCase()}`;
    const diffDays = loan.diffDays || 0;

    try {
      // Busca o token
      const token = await getInstanceToken(companyName);

      if (!token) {
        throw new Error(
          `Token não encontrado para a instância "${companyName}"`,
        );
      }
      // Tenta enviar pelo servidor (Evolution API/Golang)
      await sendWhatsappApi(
        loan.client,
        client.phone,
        contractCode,
        diffDays,
        snowball.totalUpdated,
        companyName,
        token,
      );
      alert(`✅ Mensagem enviada com sucesso para ${firstName}!`);
    } catch (error) {
      // 2. Fallback: Se a API falhar, abre o link direto do WhatsApp Web
      console.warn("API Offline, usando link direto...");

      const message = `Olá ${firstName}, identificamos ${parcelasText} totalizando R$ ${formatMoney(snowball.totalUpdated)} (valor atualizado) referente ao seu contrato ${contractCode}.\n\nPodemos agendar um pagamento para regularizar?`;

      const url = `https://wa.me/55${cleanPhone}?text=${encodeURIComponent(message)}`;
      window.open(url, "_blank");
    }
  };

  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let sumOverdue = 0;
    let sumRecoveredToday = 0;
    let sumRecoveredCapital = 0;
    let sumRecoveredInterest = 0;
    let overdueCount = 0;
    let payingCount = 0;

    loans.forEach((loan) => {
      if (loan.history && loan.history.length > 0) {
        loan.history.forEach((record) => {
          const payDate = new Date(record.date);
          payDate.setMinutes(
            payDate.getMinutes() + payDate.getTimezoneOffset(),
          );

          const type = record.type ? record.type.toLowerCase() : "";
          if (
            type.includes("abertura") ||
            type.includes("empréstimo") ||
            type.includes("contrato")
          )
            return;

          if (
            payDate.getDate() === today.getDate() &&
            payDate.getMonth() === today.getMonth() &&
            payDate.getFullYear() === today.getFullYear()
          ) {
            sumRecoveredToday += record.amount;

            const instVal = loan.installmentValue || 0;
            const totalExpected = instVal * (loan.installments || 1);
            const capRatio =
              totalExpected > 0 ? (loan.amount || 0) / totalExpected : 1;

            if (
              record.capitalPaid !== undefined &&
              record.interestPaid !== undefined
            ) {
              sumRecoveredCapital += record.capitalPaid;
              sumRecoveredInterest += record.interestPaid;
            } else {
              const calcCap = record.amount * capRatio;
              sumRecoveredCapital += calcCap;
              sumRecoveredInterest += record.amount - calcCap;
            }
            payingCount++;
          }
        });
      }

      if (loan.status === "Pago") return;

      const dueDate = parseLocalDate(loan.nextDue);
      const isOverdue = dueDate < today || loan.status === "Atrasado";

      if (isOverdue) {
        const snowball = getSnowballDetails(loan);
        if (snowball && snowball.totalUpdated > 0) {
          sumOverdue += snowball.totalUpdated;
          overdueCount++;
        }
      }
    });

    const eff =
      overdueCount > 0
        ? Math.round((payingCount / (overdueCount + payingCount)) * 100)
        : sumRecoveredToday > 0
          ? 100
          : 0;

    setMetrics({
      totalOverdue: sumOverdue,
      recoveredToday: sumRecoveredToday,
      recoveredCapital: sumRecoveredCapital,
      recoveredInterest: sumRecoveredInterest,
      efficiency: eff,
      count: overdueCount,
    });
  }, [loans]);

  const filteredOverdueWithSnowball = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdueList: LoanExtended[] = [];

    loans.forEach((l) => {
      if (l.status === "Pago") return;
      const dueDate = parseLocalDate(l.nextDue);
      const isOverdue = dueDate < today || l.status === "Atrasado";

      if (isOverdue) {
        const snowball = getSnowballDetails(l);
        if (snowball && snowball.totalUpdated > 0) {
          const oldestDate =
            snowball.missedInstallments.length > 0
              ? parseLocalDate(snowball.missedInstallments[0].date)
              : dueDate;
          const diffTime = Math.abs(today.getTime() - oldestDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          overdueList.push({ ...l, snowball, diffDays });
        }
      }
    });

    return overdueList.filter((l) =>
      (l.client || "").toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [loans, searchTerm]);

  const openDetails = (loan: any) => {
    setSelectedSnowball(loan);
    setIsModalOpen(true);
  };

  return (
    <Layout>
      <header className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">
            Cobrança de Inadimplentes
          </h2>
          <p className="text-slate-500">
            Gestão de contratos em atraso e recuperação (Efeito Bola de Neve).
          </p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 bg-white border border-gray-200 text-slate-600 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors shadow-sm font-bold"
        >
          <RefreshCw className={isLoading ? "animate-spin" : ""} size={18} />{" "}
          Atualizar
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-red-50 p-6 rounded-2xl border border-red-100 shadow-sm relative overflow-hidden">
          <div className="flex justify-between items-start mb-2">
            <span className="text-red-600 font-bold text-sm uppercase tracking-wider">
              Total em Atraso (Atualizado)
            </span>
            <AlertTriangle className="text-red-500" size={24} />
          </div>
          <h3 className="text-3xl font-black text-slate-800">
            R$ {formatMoney(metrics.totalOverdue)}
          </h3>
          <p className="text-xs text-red-500 font-medium mt-1">
            Soma de todas as parcelas perdidas com multas
          </p>
        </div>

        <div className="bg-green-50 p-6 rounded-2xl border border-green-100 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-2">
              <span className="text-green-700 font-bold text-sm uppercase tracking-wider">
                Recuperado Hoje
              </span>
              <DollarSign className="text-green-600" size={24} />
            </div>
            <h3 className="text-3xl font-black text-slate-800">
              R$ {formatMoney(metrics.recoveredToday)}
            </h3>
          </div>
          <div className="flex flex-wrap gap-2 mt-3 text-[11px] font-bold">
            <span className="bg-white px-2 py-1 rounded shadow-sm text-slate-600 border border-green-200">
              Capital: R$ {formatMoney(metrics.recoveredCapital)}
            </span>
            <span className="bg-green-100 px-2 py-1 rounded shadow-sm text-green-800 border border-green-200">
              Lucro: R$ {formatMoney(metrics.recoveredInterest)}
            </span>
          </div>
        </div>

        <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-blue-700 font-bold text-sm uppercase tracking-wider">
              Eficiência de Contato
            </span>
            <MessageCircle className="text-blue-600" size={24} />
          </div>
          <h3 className="text-3xl font-black text-slate-800">
            {metrics.efficiency}%
          </h3>
          <div className="w-full bg-blue-200 rounded-full h-1.5 mt-3">
            <div
              className="bg-blue-600 h-1.5 rounded-full transition-all"
              style={{ width: `${metrics.efficiency}%` }}
            ></div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-50 bg-slate-50/30 flex justify-between items-center">
          <div className="relative w-96">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={18}
            />
            <input
              type="text"
              placeholder="Buscar cliente inadimplente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-slate-900/5 transition-all font-bold text-slate-700"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Filter size={16} />
            <span className="font-bold">
              {filteredOverdueWithSnowball.length}
            </span>{" "}
            clientes em atraso
          </div>
        </div>

        <div className="overflow-visible min-h-[400px]">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500 font-bold border-b border-slate-100">
                <th className="p-4">Cliente / Contrato</th>
                <th className="p-4">Atrasado Desde</th>
                <th className="p-4 text-center">Vencidas</th>
                <th className="p-4 text-right">Valor Inicial</th>
                <th className="p-4 text-right">Total c/ Multa</th>
                <th className="p-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredOverdueWithSnowball.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="p-8 text-center text-slate-400 italic"
                  >
                    Nenhum contrato em atraso.
                  </td>
                </tr>
              ) : (
                filteredOverdueWithSnowball.map((loan) => (
                  <tr
                    key={loan.id}
                    className="hover:bg-red-50/30 transition-colors group"
                  >
                    <td className="p-4">
                      <div className="font-bold text-slate-800">
                        {loan.client}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        ID: {loan.id}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2 text-red-600 font-bold text-sm">
                        <Calendar size={14} />
                        {loan.snowball.missedInstallments[0]?.date
                          ? new Date(
                              loan.snowball.missedInstallments[0].date +
                                "T12:00:00",
                            ).toLocaleDateString("pt-BR")
                          : "-"}
                      </div>
                      <span className="text-[10px] text-slate-400 font-bold">
                        {loan.diffDays} dias atrás
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-black border border-red-200">
                        {loan.snowball.missedInstallments.length}x
                      </span>
                    </td>
                    <td className="p-4 text-right text-slate-500 font-bold">
                      R$ {formatMoney(loan.snowball.totalOriginal)}
                    </td>
                    <td className="p-4 text-right font-black text-slate-800 text-lg">
                      R$ {formatMoney(loan.snowball.totalUpdated)}
                    </td>
                    <td className="p-4 text-right flex items-center justify-end gap-2">
                      <button
                        onClick={() => openDetails(loan)}
                        className="p-2 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1 font-bold text-xs"
                      >
                        <Eye size={16} /> Detalhes
                      </button>
                      <button
                        onClick={() =>
                          handleWhatsApp(
                            loan,
                            loan.snowball || {
                              totalUpdated: 0,
                              missedInstallments: [],
                            },
                          )
                        }
                        className="p-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors flex items-center gap-1 text-xs font-bold"
                        title="WhatsApp"
                      >
                        <MessageCircle size={18} />
                        Cobrar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Fatura de Inadimplência"
      >
        {selectedSnowball && (
          <div className="space-y-6">
            <div className="bg-red-50 p-5 rounded-2xl border border-red-200 shadow-inner">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    {selectedSnowball.client}
                  </h3>
                  <p className="text-xs text-red-600 font-bold tracking-widest uppercase">
                    Contrato #{selectedSnowball.id}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">
                    Dívida Total Atualizada
                  </p>
                  <p className="text-3xl font-black text-red-700">
                    R$ {formatMoney(selectedSnowball.snowball.totalUpdated)}
                  </p>
                </div>
              </div>
              <div className="flex gap-4 border-t border-red-200/50 pt-4">
                <div className="flex-1 bg-white p-3 rounded-xl border border-red-100 text-center">
                  <span className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Parcelas
                  </span>
                  <span className="text-lg font-black text-slate-800">
                    {selectedSnowball.snowball.missedInstallments.length}
                  </span>
                </div>
                <div className="flex-1 bg-white p-3 rounded-xl border border-red-100 text-center">
                  <span className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Original
                  </span>
                  <span className="text-lg font-black text-slate-800">
                    R$ {formatMoney(selectedSnowball.snowball.totalOriginal)}
                  </span>
                </div>
                <div className="flex-1 bg-white p-3 rounded-xl border border-red-100 text-center">
                  <span className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                    Juros/Multa
                  </span>
                  <span className="text-lg font-black text-red-600">
                    + R${" "}
                    {formatMoney(
                      selectedSnowball.snowball.totalUpdated -
                        selectedSnowball.snowball.totalOriginal,
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div className="pt-2">
              <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
                <List size={16} /> Detalhamento Mês a Mês
              </h4>
              <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-100 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="p-3">Vencimento</th>
                      <th className="p-3 text-right">Principal</th>
                      <th className="p-3 text-right text-red-500">
                        Mora/Multa
                      </th>
                      <th className="p-3 text-right font-black">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {selectedSnowball.snowball.missedInstallments.map(
                      (inst: any, idx: number) => (
                        <tr
                          key={idx}
                          className="hover:bg-white transition-colors"
                        >
                          <td className="p-3 font-bold text-slate-700">
                            {new Date(
                              inst.date + "T12:00:00",
                            ).toLocaleDateString("pt-BR")}
                          </td>
                          <td className="p-3 text-right text-slate-500">
                            R$ {formatMoney(inst.original)}
                          </td>
                          <td className="p-3 text-right text-red-500 font-bold">
                            + R$ {formatMoney(inst.updated - inst.original)}
                          </td>
                          <td className="p-3 text-right font-black text-slate-800">
                            R$ {formatMoney(inst.updated)}
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-3 text-slate-600 font-bold hover:bg-slate-100 rounded-xl transition-all"
              >
                Fechar
              </button>
              <button
                onClick={() =>
                  handleWhatsApp(selectedSnowball, selectedSnowball.snowball)
                }
                className="px-6 py-3 bg-[#25D366] text-white rounded-xl font-bold flex items-center gap-2 hover:bg-[#128C7E] transition-all shadow-lg"
              >
                <MessageCircle size={18} /> Cobrar via WhatsApp
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
};;

export default Overdue;