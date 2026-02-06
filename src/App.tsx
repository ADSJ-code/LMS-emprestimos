import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import Billing from './pages/Billing';
import Overdue from './pages/Overdue'; // Mantive o nome que você já usa
import Blacklist from './pages/Blacklist';
import Affiliates from './pages/Affiliates';
import History from './pages/History';
import Settings from './pages/Settings';

// --- COMPONENTE GUARDIÃO (PRIVATE ROUTE) ---
// Verifica se existe a sessão ativa. Se não, chuta para o Login.
const PrivateRoute = ({ children }: { children: JSX.Element }) => {
  const session = localStorage.getItem('lms_active_session');
  
  if (!session) {
    // Se não estiver logado, redireciona para o login
    return <Navigate to="/login" replace />;
  }

  // Se estiver logado, libera o acesso
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Rota Pública */}
        <Route path="/login" element={<Login />} />

        {/* Rotas Protegidas (Só acessa com login) */}
        <Route 
          path="/dashboard" 
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/clients" 
          element={
            <PrivateRoute>
              <Clients />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/billing" 
          element={
            <PrivateRoute>
              <Billing />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/overdue" 
          element={
            <PrivateRoute>
              <Overdue />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/blacklist" 
          element={
            <PrivateRoute>
              <Blacklist />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/affiliates" 
          element={
            <PrivateRoute>
              <Affiliates />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/history" 
          element={
            <PrivateRoute>
              <History />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/settings" 
          element={
            <PrivateRoute>
              <Settings />
            </PrivateRoute>
          } 
        />

        {/* Rota Raiz: Tenta ir para o Dashboard (o PrivateRoute vai decidir se deixa ou manda pro login) */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Qualquer rota desconhecida manda para o Login */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;