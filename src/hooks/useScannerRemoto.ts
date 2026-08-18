import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompanyRealtime } from "@/hooks/useCompanyRealtime";
import {
  endScannerRemotoSession,
  listScannerRemotoReads,
  listScannerRemotoSessions,
  registerScannerRemotoRead,
  startScannerRemotoSession,
} from "@/lib/scanner-remoto-service";
import type {
  RegisterScannerRemotoReadInput,
  StartScannerRemotoSessionInput,
} from "@/lib/scanner-remoto-types";

// Used by both the phone-facing ScannerRemoto page (sessaoId set to the
// session currently being scanned) and the desktop's
// RemoteScannerSessionsPanel (sessaoId omitted, only the open-sessions list
// is needed). Both get the same realtime wiring, so a scan performed on one
// terminal shows up on the other without either polling or a manual reload.
export function useScannerRemoto({
  companyId,
  sessaoId,
  enabled,
}: {
  companyId: string | null;
  sessaoId?: string | null;
  enabled: boolean;
}) {
  const queryClient = useQueryClient();
  const canQuery = Boolean(companyId && enabled);

  const { status: realtimeStatus } = useCompanyRealtime(
    enabled ? companyId : null,
    ["scanner_remoto_sessoes", "scanner_remoto_leituras"],
  );

  const sessionsQuery = useQuery({
    queryKey: ["scanner-remoto-sessoes", companyId, "abertas"],
    queryFn: () => listScannerRemotoSessions(companyId!, true),
    enabled: canQuery,
  });

  const readsQuery = useQuery({
    queryKey: ["scanner-remoto-leituras", companyId, sessaoId],
    queryFn: () => listScannerRemotoReads(companyId!, sessaoId!),
    enabled: canQuery && Boolean(sessaoId),
  });

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scanner-remoto-sessoes", companyId] }),
      queryClient.invalidateQueries({ queryKey: ["scanner-remoto-leituras", companyId] }),
    ]);

  const startSession = async (input: StartScannerRemotoSessionInput) => {
    const session = await startScannerRemotoSession(companyId!, input);
    await invalidate();
    return session;
  };

  // Resolves normally even for a rejected scan (acao_executada
  // 'nao_encontrado'/'erro') - only session-level problems (not found,
  // already encerrada, missing required fields) reject. Callers must
  // inspect the returned leitura's acao_executada, not rely on try/catch,
  // to tell a rejected scan from a successful one.
  const registerRead = async (input: RegisterScannerRemotoReadInput) => {
    const read = await registerScannerRemotoRead(companyId!, input);
    await invalidate();
    return read;
  };

  const endSession = async (sessionId: string) => {
    const session = await endScannerRemotoSession(companyId!, sessionId);
    await invalidate();
    return session;
  };

  return {
    sessions: sessionsQuery.data ?? [],
    reads: readsQuery.data ?? [],
    isLoading: sessionsQuery.isLoading,
    isLoadingReads: readsQuery.isLoading,
    error: sessionsQuery.error || readsQuery.error,
    realtimeStatus,
    startSession,
    registerRead,
    endSession,
  };
}
