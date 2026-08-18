// Only entry point for Scanner Remoto data access: every export here calls
// a Supabase RPC. There is no direct insert/update/delete against
// scanner_remoto_sessoes/scanner_remoto_leituras from the frontend, and the
// RPCs themselves never move custody directly - they delegate to
// registrar_checkout_material/registrar_checkin_material. See
// supabase/migrations/20260818090000_scanner_remoto_realtime.sql.
import { supabase } from "@/integrations/supabase/client";
import { translateScannerRemotoError } from "./scanner-remoto-errors";
import type {
  RegisterScannerRemotoReadInput,
  ScannerRemotoLeitura,
  ScannerRemotoSessao,
  StartScannerRemotoSessionInput,
} from "./scanner-remoto-types";

// scanner_remoto_* tables/RPCs aren't in the generated Supabase types yet -
// same unwrapped-RPC pattern already used by rfid-service.ts/
// client-service.ts/user-module-permissions-service.ts for the same reason
// (no local Supabase CLI to regenerate src/integrations/supabase/types.ts).
interface RpcError {
  message?: string;
  code?: string;
}

type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

function throwScannerRemotoError(error: RpcError | null, context: string): never {
  const translated = translateScannerRemotoError(error);
  if (!translated.handled) {
    console.error(`[scanner-remoto-service] ${context}`, error);
  }
  throw translated;
}

export async function startScannerRemotoSession(
  companyId: string,
  input: StartScannerRemotoSessionInput,
): Promise<ScannerRemotoSessao> {
  const { data, error } = await callRpc("iniciar_sessao_scanner_remoto", {
    _tipo_operacao: input.tipoOperacao,
    _condicao: input.condicao,
    _client_uuid: input.clientUuid,
    _responsavel_tipo: input.responsibleType || undefined,
    _responsavel_id: input.responsibleId || undefined,
    _finalidade: input.purpose || undefined,
    _localizacao_origem_id: input.originLocationId || undefined,
    _localizacao_destino_id: input.destinationLocationId || undefined,
    _referencia_tipo: input.referenceType || undefined,
    _referencia_id: input.referenceId || undefined,
    _observacao: input.observacao?.trim() || undefined,
    _titulo: input.titulo?.trim() || undefined,
    _empresa_id: companyId,
  });
  if (error) throwScannerRemotoError(error, "start session");
  return data as ScannerRemotoSessao;
}

export async function registerScannerRemotoRead(
  companyId: string,
  input: RegisterScannerRemotoReadInput,
): Promise<ScannerRemotoLeitura> {
  const { data, error } = await callRpc("registrar_leitura_scanner_remoto", {
    _sessao_id: input.sessaoId,
    _codigo_lido: input.codigoLido,
    _client_uuid: input.clientUuid,
    _empresa_id: companyId,
  });
  if (error) throwScannerRemotoError(error, "register read");
  return data as ScannerRemotoLeitura;
}

export async function endScannerRemotoSession(
  companyId: string,
  sessaoId: string,
): Promise<ScannerRemotoSessao> {
  const { data, error } = await callRpc("encerrar_sessao_scanner_remoto", {
    _sessao_id: sessaoId,
    _empresa_id: companyId,
  });
  if (error) throwScannerRemotoError(error, "end session");
  return data as ScannerRemotoSessao;
}

export async function listScannerRemotoSessions(
  companyId: string,
  onlyOpen = true,
): Promise<ScannerRemotoSessao[]> {
  const { data, error } = await callRpc("listar_sessoes_scanner_remoto", {
    _somente_abertas: onlyOpen,
    _empresa_id: companyId,
  });
  if (error) throwScannerRemotoError(error, "list sessions");
  return (data ?? []) as ScannerRemotoSessao[];
}

export async function listScannerRemotoReads(
  companyId: string,
  sessaoId: string,
): Promise<ScannerRemotoLeitura[]> {
  const { data, error } = await callRpc("listar_leituras_scanner_remoto", {
    _sessao_id: sessaoId,
    _empresa_id: companyId,
  });
  if (error) throwScannerRemotoError(error, "list reads");
  return (data ?? []) as ScannerRemotoLeitura[];
}
