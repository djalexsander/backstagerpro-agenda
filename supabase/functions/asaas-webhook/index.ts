import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  authorizeAsaasWebhook,
  parseAsaasWebhook,
} from "../_shared/asaas-webhook.ts";

const responseHeaders = {
  "Content-Type": "application/json",
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authorization = authorizeAsaasWebhook(
    Deno.env.get("ASAAS_WEBHOOK_TOKEN"),
    req.headers.get("asaas-access-token"),
  );
  if (authorization === "misconfigured") {
    console.error("ASAAS_WEBHOOK_TOKEN is missing or shorter than 32 characters");
    return jsonResponse({ error: "Webhook unavailable" }, 503);
  }
  if (authorization === "unauthorized") {
    console.error("Invalid Asaas webhook token received");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Supabase service configuration is missing");
      return jsonResponse({ error: "Webhook unavailable" }, 503);
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON payload" }, 400);
    }

    let webhook;
    try {
      webhook = parseAsaasWebhook(rawBody);
    } catch (error) {
      console.error("Invalid Asaas webhook payload:", error);
      return jsonResponse({ error: "Invalid webhook payload" }, 400);
    }

    if (webhook.action === "ignored") {
      console.log("Asaas webhook event ignored:", { event: webhook.event });
      return jsonResponse({ received: true, action: "ignored" });
    }

    console.log("Processing Asaas webhook:", {
      event_id: webhook.eventId,
      event: webhook.event,
      payment_id: webhook.paymentId,
    });

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabaseAdmin.rpc(
      "process_asaas_payment_webhook",
      {
        _event_id: webhook.eventId,
        _event_type: webhook.event,
        _asaas_payment_id: webhook.paymentId,
        _provider_amount: webhook.amount,
        _external_reference: webhook.externalReference,
        _event_created_at: webhook.eventCreatedAt,
      },
    );

    if (error) {
      console.error("Transactional Asaas webhook processing failed:", {
        code: error.code,
        message: error.message,
        details: error.details,
      });

      if (error.code === "22023") {
        return jsonResponse({ error: "Invalid payment confirmation" }, 400);
      }
      if (error.message.includes("BACKSTAGE_PAYMENT_MAPPING_PENDING")) {
        return jsonResponse({ error: "Payment mapping is not ready" }, 503);
      }

      // Returning 5xx asks Asaas to retry. The database transaction has
      // rolled back, so a later delivery can safely resume the activation.
      return jsonResponse({ error: "Payment processing failed" }, 500);
    }

    const result =
      data && typeof data === "object" && !Array.isArray(data)
        ? data as Record<string, unknown>
        : { action: "processed" };

    return jsonResponse({
      received: true,
      ...result,
    });
  } catch (error) {
    console.error("Unexpected Asaas webhook error:", error);
    return jsonResponse({ error: "Payment processing failed" }, 500);
  }
});
