import { useState } from "react";

export function TesteConexao() {
  const [log, setLog] = useState("Clique para testar...");

  const testar = async () => {
    setLog("Enviando...");
    try {
      // O Vite redireciona /api para localhost:8080
      const res = await fetch("/api/contracts/simulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          principal: 5000,
          interestRate: 0.02, // 2%
          term: 12,
          startDate: "2026-03-01"
        })
      });

      const data = await res.json();
      setLog(JSON.stringify(data, null, 2));
    } catch (error: any) {
      setLog("Erro: " + error.message);
    }
  };

  return (
    <div className="p-4 border rounded bg-gray-100 mt-4">
      <h2 className="text-lg font-bold mb-2">Teste Backend Jules</h2>
      <button 
        onClick={testar}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
      >
        Disparar Teste
      </button>
      <pre className="mt-4 p-2 bg-black text-green-400 rounded text-sm overflow-auto">
        {log}
      </pre>
    </div>
  );
}