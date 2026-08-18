import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Radio, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useScannerRemoto } from "@/hooks/useScannerRemoto";
import { listScannerRemotoReads } from "@/lib/scanner-remoto-service";
import {
  SCANNER_REMOTO_ACAO_LABELS,
  SCANNER_REMOTO_TIPO_OPERACAO_LABELS,
} from "@/lib/scanner-remoto-types";

const REALTIME_STATUS_LABEL: Record<string, string> = {
  connected: "Conectado",
  connecting: "Conectando",
  disconnected: "Desconectado",
};

function SessionReads({ companyId, sessionId }: { companyId: string; sessionId: string }) {
  // Deliberately a plain useQuery, not another useScannerRemoto/
  // useCompanyRealtime instance: the parent panel's own subscription
  // already invalidates every "scanner-remoto-leituras" query for this
  // company on a Postgres Changes event (React Query invalidation is keyed,
  // not tied to whichever component created the query), so this just needs
  // to read the cache/refetch through the same key - opening a second
  // realtime channel per expanded row would be redundant.
  const readsQuery = useQuery({
    queryKey: ["scanner-remoto-leituras", companyId, sessionId],
    queryFn: () => listScannerRemotoReads(companyId, sessionId),
  });
  const reads = readsQuery.data ?? [];

  if (readsQuery.isLoading) {
    return <p className="p-2 text-xs text-muted-foreground">Carregando leituras...</p>;
  }
  if (!reads.length) {
    return <p className="p-2 text-xs text-muted-foreground">Nenhuma leitura ainda.</p>;
  }
  return (
    <div className="space-y-1 border-t p-2">
      {reads.slice(0, 8).map((read) => (
        <div key={read.id} className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate">{read.material_nome ?? read.codigo_lido}</span>
          <Badge
            variant={
              read.acao_executada === "checkout" || read.acao_executada === "checkin"
                ? "outline"
                : "destructive"
            }
            className="shrink-0"
          >
            {SCANNER_REMOTO_ACAO_LABELS[read.acao_executada]}
          </Badge>
        </div>
      ))}
    </div>
  );
}

// Desktop-side mirror of ScannerRemoto.tsx: lists sessions opened from a
// phone/PWA terminal and their reads, kept live by the same reusable
// realtime layer (useScannerRemoto -> useCompanyRealtime) the phone page
// itself uses - this is what makes "phone scans -> desktop updates" visible
// without a refresh, for whoever is watching this screen.
export function RemoteScannerSessionsPanel({ companyId }: { companyId: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { sessions, realtimeStatus } = useScannerRemoto({ companyId, enabled: true });

  if (sessions.length === 0) return null;

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="h-4 w-4" /> Scanner Remoto - sessões abertas
        </CardTitle>
        <Badge variant={realtimeStatus === "connected" ? "outline" : "secondary"} className="gap-1">
          {realtimeStatus === "connected" ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          {REALTIME_STATUS_LABEL[realtimeStatus]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {sessions.map((session) => {
          const expanded = expandedId === session.id;
          return (
            <div key={session.id} className="rounded-md border">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 p-2 text-left text-sm"
                onClick={() => setExpandedId(expanded ? null : session.id)}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {session.titulo || SCANNER_REMOTO_TIPO_OPERACAO_LABELS[session.tipo_operacao]}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Aberta em {new Date(session.aberta_em).toLocaleString("pt-BR")}
                  </p>
                </div>
                {expanded ? (
                  <ChevronUp className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                )}
              </button>
              {expanded && <SessionReads companyId={companyId} sessionId={session.id} />}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
