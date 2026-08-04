import { LayoutDashboard, Calendar, DollarSign, Users, LogOut, Music, Building2, Globe, Settings, ScrollText, CreditCard, Database, FileText, HardHat, Package, FileCheck, Wallet, BarChart3, ClipboardList, Layers, Warehouse, ScanLine, CalendarRange, Wrench, Tags } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { usePlatformBranding } from "@/hooks/useSystemSettings";
import { useCompanyModules } from "@/hooks/useCompanyModules";
import { MODULE_KEYS } from "@/constants/module-keys";
import { canShowMaterialsNavigation } from "@/lib/material-permissions";
import { canShowStockNavigation } from "@/lib/stock-permissions";
import { canShowCustodyNavigation } from "@/lib/checkin-checkout-permissions";
import { canShowRentalNavigation } from "@/lib/material-rental-permissions";
import { canShowMaintenanceNavigation } from "@/lib/equipment-maintenance-permissions";
import { canShowMaterialLabelsNavigation } from "@/lib/material-label-permissions";
import appVersion from "../../package.json";

const APP_VERSION = appVersion.version;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isMasterAdmin, isAdminEmpresa, profile, signOut, empresaLogoUrl, empresaNome, empresaReadOnly } = useAuth();
  const { platformLogoUrl, platformName } = usePlatformBranding();
  const { hasModule } = useCompanyModules();

  // For company users, show empresa logo/name; for master, show platform branding
  const displayLogoUrl = isMasterAdmin ? platformLogoUrl : (empresaLogoUrl || platformLogoUrl);
  const displayName = isMasterAdmin ? platformName : (empresaNome || platformName);

  const isUsuario = !isMasterAdmin && !isAdminEmpresa;
  const hasMaterialsAccess = canShowMaterialsNavigation({
    isMasterAdmin,
    moduleEnabled: hasModule(MODULE_KEYS.GESTAO_MATERIAIS),
  });
  const hasStockAccess = canShowStockNavigation({
    isMasterAdmin,
    moduleEnabled: hasModule(MODULE_KEYS.CONTROLE_ESTOQUE),
  });
  const hasCustodyAccess = canShowCustodyNavigation({
    isMasterAdmin,
    moduleEnabled: hasModule(MODULE_KEYS.CHECKIN_CHECKOUT),
  });
  const hasRentalAccess = canShowRentalNavigation({
    isMasterAdmin,
    moduleEnabled: hasModule(MODULE_KEYS.LOCACAO_MATERIAIS),
  });
  const hasMaintenanceAccess = canShowMaintenanceNavigation({
    isMasterAdmin,
    moduleEnabled: hasModule(MODULE_KEYS.MANUTENCAO_EQUIPAMENTOS),
  });
  const hasLabelsAccess = canShowMaterialLabelsNavigation({
    isMasterAdmin,
    moduleEnabled: hasModule(MODULE_KEYS.ETIQUETAS_MATERIAIS),
  });

  // Items that require specific modules (only shown when module is active or user is master)
  const moduleGatedItems = isMasterAdmin ? [
    { title: "Financeiro", url: "/financeiro", icon: DollarSign },
    { title: "Usuários", url: "/usuarios", icon: Users },
    { title: "Documentos", url: "/documentos", icon: FileText },
    { title: "Funcionários", url: "/funcionarios", icon: HardHat },
    { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
    { title: "Painel Operacional", url: "/painel-operacional", icon: LayoutDashboard },
    { title: "Checklist", url: "/checklist", icon: ClipboardList },
    { title: "Backups", url: "/backups", icon: Database },
  ] : [
    ...(hasModule(MODULE_KEYS.FINANCEIRO_AVANCADO) ? [{ title: "Financeiro", url: "/financeiro", icon: DollarSign }] : []),
    ...(hasModule(MODULE_KEYS.EQUIPE_PERMISSOES) || isAdminEmpresa ? [{ title: "Usuários", url: "/usuarios", icon: Users }] : []),
    ...(hasModule(MODULE_KEYS.DOCUMENTOS_AVANCADOS) ? [{ title: "Documentos", url: "/documentos", icon: FileText }] : []),
    ...(hasModule(MODULE_KEYS.CHECKLIST_TECNICO) || hasModule(MODULE_KEYS.FINANCEIRO_AVANCADO) ? [{ title: "Funcionários", url: "/funcionarios", icon: HardHat }] : []),
    ...(hasModule(MODULE_KEYS.RELATORIOS) ? [{ title: "Relatórios", url: "/relatorios", icon: BarChart3 }] : []),
    ...(hasModule(MODULE_KEYS.PAINEL_OPERACIONAL) ? [{ title: "Painel Operacional", url: "/painel-operacional", icon: LayoutDashboard }] : []),
    ...(hasModule(MODULE_KEYS.CHECKLIST_TECNICO) ? [{ title: "Checklist", url: "/checklist", icon: ClipboardList }] : []),
    ...(hasModule(MODULE_KEYS.RELATORIOS) ? [{ title: "Backups", url: "/backups", icon: Database }] : []),
  ];

  // Base items always visible (Dashboard, Agenda, Plano, Módulos)
  const companyItems = isUsuario
    ? [
        { title: "Agenda", url: "/agenda", icon: Calendar },
        ...(hasMaterialsAccess
          ? [{ title: "Materiais", url: "/materiais", icon: Package }]
          : []),
        ...(hasStockAccess
          ? [{ title: "Estoque", url: "/estoque", icon: Warehouse }]
          : []),
        ...(hasCustodyAccess
          ? [{ title: "Check-in / Check-out", url: "/checkin-checkout", icon: ScanLine }]
          : []),
        ...(hasRentalAccess
          ? [{ title: "Locações", url: "/locacoes", icon: CalendarRange }]
          : []),
        ...(hasMaintenanceAccess
          ? [{ title: "Manutenções", url: "/manutencoes", icon: Wrench }]
          : []),
        ...(hasLabelsAccess
          ? [{ title: "Etiquetas", url: "/etiquetas", icon: Tags }]
          : []),
        ...(empresaReadOnly ? [{ title: "Assinatura e Módulos", url: "/plano", icon: CreditCard }] : []),
      ]
    : [
        { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
        { title: "Agenda", url: "/agenda", icon: Calendar },
        ...(hasMaterialsAccess
          ? [{ title: "Materiais", url: "/materiais", icon: Package }]
          : []),
        ...(hasStockAccess
          ? [{ title: "Estoque", url: "/estoque", icon: Warehouse }]
          : []),
        ...(hasCustodyAccess
          ? [{ title: "Check-in / Check-out", url: "/checkin-checkout", icon: ScanLine }]
          : []),
        ...(hasRentalAccess
          ? [{ title: "Locações", url: "/locacoes", icon: CalendarRange }]
          : []),
        ...(hasMaintenanceAccess
          ? [{ title: "Manutenções", url: "/manutencoes", icon: Wrench }]
          : []),
        ...(hasLabelsAccess
          ? [{ title: "Etiquetas", url: "/etiquetas", icon: Tags }]
          : []),
        ...moduleGatedItems,
        { title: "Assinatura e Módulos", url: "/plano", icon: CreditCard },
      ];

  const masterItems = [
    { title: "Painel Master", url: "/master", icon: Globe },
    { title: "Empresas", url: "/master/empresas", icon: Building2 },
    { title: "Financeiro", url: "/master/financeiro", icon: DollarSign },
    { title: "Planos", url: "/master/planos", icon: CreditCard },
    { title: "Módulos", url: "/master/modulos", icon: Package },
    { title: "Solicitações", url: "/master/solicitacoes-modulos", icon: FileCheck },
    { title: "Lote Módulos", url: "/master/solicitacoes-lote", icon: Layers },
    { title: "Pgto Módulos", url: "/master/pagamentos-modulos", icon: Wallet },
    { title: "Usuários Globais", url: "/master/usuarios", icon: Users },
    { title: "Configurações", url: "/master/configuracoes", icon: Settings },
    { title: "Logs do Sistema", url: "/master/logs", icon: ScrollText },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/70 h-auto py-3">
            <div className="flex items-center gap-2 min-w-0 w-full">
              {displayLogoUrl ? (
                <img
                  src={displayLogoUrl}
                  alt={`Logo ${displayName}`}
                  className="h-7 w-7 rounded-md object-contain bg-sidebar-accent/40 p-0.5 shrink-0"
                />
              ) : (
                <Music className="h-5 w-5 text-sidebar-primary shrink-0" />
              )}
              {!collapsed && (
                <span className="font-bold text-xs leading-tight tracking-tight break-words whitespace-normal line-clamp-2" style={{ fontFamily: "Montserrat, sans-serif" }}>
                  {displayName}
                </span>
              )}
            </div>
          </SidebarGroupLabel>

          {isMasterAdmin && (
            <SidebarGroupContent className="mt-4">
              {!collapsed && <p className="text-xs text-sidebar-foreground/40 px-3 mb-1 uppercase tracking-wider">Master</p>}
              <SidebarMenu>
                {masterItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink to={item.url} end={item.url === "/master"} className="hover:bg-sidebar-accent/50" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                        <item.icon className="mr-2 h-4 w-4" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          )}

          <SidebarGroupContent className={isMasterAdmin ? "mt-4" : "mt-4"}>
            {!collapsed && isMasterAdmin && <p className="text-xs text-sidebar-foreground/40 px-3 mb-1 uppercase tracking-wider">Empresa</p>}
            <SidebarMenu>
              {companyItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} end={item.url === "/dashboard"} className="hover:bg-sidebar-accent/50" activeClassName="bg-sidebar-accent text-sidebar-primary font-medium">
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="p-2">
          {!collapsed && profile && (
            <div className="mb-2 px-2">
              <p className="text-xs text-sidebar-foreground/60 truncate">{profile.full_name}</p>
              <p className="text-[10px] text-sidebar-foreground/30 font-mono">v{APP_VERSION}</p>
            </div>
          )}
          {collapsed && (
            <p className="text-[9px] text-sidebar-foreground/30 font-mono text-center mb-1">v{APP_VERSION}</p>
          )}
          <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" />
            {!collapsed && "Sair"}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
