import { supabase } from "@/integrations/supabase/client";

interface RpcError {
  message?: string;
  code?: string;
}

type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

// criar_notificacao e as RPCs abaixo (20260819090000_push_notifications_foundation.sql)
// não estão no types.ts gerado (sem Supabase CLI local para regenerar) -
// mesmo padrão de cast já usado em user-module-permissions-service.ts.
const callRpc = supabase.rpc.bind(supabase) as unknown as RpcCaller;

export interface MinhaNotificacao {
  destinatarioId: string;
  notificacaoId: string;
  categoria: "operacional" | "financeiro";
  tipo: string;
  titulo: string;
  mensagem: string;
  referenciaTipo: string | null;
  referenciaId: string | null;
  rota: string | null;
  lida: boolean;
  lidaEm: string | null;
  createdAt: string;
}

interface RawNotificacaoRow {
  destinatario_id: string;
  notificacao_id: string;
  categoria: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  referencia_tipo: string | null;
  referencia_id: string | null;
  rota: string | null;
  lida: boolean;
  lida_em: string | null;
  created_at: string;
}

function fromRaw(row: RawNotificacaoRow): MinhaNotificacao {
  return {
    destinatarioId: row.destinatario_id,
    notificacaoId: row.notificacao_id,
    categoria: row.categoria as MinhaNotificacao["categoria"],
    tipo: row.tipo,
    titulo: row.titulo,
    mensagem: row.mensagem,
    referenciaTipo: row.referencia_tipo,
    referenciaId: row.referencia_id,
    rota: row.rota,
    lida: row.lida,
    lidaEm: row.lida_em,
    createdAt: row.created_at,
  };
}

function throwServiceError(error: RpcError | null, fallback: string, context: string): never {
  console.error(`[push-notifications-service] ${context}`, error);
  throw new Error(error?.message || fallback);
}

export async function listMinhasNotificacoes(
  options: { somenteNaoLidas?: boolean; limite?: number } = {},
): Promise<MinhaNotificacao[]> {
  const { data, error } = await callRpc("listar_minhas_notificacoes", {
    _somente_nao_lidas: options.somenteNaoLidas ?? false,
    _limite: options.limite ?? 30,
  });
  if (error) throwServiceError(error, "Falha ao carregar notificações.", "list notifications");
  return ((data ?? []) as RawNotificacaoRow[]).map(fromRaw);
}

export async function marcarNotificacaoLida(destinatarioId: string): Promise<void> {
  const { error } = await callRpc("marcar_notificacao_lida", { _destinatario_id: destinatarioId });
  if (error) throwServiceError(error, "Falha ao marcar notificação como lida.", "mark read");
}

export async function marcarTodasNotificacoesLidas(): Promise<void> {
  const { error } = await callRpc("marcar_todas_notificacoes_lidas");
  if (error) throwServiceError(error, "Falha ao marcar notificações como lidas.", "mark all read");
}

export async function excluirMinhasNotificacoesLidas(): Promise<void> {
  const { error } = await callRpc("excluir_minhas_notificacoes_lidas");
  if (error) throwServiceError(error, "Falha ao excluir notificações visualizadas.", "delete read");
}

export async function setNotificacaoPreferencia(tipo: string, habilitada: boolean): Promise<void> {
  const { error } = await callRpc("set_notificacao_preferencia", { _tipo: tipo, _habilitada: habilitada });
  if (error) throwServiceError(error, "Falha ao salvar preferência de notificação.", "set preference");
}

// ============================================================================
// Push subscription (browser Push API <-> registrar/remover_push_subscription)
// ============================================================================

export type PushSupportState = "unsupported" | "denied" | "subscribed" | "not-subscribed";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// Snippet padrão da Web Push API para converter a chave pública VAPID
// (base64url) no formato Uint8Array que applicationServerKey espera.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }
  return output;
}

export async function getPushSubscriptionState(): Promise<PushSupportState> {
  if (!isPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? "subscribed" : "not-subscribed";
}

/**
 * Pede permissão do navegador (deve ser chamado a partir de um gesto do
 * usuário - um clique - nunca automaticamente no carregamento da página) e
 * registra o dispositivo para push desta empresa. A chave pública VAPID é
 * pública por natureza (só a privada, usada só na Edge Function
 * send-push-notification, precisa ficar em segredo).
 */
export async function subscribeToPush(empresaId: string): Promise<void> {
  if (!isPushSupported()) {
    throw new Error("Este navegador não suporta notificações push.");
  }
  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidPublicKey) {
    throw new Error("Notificações push não configuradas neste ambiente.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Permissão de notificações negada.");
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  const json = subscription.toJSON();
  const keys = json.keys ?? {};
  if (!json.endpoint || !keys.p256dh || !keys.auth) {
    throw new Error("Inscrição de push inválida.");
  }

  const { error } = await callRpc("registrar_push_subscription", {
    _empresa_id: empresaId,
    _endpoint: json.endpoint,
    _p256dh: keys.p256dh,
    _auth: keys.auth,
    _user_agent: navigator.userAgent,
  });
  if (error) throwServiceError(error, "Falha ao registrar dispositivo para notificações.", "subscribe");
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const { error } = await callRpc("remover_push_subscription", { _endpoint: subscription.endpoint });
  if (error) console.error("[push-notifications-service] unsubscribe", error);

  await subscription.unsubscribe();
}
