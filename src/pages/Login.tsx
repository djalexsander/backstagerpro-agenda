import { useState, useEffect } from "react";
import appVersion from "../../package.json";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Music } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { usePlatformBranding } from "@/hooks/useSystemSettings";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn, role } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { platformLogoUrl, platformName } = usePlatformBranding();

  useEffect(() => {
    const savedEmail = localStorage.getItem("backstage_saved_email");
    if (savedEmail) {
      setEmail(savedEmail);
      setRemember(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (remember) {
      localStorage.setItem("backstage_saved_email", email);
    } else {
      localStorage.removeItem("backstage_saved_email");
    }
    // Remove legacy insecure storage
    localStorage.removeItem("backstage_saved_login");

    const { error } = await signIn(email, password);
    if (error) {
      toast({ title: "Erro ao entrar", description: error.message, variant: "destructive" });
    } else {
      navigate("/agenda");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="h-12 w-12 rounded-xl bg-primary/10 border border-border flex items-center justify-center overflow-hidden">
            {platformLogoUrl ? (
              <img src={platformLogoUrl} alt={`Logo ${platformName}`} className="h-full w-full object-contain p-1" />
            ) : (
              <Music className="h-7 w-7 text-primary" />
            )}
          </div>
          <h1 className="text-3xl font-bold tracking-tight" style={{ fontFamily: 'Montserrat, sans-serif' }}>
            {platformName}
          </h1>
        </div>
        <p className="text-xs text-muted-foreground -mt-6 mb-6 text-center">v{appVersion.version}</p>
        <Card>
          <CardHeader className="text-center">
            <CardTitle>Entrar</CardTitle>
            <CardDescription>Acesse o sistema de gestão de eventos</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="remember" checked={remember} onCheckedChange={(v) => setRemember(!!v)} />
                <Label htmlFor="remember" className="text-sm text-muted-foreground cursor-pointer">Lembrar meu e-mail</Label>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Carregando..." : "Entrar"}
              </Button>
            </form>
            <div className="mt-4 text-center space-y-1">
              <Button variant="link" className="text-sm text-muted-foreground" onClick={() => navigate("/esqueci-senha")}>
                Esqueci minha senha
              </Button>
              <br />
              <Button variant="link" className="text-sm text-muted-foreground" onClick={() => navigate("/primeiro-acesso")}>
                Primeiro acesso? Ative sua conta aqui
              </Button>
            </div>
            <div className="mt-2">
              <Button variant="outline" className="w-full" onClick={() => navigate("/cadastro")}>
                Criar Conta
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
