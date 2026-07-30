import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertBillingAdmin,
  toTrustedCurrencyAmount,
  validateBillingChargeRequest,
} from "../_shared/billing-charge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ASAAS_API_URL = "https://api.asaas.com/v3";

type PreparedCharge = {
  payment_id: string;
  payment_type: "base_plan" | "modules";
  amount: number | string;
  due_date: string;
  empresa_id: string;
  empresa_nome: string;
  empresa_email: string | null;
  resource_id: string;
  resource_name: string;
  related_batch_request_id: string | null;
  related_plano_id: string | null;
  related_module_id: string | null;
};

type SupabaseAdmin = ReturnType<typeof createClient>;

class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

async function readAsaasResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

async function cancelPreparedCharge(
  supabaseAdmin: SupabaseAdmin,
  prepared: PreparedCharge,
  reason: string,
): Promise<void> {
  const { error: paymentError } = await supabaseAdmin
    .from("asaas_payments")
    .update({
      status: "cancelled",
      metadata: {
        phase: "cancelled",
        cancel_reason: reason,
        resource_id: prepared.resource_id,
      },
    })
    .eq("id", prepared.payment_id)
    .eq("status", "pending");

  if (paymentError) {
    console.error("Failed to cancel internal Asaas reservation:", paymentError);
  }

  if (prepared.related_batch_request_id) {
    const { error: batchError } = await supabaseAdmin
      .from("module_batch_requests")
      .update({ status: "cancelled" })
      .eq("id", prepared.related_batch_request_id)
      .eq("status", "pending");

    if (batchError) {
      console.error("Failed to cancel Asaas module batch:", batchError);
    }
  }
}

