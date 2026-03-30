import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import { UpdateProvider, UpdateBanner } from "@/features/update";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineBanner } from "@/components/OfflineBanner";
import Login from "@/pages/Login";
import PrimeiroAcesso from "@/pages/PrimeiroAcesso";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Dashboard from "@/pages/Dashboard";
import Agenda from "@/pages/Agenda";
import EventDetail from "@/pages/EventDetail";
import EventForm from "@/pages/EventForm";
import Financeiro from "@/pages/Financeiro";
import UserManagement from "@/pages/UserManagement";
import PlanoAssinatura from "@/pages/PlanoAssinatura";
import Backups from "@/pages/Backups";
import Documentos from "@/pages/Documentos";
import Funcionarios from "@/pages/Funcionarios";

import PainelMaster from "@/pages/master/PainelMaster";
import Empresas from "@/pages/master/Empresas";
import UsuariosGlobais from "@/pages/master/UsuariosGlobais";
import ConfiguracoesSistema from "@/pages/master/ConfiguracoesSistema";
import LogsSistema from "@/pages/master/LogsSistema";
import Planos from "@/pages/master/Planos";
import FinanceiroMaster from "@/pages/master/FinanceiroMaster";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <UpdateProvider>
            <Toaster />
            <Sonner />
            <UpdateBanner />
            <OfflineBanner />
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/primeiro-acesso" element={<PrimeiroAcesso />} />
                <Route path="/esqueci-senha" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/" element={<Navigate to="/agenda" replace />} />
                <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                  <Route path="/dashboard" element={<ProtectedRoute adminOnly><Dashboard /></ProtectedRoute>} />
                  <Route path="/agenda" element={<Agenda />} />
                  <Route path="/evento/:id" element={<EventDetail />} />
                  <Route path="/evento/:id/editar" element={<ProtectedRoute adminOnly><EventForm /></ProtectedRoute>} />
                  <Route path="/evento/editar/:id" element={<ProtectedRoute adminOnly><EventForm /></ProtectedRoute>} />
                  <Route path="/evento/novo" element={<ProtectedRoute adminOnly><EventForm /></ProtectedRoute>} />
                  <Route path="/financeiro" element={<ProtectedRoute adminOnly><Financeiro /></ProtectedRoute>} />
                  <Route path="/usuarios" element={<ProtectedRoute adminOnly><UserManagement /></ProtectedRoute>} />
                  <Route path="/plano" element={<PlanoAssinatura />} />
                  <Route path="/backups" element={<ProtectedRoute adminOnly><Backups /></ProtectedRoute>} />
                  <Route path="/documentos" element={<ProtectedRoute adminOnly><Documentos /></ProtectedRoute>} />
                  <Route path="/funcionarios" element={<ProtectedRoute adminOnly><Funcionarios /></ProtectedRoute>} />
                  
                  {/* Master Admin Routes */}
                  <Route path="/master" element={<ProtectedRoute masterOnly><PainelMaster /></ProtectedRoute>} />
                  <Route path="/master/empresas" element={<ProtectedRoute masterOnly><Empresas /></ProtectedRoute>} />
                  <Route path="/master/usuarios" element={<ProtectedRoute masterOnly><UsuariosGlobais /></ProtectedRoute>} />
                  <Route path="/master/planos" element={<ProtectedRoute masterOnly><Planos /></ProtectedRoute>} />
                  <Route path="/master/configuracoes" element={<ProtectedRoute masterOnly><ConfiguracoesSistema /></ProtectedRoute>} />
                  <Route path="/master/financeiro" element={<ProtectedRoute masterOnly><FinanceiroMaster /></ProtectedRoute>} />
                  <Route path="/master/logs" element={<ProtectedRoute masterOnly><LogsSistema /></ProtectedRoute>} />
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </UpdateProvider>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
