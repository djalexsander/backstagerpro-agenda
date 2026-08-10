import { supabase } from "@/integrations/supabase/client";
import type { CustomerOption } from "./material-rental-types";

interface RpcError {
  message?: string;
  code?: string;
}

type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

function throwClientError(error: RpcError | null, context: string): never {
  const messages: Record<string, string> = {
    LR004: "Revise os dados do cliente.",
    LR005: "Cliente não encontrado.",
    LR009: "A locação e suas dependências precisam estar ativas para gerenciar clientes.",
    LR010: "A empresa está em modo somente leitura.",
  };
  const message = (error?.code && messages[error.code]) || error?.message || "Falha na operação de clientes.";
  console.error(`[client-service] ${context}`, error);
  throw new Error(message);
}

export interface SaveClientInput {
  id?: string;
  personType: "pessoa_fisica" | "pessoa_juridica";
  name: string;
  fantasyName?: string;
  document?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

// Same canonical RPCs the Nova Locação quick-register form already uses
// (public.clientes has no direct INSERT/UPDATE policy for `authenticated` -
// these SECURITY DEFINER functions are the only sanctioned write path).
export async function listClients(companyId: string, search = "", includeInactive = false) {
  const { data, error } = await callRpc("listar_clientes", {
    _empresa_id: companyId,
    _busca: search || undefined,
    _somente_ativos: !includeInactive,
    _limite: 200,
  });
  if (error) throwClientError(error, "list clients");
  return (data ?? []) as CustomerOption[];
}

export async function saveClient(companyId: string, input: SaveClientInput) {
  const { data, error } = await callRpc("salvar_cliente", {
    _empresa_id: companyId,
    _cliente_id: input.id,
    _tipo_pessoa: input.personType,
    _nome: input.name,
    _nome_fantasia: input.fantasyName || undefined,
    _cpf_cnpj: input.document || undefined,
    _email: input.email || undefined,
    _telefone: input.phone || undefined,
    _observacoes: input.notes || undefined,
  });
  if (error) throwClientError(error, "save client");
  return data as CustomerOption;
}

export async function setClientActive(companyId: string, clientId: string, active: boolean) {
  const { data, error } = await callRpc("alternar_status_cliente", {
    _empresa_id: companyId,
    _cliente_id: clientId,
    _ativo: active,
  });
  if (error) throwClientError(error, "toggle client status");
  return data as CustomerOption;
}
