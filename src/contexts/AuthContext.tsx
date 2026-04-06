import React, { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "master_admin" | "admin_empresa" | "usuario";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: { full_name: string; avatar_url: string | null; empresa_id: string | null } | null;
  empresaLogoUrl: string | null;
  empresaNome: string | null;
  role: AppRole | null;
  empresaId: string | null;
  empresaBloqueada: boolean;
  empresaReadOnly: boolean;
  precisaEscolherPlano: boolean;
  isMasterAdmin: boolean;
  isAdminEmpresa: boolean;
  isUsuario: boolean;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthContextType["profile"]>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [empresaBloqueada, setEmpresaBloqueada] = useState(false);
  const [precisaEscolherPlano, setPrecisaEscolherPlano] = useState(false);
  const [empresaLogoUrl, setEmpresaLogoUrl] = useState<string | null>(null);
  const [empresaNome, setEmpresaNome] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUserData = async (userId: string) => {
    const [profileRes, roleRes] = await Promise.all([
      supabase.from("profiles").select("full_name, avatar_url, empresa_id").eq("user_id", userId).single(),
      supabase.from("user_roles").select("role").eq("user_id", userId).single(),
    ]);
    if (profileRes.data) {
      setProfile(profileRes.data as any);
      // Check if empresa is blocked (trial expired) and get logo
      if (profileRes.data.empresa_id) {
        const { data: empresa } = await supabase
          .from("empresas")
          .select("plano_bloqueado, trial_expires_at, logo_url, nome_empresa, status, plano_id, vencimento, precisa_escolher_plano")
          .eq("id", profileRes.data.empresa_id)
          .single();
        if (empresa) {
          const hasPlano = !!(empresa as any).plano_id;
          const vencimento = (empresa as any).vencimento;
          // If company has a plan, check vencimento; otherwise check trial_expires_at
          const isExpired = hasPlano
            ? (vencimento && new Date(vencimento) < new Date())
            : (empresa.trial_expires_at && new Date(empresa.trial_expires_at) < new Date());
          const isInactive = (empresa as any).status === "inativo";
          setEmpresaBloqueada((empresa as any).plano_bloqueado || isExpired || isInactive);
          setPrecisaEscolherPlano(!!(empresa as any).precisa_escolher_plano);
          setEmpresaLogoUrl((empresa as any).logo_url || null);
          setEmpresaNome((empresa as any).nome_empresa || null);
        } else {
          setEmpresaBloqueada(false);
          setPrecisaEscolherPlano(false);
          setEmpresaLogoUrl(null);
          setEmpresaNome(null);
        }
      } else {
        setEmpresaBloqueada(false);
        setEmpresaLogoUrl(null);
        setEmpresaNome(null);
      }
    }
    if (roleRes.data) setRole(roleRes.data.role as AppRole);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => fetchUserData(session.user.id), 0);
        } else {
          setProfile(null);
          setRole(null);
          setEmpresaBloqueada(false);
          setPrecisaEscolherPlano(false);
          setEmpresaLogoUrl(null);
          setEmpresaNome(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error, data } = await supabase.auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      // Check if account is activated
      const { data: prof } = await supabase
        .from("profiles")
        .select("ativado")
        .eq("user_id", data.user.id)
        .single();

      if (prof && !prof.ativado) {
        await supabase.auth.signOut();
        return { error: new Error("Conta ainda não ativada. Utilize 'Primeiro acesso' para definir sua senha.") };
      }

      // Log login action asynchronously
      supabase.from("system_logs").insert({
        tipo: "auth",
        acao: "login",
        descricao: `Login realizado: ${data.user.email}`,
        user_id: data.user.id,
        user_name: data.user.user_metadata?.full_name || data.user.email,
      } as any).then(() => {});
    }
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const isMasterAdmin = role === "master_admin";
  const isAdminEmpresa = role === "admin_empresa";
  const isUsuario = role === "usuario";
  const empresaId = profile?.empresa_id ?? null;

  const empresaReadOnlyValue = isMasterAdmin ? false : empresaBloqueada;

  return (
    <AuthContext.Provider value={{
      user, session, profile, role, empresaId,
      empresaLogoUrl, empresaNome,
      empresaBloqueada: empresaReadOnlyValue,
      empresaReadOnly: empresaReadOnlyValue,
      isMasterAdmin, isAdminEmpresa, isUsuario,
      isAdmin: isMasterAdmin || isAdminEmpresa,
      loading, signIn, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
