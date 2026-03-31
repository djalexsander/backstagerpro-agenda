import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollText, RefreshCw, Search, Filter, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface SystemLog {
  id: string;
  tipo: string;
  acao: string;
  descricao: string;
  user_id: string | null;
  user_name: string | null;
  empresa_id: string | null;
  empresa_nome: string | null;
  dados: any;
  created_at: string;
}

const TIPO_LABELS: Record<string, string> = {
  auth: "Autenticação",
  empresa: "Empresa",
  plano: "Plano",
  usuario: "Usuário",
  pagamento: "Pagamento",
  info: "Info",
};

const TIPO_COLORS: Record<string, string> = {
  auth: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  empresa: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  plano: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  usuario: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  pagamento: "bg-green-500/10 text-green-400 border-green-500/20",
  info: "bg-muted text-muted-foreground border-border",
};

const PAGE_SIZE = 50;

export default function LogsSistema() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroBusca, setFiltroBusca] = useState("");
  const [empresas, setEmpresas] = useState<{ id: string; nome_empresa: string }[]>([]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fetchLogs = async () => {
    setLoading(true);

    // Count query
    let countQuery = supabase
      .from("system_logs")
      .select("id", { count: "exact", head: true });

    if (filtroTipo !== "todos") countQuery = countQuery.eq("tipo", filtroTipo);
    if (filtroEmpresa) countQuery = countQuery.eq("empresa_id", filtroEmpresa);
    if (filtroBusca) countQuery = countQuery.ilike("descricao", `%${filtroBusca}%`);

    const { count } = await countQuery;
    setTotalCount(count ?? 0);

    // Data query with pagination
    let query = supabase
      .from("system_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (filtroTipo !== "todos") query = query.eq("tipo", filtroTipo);
    if (filtroEmpresa) query = query.eq("empresa_id", filtroEmpresa);
    if (filtroBusca) query = query.ilike("descricao", `%${filtroBusca}%`);

    const { data } = await query;
    setLogs((data as any) || []);
    setLoading(false);
  };

  const fetchEmpresas = async () => {
    const { data } = await supabase.from("empresas").select("id, nome_empresa").order("nome_empresa");
    setEmpresas(data || []);
  };

  useEffect(() => {
    fetchEmpresas();
  }, []);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [filtroTipo, filtroEmpresa, filtroBusca]);

  useEffect(() => {
    fetchLogs();
  }, [filtroTipo, filtroEmpresa, filtroBusca, page]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Logs do Sistema</h1>
        <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar na descrição..."
                value={filtroBusca}
                onChange={(e) => setFiltroBusca(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filtroTipo} onValueChange={setFiltroTipo}>
              <SelectTrigger>
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os tipos</SelectItem>
                <SelectItem value="auth">Autenticação</SelectItem>
                <SelectItem value="empresa">Empresa</SelectItem>
                <SelectItem value="plano">Plano</SelectItem>
                <SelectItem value="usuario">Usuário</SelectItem>
                <SelectItem value="pagamento">Pagamento</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroEmpresa || "todas"} onValueChange={(v) => setFiltroEmpresa(v === "todas" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Empresa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as empresas</SelectItem>
                {empresas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.nome_empresa}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-muted-foreground" />
            Registros de Atividade
            <Badge variant="secondary" className="ml-auto">{totalCount}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : logs.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-12">
              Nenhum registro encontrado.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Data/Hora</TableHead>
                    <TableHead className="w-[120px]">Tipo</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-[150px]">Usuário</TableHead>
                    <TableHead className="w-[150px]">Empresa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(log.created_at), "dd/MM/yy HH:mm:ss", { locale: ptBR })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={TIPO_COLORS[log.tipo] || TIPO_COLORS.info}>
                          {TIPO_LABELS[log.tipo] || log.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{log.descricao}</TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[150px]">
                        {log.user_name || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[150px]">
                        {log.empresa_nome || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {page + 1} / {totalPages}
                    </span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
