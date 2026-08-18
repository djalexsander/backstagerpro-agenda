import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getCompanyAccessState } from "@/lib/access-control";
import { selectHighestPriorityRole, type AppRole } from "@/lib/user-role";

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
  statusPagamento: string | null;
  isMasterAdmin: boolean;
  isAdminEmpresa: boolean;
  isUsuario: boolean;
  isAdmin: boolean;
  isAccountActivated: boolean;
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
  const [statusPagamento, setStatusPagamento] = useState<string | null>(null);
  const [isAccountActivated, setIsAccountActivated] = useState(false);
  const [loading, setLoading] = useState(true);
  const authLoadIdRef = useRef(0);

  const clearOperationalState = () => {
    setProfile(null);
    setRole(null);
    setEmpresaBloqueada(false);
    setPrecisaEscolherPlano(false);
    setEmpresaLogoUrl(null);
    setEmpresaNome(null);
    setStatusPagamento(null);
  };

  const fetchUserData = async (userId: string) => {
    const profileRes = await supabase
      .from("profiles")
      .select("full_name, avatar_url, empresa_id, ativado")
      .eq("user_id", userId)
      .single();

    const activated = profileRes.data?.ativado === true;
    setIsAccountActivated(activated);

    // Fail closed before loading any tenant, company or role state. Recovery
    // sessions remain alive so Primeiro Acesso can consume their OTP.
    if (!activated) {
      clearOperationalState();
      return;
    }

    const roleRes = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);

    if (profileRes.data) {
      setProfile(profileRes.data as any);
      // Check if empresa is blocked (trial expired) and get logo
      if (profileRes.data.empresa_id) {
        const { data: empresa } = await supabase
          .from("empresas")
          .select("plano_bloqueado, trial_expires_at, logo_url, nome_empresa, status, plano_id, vencimento, precisa_escolher_plano, status_pagamento, planos!empresas_plano_id_fkey(periodicidade)")
          .eq("id", profileRes.data.empresa_id)
          .single();
        if (empresa) {
          const planRelation = empresa.planos as
            | { periodicidade: string | null }
            | null;
          const access = getCompanyAccessState({
            ...empresa,
            plan_periodicity: planRelation?.periodicidade ?? null,
          });
          setEmpresaBloqueada(access.blocked);
          setPrecisaEscolherPlano(access.needsPlanSelection);
          setEmpresaLogoUrl(empresa.logo_url || null);
          setEmpresaNome(empresa.nome_empresa || null);
          setStatusPagamento(access.paymentStatus);
        } else {
          setEmpresaBloqueada(false);
          setPrecisaEscolherPlano(false);
          setEmpresaLogoUrl(null);
          setEmpresaNome(null);
          setStatusPagamento(null);
        }
      } else {
        setEmpresaBloqueada(false);
        setPrecisaEscolherPlano(false);
        setEmpresaLogoUrl(null);
        setEmpresaNome(null);
        setStatusPagamento(null);
      }
    }
    setRole(selectHighestPriorityRole(roleRes.data ?? []));
  };

  useEffect(() => {
    let active = true;

    const loadUserData = async (userId: string) => {
      const loadId = ++authLoadIdRef.current;
      setLoading(true);
      try {
        await fetchUserData(userId);
      } finally {
        if (active && authLoadIdRef.current === loadId) setLoading(false);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          // Close the previous session's authorization window immediately;
          // no route may reuse stale activation, tenant or role state while
          // the new/refreshed session is being classified.
          setLoading(true);
          setIsAccountActivated(false);
          clearOperationalState();
          setTimeout(() => {
            if (active) void loadUserData(session.user.id);
          }, 0);
        } else {
          authLoadIdRef.current += 1;
          setIsAccountActivated(false);
          clearOperationalState();
          setLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        void loadUserData(session.user.id);
      } else {
        setLoading(false);
      }
    });

    return () => {
      active = false;
      authLoadIdRef.current += 1;
      subscription.unsubscribe();
    };
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

  const refreshProfile = async () => {
    if (user) await fetchUserData(user.id);
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
      precisaEscolherPlano: isMasterAdmin ? false : precisaEscolherPlano,
      statusPagamento: isMasterAdmin ? null : statusPagamento,
      isMasterAdmin, isAdminEmpresa, isUsuario,
      isAdmin: isMasterAdmin || isAdminEmpresa,
      isAccountActivated,
      loading, signIn, signOut, refreshProfile,
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
