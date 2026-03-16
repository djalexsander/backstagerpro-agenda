import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, Users, Calendar, DollarSign } from "lucide-react";

export default function PainelMaster() {
  const { data: empresas = [] } = useQuery({
    queryKey: ["master-empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["master-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: events = [] } = useQuery({
    queryKey: ["master-events"],
    queryFn: async () => {
      const { data, error } = await supabase.from("events").select("*");
      if (error) throw error;
      return data;
    },
  });

  const stats = [
    { title: "Empresas", value: empresas.length, icon: Building2, color: "text-primary" },
    { title: "Usuários", value: profiles.length, icon: Users, color: "text-accent" },
    { title: "Eventos", value: events.length, icon: Calendar, color: "text-[hsl(var(--warning))]" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Painel Master</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((s) => (
          <Card key={s.title}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                  <s.icon className={`h-5 w-5 ${s.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{s.value}</p>
                  <p className="text-sm text-muted-foreground">{s.title}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          <h2 className="text-lg font-semibold mb-4">Empresas Recentes</h2>
          {empresas.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma empresa cadastrada.</p>
          ) : (
            <div className="space-y-2">
              {empresas.slice(0, 5).map((e: any) => (
                <div key={e.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <p className="font-medium">{e.nome_empresa}</p>
                    <p className="text-xs text-muted-foreground">{e.email}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${e.status === 'ativo' ? 'bg-accent/20 text-accent' : 'bg-destructive/20 text-destructive'}`}>
                    {e.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
