import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ArrowLeft,
  CheckCircle,
  Eye,
  EyeOff,
  Mail,
  Music,
  ShieldCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePlatformBranding } from "@/hooks/useSystemSettings";
import { supabase } from "@/integrations/supabase/client";
import {
  runAccountActivation,
  type ActivationFlow,
} from "@/lib/account-activation-flow";
import { getEdgeFunctionErrorMessage } from "@/lib/edge-function-error";

type PageMode = "checking" | "request" | "sent" | "activate" | "success";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado. Tente novamente.";
}

function normalizeFlow(value: unknown): ActivationFlow | null {
  return value === "invite" || value === "recovery" ? value : null;
}

export function getAuthParamsFromLocation(location: Location) {
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(location.search);

  const accessToken = hashParams.get("access_token") || searchParams.get("access_token");
  const refreshToken = hashParams.get("refresh_token") || searchParams.get("refresh_token");
  const code = hashParams.get("code") || searchParams.get("code");
  const flowId = hashParams.get("flow_id") || searchParams.get("flow_id");
  const type = hashParams.get("type") || searchParams.get("type");

  return {
    accessToken,
    refreshToken,
    code,
    flowId,
    type,
    hasRecoveryTokens:
      Boolean(accessToken && refreshToken) || Boolean(code) || type === "recovery",
  };
}

export function clearRecoveredAuthParams(location: Location) {
  const url = new URL(location.href);
  const paramsToRemove = [
    "access_token",
    "refresh_token",
    "expires_in",
    "expires_at",
    "token_type",
    "type",
    "code",
    "flow_id",
    "state",
    "error",
    "error_description",
    "error_code",
  ];

  paramsToRemove.forEach((param) => {
    url.searchParams.delete(param);
  });

  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  paramsToRemove.forEach((param) => {
    hashParams.delete(param);
  });

  url.hash = hashParams.toString() ? `#${hashParams.toString()}` : "";

  try {
    window.history.replaceState(window.history.state, "", url.toString());
  } catch (error) {
    console.warn("Não foi possível limpar os parâmetros de auth da URL.", error);
  }
}

export default function PrimeiroAcesso() {
  const [mode, setMode] = useState<PageMode>("checking");
  const [flow, setFlow] = useState<ActivationFlow | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { platformLogoUrl, platformName } = usePlatformBranding();

  useEffect(() => {
    let active = true;

    const resolveActivationSession = async () => {
      const authParams = getAuthParamsFromLocation(window.location);

      try {
        if (authParams.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(
            authParams.code,
            authParams.flowId ? { flowId: authParams.flowId } : undefined,
          );
          if (error) throw error;
        } else if (authParams.accessToken && authParams.refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: authParams.accessToken,
            refresh_token: authParams.refreshToken,
          });
          if (error) throw error;
        }
      } catch (error) {
        console.warn("Não foi possível consumir a sessão de ativação do link.", error);
      }

      if (authParams.hasRecoveryTokens) {
        clearRecoveredAuthParams(window.location);
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!active) return;

      const metadataFlow = normalizeFlow(
        session?.user.user_metadata?.account_activation_flow,
      );
      if (session && metadataFlow) {
        setFlow(metadataFlow);
        setMode("activate");
        return;
      }

      setMode("request");
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY" || event === "TOKEN_REFRESHED") {
        void resolveActivationSession();
      }
    });

    void resolveActivationSession();
    const timeout = window.setTimeout(() => {
      void resolveActivationSession();
    }, 1_500);

    return () => {
      active = false;
      subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, []);

  const handleRequestLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "request-account-activation",
        { body: { email: email.trim().toLowerCase() } },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMode("sent");
    } catch (error) {
      toast({
        title: "Erro ao solicitar ativação",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleActivation = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!flow) {
      setMode("request");
      return;
    }

    setLoading(true);
    try {
      const result = await runAccountActivation(
        {
          getAccessToken: async () => {
            const { data: { session } } = await supabase.auth.getSession();
            return session?.access_token ?? null;
          },
          invokeActivateAccount: async ({ accessToken, password: pwd, flow: activationFlow }) => {
            const { data, error } = await supabase.functions.invoke(
              "activate-account",
              {
                headers: { Authorization: `Bearer ${accessToken}` },
                body: { password: pwd, flow_type: activationFlow },
              },
            );
            if (error) {
              return { error: await getEdgeFunctionErrorMessage(error) };
            }
            if (data?.error) return { error: data.error as string };
            return { error: null };
          },
          signOut: () => supabase.auth.signOut(),
        },
        { password, confirmPassword, flow },
      );

      if (!result.success) {
        toast({
          title: "Erro ao ativar conta",
          description: result.message,
          variant: "destructive",
        });
        return;
      }

      setMode("success");
    } finally {
      setLoading(false);
    }
  };

  const branding = (
    <div className="flex items-center justify-center gap-3 mb-8">
      <div className="h-12 w-12 rounded-xl bg-primary/10 border border-border flex items-center justify-center overflow-hidden">
        {platformLogoUrl ? (
          <img
            src={platformLogoUrl}
            alt={`Logo ${platformName}`}
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <Music className="h-7 w-7 text-primary" />
        )}
      </div>
      <h1
        className="text-3xl font-bold tracking-tight"
        style={{ fontFamily: "Montserrat, sans-serif" }}
      >
        {platformName}
      </h1>
    </div>
  );

  if (mode === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (mode === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-primary" />
            </div>
          </div>
          <h2 className="text-2xl font-bold">Conta ativada com sucesso!</h2>
          <p className="text-muted-foreground">
            O convite foi consumido e sua senha foi definida.
          </p>
          <Button onClick={() => navigate("/login")} className="w-full">
            Ir para login
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "sent") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Mail className="h-8 w-8 text-primary" />
            </div>
          </div>
          <h2 className="text-2xl font-bold">Verifique seu email</h2>
          <p className="text-muted-foreground">
            Se a conta estiver pendente, você receberá um link de uso único.
            O link expira conforme a configuração de segurança do Supabase.
          </p>
          <Button onClick={() => navigate("/login")} className="w-full">
            Voltar ao login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {branding}
        <Card>
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="h-6 w-6 text-primary" />
              </div>
            </div>
            <CardTitle>Primeiro acesso</CardTitle>
            <CardDescription>
              {mode === "activate"
                ? "Defina sua senha para consumir este convite."
                : "Solicite um link de ativação no email cadastrado."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mode === "request" ? (
              <form onSubmit={handleRequestLink} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Enviando..." : "Enviar link de ativação"}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleActivation} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Nova senha</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={8}
                      maxLength={128}
                      autoComplete="new-password"
                      placeholder="Mínimo 8 caracteres"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowPassword((current) => !current)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirmar senha</Label>
                  <div className="relative">
                    <Input
                      id="confirm"
                      type={showConfirm ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      required
                      minLength={8}
                      maxLength={128}
                      autoComplete="new-password"
                      placeholder="Repita a senha"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowConfirm((current) => !current)}
                    >
                      {showConfirm ? (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Ativando..." : "Ativar conta"}
                </Button>
              </form>
            )}
            <Button
              type="button"
              variant="ghost"
              className="w-full mt-2"
              onClick={() => navigate("/login")}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar ao login
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
