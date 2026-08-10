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
import { ModuleGate } from "@/components/ModuleGate";
import { MODULE_KEYS } from "@/constants/module-keys";
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
import Relatorios from "@/pages/Relatorios";
import PainelOperacional from "@/pages/PainelOperacional";
import ChecklistCentral from "@/pages/ChecklistCentral";
import Materiais from "@/pages/Materiais";
import Estoque from "@/pages/Estoque";
import CheckinCheckout from "@/pages/CheckinCheckout";
import Locacoes from "@/pages/Locacoes";
import Clientes from "@/pages/Clientes";
import Manutencoes from "@/pages/Manutencoes";
import Etiquetas from "@/pages/Etiquetas";
import ConfiguracoesImpressoras from "@/pages/ConfiguracoesImpressoras";
import Cadastro from "@/pages/Cadastro";
import EscolherPlano from "@/pages/EscolherPlano";
import PagamentoPlano from "@/pages/PagamentoPlano";
import AguardandoPagamento from "@/pages/AguardandoPagamento";

import PainelMaster from "@/pages/master/PainelMaster";
import Empresas from "@/pages/master/Empresas";
import UsuariosGlobais from "@/pages/master/UsuariosGlobais";
import ConfiguracoesSistema from "@/pages/master/ConfiguracoesSistema";
import LogsSistema from "@/pages/master/LogsSistema";
import Planos from "@/pages/master/Planos";
import FinanceiroMaster from "@/pages/master/FinanceiroMaster";
import Modulos from "@/pages/master/Modulos";
import SolicitacoesModulos from "@/pages/master/SolicitacoesModulos";
import PagamentosModulos from "@/pages/master/PagamentosModulos";
import SolicitacoesLoteModulos from "@/pages/master/SolicitacoesLoteModulos";

import OnboardingModulos from "@/pages/OnboardingModulos";
import OnboardingResumo from "@/pages/OnboardingResumo";
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
                <Route path="/cadastro" element={<Cadastro />} />
                <Route path="/primeiro-acesso" element={<PrimeiroAcesso />} />
                <Route path="/esqueci-senha" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/escolher-plano" element={<ProtectedRoute skipPlanCheck><EscolherPlano /></ProtectedRoute>} />
                <Route path="/pagamento-plano/:planoId" element={<ProtectedRoute skipPlanCheck><PagamentoPlano /></ProtectedRoute>} />
                <Route path="/aguardando-pagamento" element={<ProtectedRoute skipPlanCheck><AguardandoPagamento /></ProtectedRoute>} />
                <Route path="/onboarding-modulos" element={<ProtectedRoute skipPlanCheck><OnboardingModulos /></ProtectedRoute>} />
                <Route path="/onboarding-resumo" element={<ProtectedRoute skipPlanCheck><OnboardingResumo /></ProtectedRoute>} />
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
                  <Route path="/configuracoes/impressoras" element={<ProtectedRoute><ConfiguracoesImpressoras /></ProtectedRoute>} />
                  <Route path="/documentos" element={<ProtectedRoute adminOnly><Documentos /></ProtectedRoute>} />
                  <Route path="/funcionarios" element={<ProtectedRoute adminOnly><Funcionarios /></ProtectedRoute>} />
                  <Route path="/relatorios" element={<ProtectedRoute adminOnly><Relatorios /></ProtectedRoute>} />
                  <Route path="/painel-operacional" element={<ProtectedRoute adminOnly><PainelOperacional /></ProtectedRoute>} />
                  <Route path="/checklist" element={<ProtectedRoute adminOnly><ChecklistCentral /></ProtectedRoute>} />
                  <Route
                    path="/materiais"
                    element={
                      <ModuleGate
                        featureKey={MODULE_KEYS.GESTAO_MATERIAIS}
                        mode="lock"
                      >
                        <Materiais />
                      </ModuleGate>
                    }
                  />
                  <Route
                    path="/estoque"
                    element={
                      <ModuleGate
                        featureKey={MODULE_KEYS.CONTROLE_ESTOQUE}
                        mode="lock"
                      >
                        <Estoque />
                      </ModuleGate>
                    }
                  />
                  <Route
                    path="/checkin-checkout"
                    element={
                      <ModuleGate
                        featureKey={MODULE_KEYS.CHECKIN_CHECKOUT}
                        mode="lock"
                      >
                        <CheckinCheckout />
                      </ModuleGate>
                    }
                  />
                  <Route
                    path="/locacoes"
                    element={
                      <ModuleGate
                        featureKey={MODULE_KEYS.LOCACAO_MATERIAIS}
                        mode="lock"
                      >
                        <Locacoes />
                      </ModuleGate>
                    }
                  />
                  <Route
                    path="/clientes"
                    element={
                      <ModuleGate
                        featureKey={MODULE_KEYS.LOCACAO_MATERIAIS}
                        mode="lock"
                      >
                        <Clientes />
                      </ModuleGate>
                    }
                  />
                  <Route
                    path="/manutencoes"
                    element={
                      <ModuleGate
                        featureKey={MODULE_KEYS.MANUTENCAO_EQUIPAMENTOS}
                        mode="lock"
                      >
                        <Manutencoes />
                      </ModuleGate>
                    }
                  />
                  <Route
                    path="/etiquetas"
                    element={
                      <ModuleGate
                        featureKey={MODULE_KEYS.ETIQUETAS_MATERIAIS}
                        mode="lock"
                      >
                        <Etiquetas />
                      </ModuleGate>
                    }
                  />
                  <Route path="/modulos" element={<Navigate to="/plano" replace />} />

                  {/* Master Admin Routes */}
                  <Route path="/master" element={<ProtectedRoute masterOnly><PainelMaster /></ProtectedRoute>} />
                  <Route path="/master/empresas" element={<ProtectedRoute masterOnly><Empresas /></ProtectedRoute>} />
                  <Route path="/master/usuarios" element={<ProtectedRoute masterOnly><UsuariosGlobais /></ProtectedRoute>} />
                  <Route path="/master/planos" element={<ProtectedRoute masterOnly><Planos /></ProtectedRoute>} />
                  <Route path="/master/configuracoes" element={<ProtectedRoute masterOnly><ConfiguracoesSistema /></ProtectedRoute>} />
                  <Route path="/master/financeiro" element={<ProtectedRoute masterOnly><FinanceiroMaster /></ProtectedRoute>} />
                  <Route path="/master/modulos" element={<ProtectedRoute masterOnly><Modulos /></ProtectedRoute>} />
                  <Route path="/master/solicitacoes-modulos" element={<ProtectedRoute masterOnly><SolicitacoesModulos /></ProtectedRoute>} />
                  <Route path="/master/pagamentos-modulos" element={<ProtectedRoute masterOnly><PagamentosModulos /></ProtectedRoute>} />
                  <Route path="/master/solicitacoes-lote" element={<ProtectedRoute masterOnly><SolicitacoesLoteModulos /></ProtectedRoute>} />
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
