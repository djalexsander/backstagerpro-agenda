import { LayoutDashboard, Calendar, DollarSign, Users, LogOut, Music, Building2, Globe, Settings, ScrollText, CreditCard, Database } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isMasterAdmin, isAdminEmpresa, profile, signOut } = useAuth();

  const companyItems = [
    { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    { title: "Agenda", url: "/agenda", icon: Calendar },
    ...(isAdminEmpresa || isMasterAdmin ? [
      { title: "Financeiro", url: "/financeiro", icon: DollarSign },
      { title: "Usuários", url: "/usuarios", icon: Users },
      { title: "Plano / Assinatura", url: "/plano", icon: CreditCard },
      { title: "Backups", url: "/backups", icon: Database },
    ] : []),
  ];

  const masterItems = [
    { title: "Painel Master", url: "/master", icon: Globe },
    { title: "Empresas", url: "/master/empresas", icon: Building2 },
    { title: "Planos", url: "/master/planos", icon: CreditCard },
    { title: "Usuários Globais", url: "/master/usuarios", icon: Users },
    { title: "Configurações", url: "/master/configuracoes", icon: Settings },
    { title: "Logs do Sistema", url: "/master/logs", icon: ScrollText },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/70">
            <div className="flex items-center gap-2">
              <Music className="h-5 w-5 text-sidebar-primary" />
              {!collapsed && <span className="font-bold text-base tracking-tight" style={{ fontFamily: 'Montserrat, sans-serif' }}>Backstage Pro</span>}
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
            <p className="text-xs text-sidebar-foreground/60 mb-2 truncate px-2">{profile.full_name}</p>
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