async function cancelAsaasPayment(
  asaasApiKey: string,
  asaasPaymentId: string,
): Promise<void> {
  try {
    const response = await fetch(
      `${ASAAS_API_URL}/payments/${encodeURIComponent(asaasPaymentId)}`,
      {
        method: "DELETE",
        headers: { access_token: asaasApiKey },
      },
    );

    if (!response.ok) {
      console.error(
        "Failed to cancel orphaned Asaas payment:",
        response.status,
        await response.text(),
      );
    }
  } catch (error) {
    console.error("Failed to request cancellation of orphaned Asaas payment:", error);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método não permitido" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let prepared: PreparedCharge | null = null;
  let supabaseAdmin: SupabaseAdmin | null = null;

  try {
    const asaasApiKey = Deno.env.get("ASAAS_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!asaasApiKey || !supabaseUrl || !serviceRoleKey) {
      throw new Error("Configuração segura de cobrança indisponível");
    }

    const authHeader = req.headers.get("Authorization");
    const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
    if (!bearerMatch) {
      throw new RequestError("Não autorizado", 401);
    }

    supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(bearerMatch[1]);
    if (userError || !user) {
      throw new RequestError("Não autorizado", 401);
    }

    const { data: roleRows, error: roleError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (roleError) {
      throw new Error(`Não foi possível validar a autorização: ${roleError.message}`);
    }

    try {
      assertBillingAdmin((roleRows ?? []).map((row) => row.role));
    } catch (error) {
      throw new RequestError(
        error instanceof Error ? error.message : "Acesso negado",
        403,
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      throw new RequestError("Corpo JSON inválido");
    }
    if (
      !rawBody ||
      typeof rawBody !== "object" ||
      Array.isArray(rawBody)
    ) {
      throw new RequestError("Corpo JSON inválido");
    }

    let chargeRequest;
    try {
      chargeRequest = validateBillingChargeRequest(
        rawBody as Record<string, unknown>,
      );
    } catch (error) {
      throw new RequestError(
        error instanceof Error ? error.message : "Cobrança inválida",
      );
    }

    const { data: preparation, error: preparationError } =
      await supabaseAdmin.rpc("prepare_asaas_charge", {
        _actor_id: user.id,
        _plan_id:
          chargeRequest.kind === "base_plan"
            ? chargeRequest.resourceId
            : null,
        _module_id:
          chargeRequest.kind === "modules"
            ? chargeRequest.resourceId
            : null,
      });

    if (preparationError || !preparation) {
      console.error("Asaas charge preparation failed:", preparationError);
      throw new RequestError(
        preparationError?.message ?? "Não foi possível preparar a cobrança",
        409,
      );
    }

    prepared = preparation as unknown as PreparedCharge;
    const amount = toTrustedCurrencyAmount(prepared.amount);
    const customerEmail = prepared.empresa_email || user.email;
    if (!customerEmail) {
      throw new RequestError("A empresa não possui e-mail para cobrança", 422);
    }

    const customerExternalReference = `backstage_pro:${prepared.empresa_id}`;
    const searchResponse = await fetch(
      `${ASAAS_API_URL}/customers?externalReference=${
        encodeURIComponent(customerExternalReference)
      }`,
      { headers: { access_token: asaasApiKey } },
    );
    const searchData = await readAsaasResponse(searchResponse);
    if (!searchResponse.ok) {
      console.error("Asaas customer search failed:", searchResponse.status, searchData);
      throw new Error("Falha ao consultar o cliente no provedor de cobrança");
    }

    const existingCustomers = Array.isArray(searchData.data)
      ? searchData.data as Array<Record<string, unknown>>
      : [];
    let asaasCustomerId =
      typeof existingCustomers[0]?.id === "string"
        ? existingCustomers[0].id
        : null;

    if (!asaasCustomerId) {
      const createCustomerResponse = await fetch(`${ASAAS_API_URL}/customers`, {
        method: "POST",
        headers: {
          access_token: asaasApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `[Backstage Pro] ${prepared.empresa_nome}`,
          email: customerEmail,
          externalReference: customerExternalReference,
        }),
      });
      const customerData = await readAsaasResponse(createCustomerResponse);
      if (!createCustomerResponse.ok || typeof customerData.id !== "string") {
        console.error(
          "Asaas customer creation failed:",
          createCustomerResponse.status,
          customerData,
        );
        throw new Error("Falha ao criar o cliente no provedor de cobrança");
      }
      asaasCustomerId = customerData.id;
    }

    const resourceLabel =
      prepared.payment_type === "base_plan" ? "Plano" : "Módulo";
    const description =
      `[Backstage Pro] ${resourceLabel} ${prepared.resource_name} - ${prepared.empresa_nome}`;

    const chargeResponse = await fetch(`${ASAAS_API_URL}/payments`, {
      method: "POST",
      headers: {
        access_token: asaasApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer: asaasCustomerId,
        billingType: "PIX",
        value: amount,
        dueDate: prepared.due_date,
        description,
        externalReference: `backstage_pro:${prepared.payment_id}`,
      }),
    });
    const chargeData = await readAsaasResponse(chargeResponse);
    if (!chargeResponse.ok || typeof chargeData.id !== "string") {
      console.error("Asaas PIX creation failed:", chargeResponse.status, chargeData);
      throw new Error("Falha ao criar a cobrança no provedor");
    }

    const asaasPaymentId = chargeData.id;
    let pixQrCode: string | null = null;
    let pixCopyPaste: string | null = null;

    const pixResponse = await fetch(
      `${ASAAS_API_URL}/payments/${encodeURIComponent(asaasPaymentId)}/pixQrCode`,
      { headers: { access_token: asaasApiKey } },
    );
    if (pixResponse.ok) {
      const pixData = await readAsaasResponse(pixResponse);
      pixQrCode =
        typeof pixData.encodedImage === "string" ? pixData.encodedImage : null;
      pixCopyPaste =
        typeof pixData.payload === "string" ? pixData.payload : null;
    } else {
      console.error(
        "Asaas PIX QR retrieval failed:",
        pixResponse.status,
        await pixResponse.text(),
      );
    }

    const invoiceUrl =
      typeof chargeData.invoiceUrl === "string" ? chargeData.invoiceUrl : null;
    const { data: payment, error: updateError } = await supabaseAdmin
      .from("asaas_payments")
      .update({
        asaas_payment_id: asaasPaymentId,
        asaas_customer_id: asaasCustomerId,
        pix_qr_code: pixQrCode,
        pix_copy_paste: pixCopyPaste,
        invoice_url: invoiceUrl,
        metadata: {
          phase: "created",
          resource_id: prepared.resource_id,
          resource_name: prepared.resource_name,
          prepared_by: user.id,
        },
      })
      .eq("id", prepared.payment_id)
      .eq("empresa_id", prepared.empresa_id)
      .eq("status", "pending")
      .is("asaas_payment_id", null)
      .select("id")
      .maybeSingle();

    if (updateError || !payment) {
      console.error("Failed to persist Asaas payment:", updateError);
      await cancelAsaasPayment(asaasApiKey, asaasPaymentId);
      throw new Error("Falha ao vincular a cobrança ao registro interno");
    }

    const { error: logError } = await supabaseAdmin.from("system_logs").insert({
      tipo: "pagamento",
      acao: "asaas_cobranca_pix_criada",
      descricao:
        `Cobrança PIX Asaas criada: R$ ${amount.toFixed(2)} (${prepared.payment_type}) para ${prepared.empresa_nome}`,
      empresa_id: prepared.empresa_id,
      empresa_nome: prepared.empresa_nome,
      user_id: user.id,
    });
    if (logError) {
      console.error("Failed to write Asaas charge log:", logError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        payment_id: prepared.payment_id,
        asaas_payment_id: asaasPaymentId,
        resource_id: prepared.resource_id,
        amount,
        pix_qr_code: pixQrCode,
        pix_copy_paste: pixCopyPaste,
        invoice_url: invoiceUrl,
        billing_type: "PIX",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    if (prepared && supabaseAdmin) {
      await cancelPreparedCharge(
        supabaseAdmin,
        prepared,
        error instanceof Error ? error.message.slice(0, 200) : "unknown_error",
      );
    }

    console.error("create-asaas-charge error:", error);
    const status = error instanceof RequestError ? error.status : 500;
    const message =
      error instanceof RequestError
        ? error.message
        : "Não foi possível criar a cobrança";
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
