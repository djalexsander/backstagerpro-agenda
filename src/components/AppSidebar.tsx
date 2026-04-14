import { LayoutDashboard, Calendar, DollarSign, Users, LogOut, Music, Building2, Globe, Settings, ScrollText, CreditCard, Database, FileText, HardHat, Package } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { usePlatformBranding } from "@/hooks/useSystemSettings";
import appVersion from "../../package.json";

const APP_VERSION = appVersion.version;

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isMasterAdmin, isAdminEmpresa, profile, signOut, empresaLogoUrl, empresaNome, empresaReadOnly } = useAuth();
  const { platformLogoUrl, platformName } = usePlatformBranding();

  // For company users, show empresa logo/name; for master, show platform branding
  const displayLogoUrl = isMasterAdmin ? platformLogoUrl : (empresaLogoUrl || platformLogoUrl);
  const displayName = isMasterAdmin ? platformName : (empresaNome || platformName);

  const isUsuario = !isMasterAdmin && !isAdminEmpresa;

  const companyItems = isUsuario
    ? [
        { title: "Agenda", url: "/agenda", icon: Calendar },
        ...(empresaReadOnly ? [{ title: "Plano / Assinatura", url: "/plano", icon: CreditCard }] : []),
      ]
    : empresaReadOnly
    ? [
        { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
        { title: "Agenda", url: "/agenda", icon: Calendar },
        { title: "Financeiro", url: "/financeiro", icon: DollarSign },
        { title: "Plano / Assinatura", url: "/plano", icon: CreditCard },
        { title: "Documentos", url: "/documentos", icon: FileText },
        { title: "Funcionários", url: "/funcionarios", icon: HardHat },
      ]
    : [
        { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
        { title: "Agenda", url: "/agenda", icon: Calendar },
        { title: "Financeiro", url: "/financeiro", icon: DollarSign },
        { title: "Usuários", url: "/usuarios", icon: Users },
        { title: "Plano / Assinatura", url: "/plano", icon: CreditCard },
        { title: "Documentos", url: "/documentos", icon: FileText },
        { title: "Funcionários", url: "/funcionarios", icon: HardHat },
        { title: "Backups", url: "/backups", icon: Database },
      ];

  const masterItems = [
    { title: "Painel Master", url: "/master", icon: Globe },
    { title: "Empresas", url: "/master/empresas", icon: Building2 },
    { title: "Financeiro", url: "/master/financeiro", icon: DollarSign },
    { title: "Planos", url: "/master/planos", icon: CreditCard },
    { title: "Módulos", url: "/master/modulos", icon: Package },
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
