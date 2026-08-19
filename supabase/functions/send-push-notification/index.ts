// Envia Web Push para os destinatarios pendentes de UMA notificacao ja
// persistida (public.notificacoes / notificacoes_destinatarios). Nunca
// chamada pelo frontend: e disparada pelo trigger
// dispatch_push_for_notification() via pg_net.http_post, autenticada por
// segredo compartilhado (mesmo padrao de check-vencimentos), nunca pela
// service_role key do cliente. A chave privada VAPID so existe aqui, como
// secret de Edge Function - nunca chega ao bundle do PWA.
//
// server-authoritative: a notificacao (e o fan-out de destinatarios) ja foi
// gravada por criar_notificacao() ANTES desta funcao ser chamada - aqui so
// resta entregar. Se o push falhar, os destinatarios continuam visiveis no
// sino via listar_minhas_notificacoes (a linha em notificacoes_destinatarios
// ja existe independente do resultado do push).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2";
import webpush from "npm:web-push@3.6.7";
import { authorizeInternalRequest } from "../_shared/internal-request.ts";

const responseHeaders = { "Content-Type": "application/json" };

type SupabaseAdmin = ReturnType<typeof createClient>;

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface DestinatarioRow {
  id: string;
  user_id: string;
  push_tentativas: number;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authorization = authorizeInternalRequest(
    Deno.env.get("PUSH_DISPATCH_SECRET"),
    req.headers.get("x-internal-secret"),
  );
  if (authorization === "misconfigured") {
    console.error("PUSH_DISPATCH_SECRET is missing or shorter than 32 characters");
    return jsonResponse({ error: "Push dispatch unavailable" }, 503);
  }
  if (authorization === "unauthorized") {
    console.error("Unauthorized send-push-notification invocation rejected");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject || !supabaseUrl || !serviceRoleKey) {
    console.error("Push dispatch configuration is missing (VAPID keys or Supabase service config)");
    return jsonResponse({ error: "Push dispatch unavailable" }, 503);
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }
  const notificacaoId =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).notificacao_id === "string"
      ? (body as Record<string, unknown>).notificacao_id as string
      : null;
  if (!notificacaoId) {
    return jsonResponse({ error: "notificacao_id is required" }, 400);
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: notificacao, error: notifError } = await supabase
      .from("notificacoes")
      .select("id, tipo, titulo, mensagem, rota")
      .eq("id", notificacaoId)
      .maybeSingle();
    if (notifError) {
      console.error("Error loading notificacao:", notifError);
      return jsonResponse({ error: "Unable to load notification" }, 500);
    }
    if (!notificacao) {
      // Nunca deveria acontecer (a linha e criada antes do dispatch), mas
      // responder 200 evita que pg_net fique reenfileirando indefinidamente.
      return jsonResponse({ received: true, sent: 0, motivo: "notificacao_nao_encontrada" });
    }

    const { data: destinatarios, error: destError } = await supabase
      .from("notificacoes_destinatarios")
      .select("id, user_id, push_tentativas")
      .eq("notificacao_id", notificacaoId)
      .eq("push_status", "pendente");
    if (destError) {
      console.error("Error loading destinatarios:", destError);
      return jsonResponse({ error: "Unable to load recipients" }, 500);
    }
    if (!destinatarios?.length) {
      return jsonResponse({ received: true, sent: 0, motivo: "sem_destinatarios_pendentes" });
    }

    const userIds = [...new Set((destinatarios as DestinatarioRow[]).map((d) => d.user_id))];
    const { data: subscriptions, error: subsError } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", userIds)
      .eq("ativo", true);
    if (subsError) {
      console.error("Error loading push_subscriptions:", subsError);
      return jsonResponse({ error: "Unable to load subscriptions" }, 500);
    }

    const subsByUser = new Map<string, PushSubscriptionRow[]>();
    for (const sub of (subscriptions ?? []) as PushSubscriptionRow[]) {
      const list = subsByUser.get(sub.user_id) ?? [];
      list.push(sub);
      subsByUser.set(sub.user_id, list);
    }

    const payload = JSON.stringify({
      title: notificacao.titulo,
      body: notificacao.mensagem,
      url: notificacao.rota ?? "/",
      tipo: notificacao.tipo,
      notificationId: notificacao.id,
    });

    let sent = 0;
    let failed = 0;
    let semDispositivo = 0;

    await Promise.all(
      (destinatarios as DestinatarioRow[]).map(async (destinatario) => {
        const subs = subsByUser.get(destinatario.user_id) ?? [];
        if (!subs.length) {
          semDispositivo++;
          await supabase
            .from("notificacoes_destinatarios")
            .update({ push_status: "sem_dispositivo", push_processado_em: new Date().toISOString() })
            .eq("id", destinatario.id);
          return;
        }

        const outcomes = await Promise.all(
          subs.map(async (sub) => {
            try {
              await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload,
                { TTL: 86400 },
              );
              return { ok: true as const };
            } catch (error) {
              const statusCode = (error as { statusCode?: number })?.statusCode;
              if (statusCode === 404 || statusCode === 410) {
                // Subscription nao existe mais no push service (usuario
                // desinstalou o PWA, revogou permissao, etc.) - desativa em
                // vez de continuar tentando enviar para um endpoint morto.
                await supabase
                  .from("push_subscriptions")
                  .update({ ativo: false, ultima_falha_em: new Date().toISOString() })
                  .eq("id", sub.id);
              } else {
                await supabase
                  .from("push_subscriptions")
                  .update({
                    falhas_consecutivas: 1,
                    ultima_falha_em: new Date().toISOString(),
                  })
                  .eq("id", sub.id);
                console.error(`web-push send failed for subscription ${sub.id}:`, statusCode, error);
              }
              return { ok: false as const };
            }
          }),
        );

        const anySent = outcomes.some((o) => o.ok);
        if (anySent) {
          sent++;
          await supabase
            .from("notificacoes_destinatarios")
            .update({ push_status: "enviado", push_processado_em: new Date().toISOString() })
            .eq("id", destinatario.id);
        } else {
          failed++;
          await supabase
            .from("notificacoes_destinatarios")
            .update({
              push_status: "falhou",
              push_tentativas: destinatario.push_tentativas + 1,
              push_processado_em: new Date().toISOString(),
            })
            .eq("id", destinatario.id);
        }
      }),
    );

    return jsonResponse({ received: true, sent, failed, sem_dispositivo: semDispositivo });
  } catch (error) {
    console.error("Unexpected send-push-notification error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
