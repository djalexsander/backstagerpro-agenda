import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Validate webhook token
  const webhookToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
  if (webhookToken) {
    const receivedToken = req.headers.get("asaas-access-token") || 
                          new URL(req.url).searchParams.get("token");
    if (receivedToken !== webhookToken) {
      console.error("Invalid webhook token received");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    console.log("Asaas webhook received:", JSON.stringify(body));

    const { event, payment: asaasPayment } = body;

    // Only process payment confirmation events
    const confirmEvents = ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"];
    if (!confirmEvents.includes(event)) {
      console.log(`Event ${event} ignored (not a confirmation)`);
      return new Response(JSON.stringify({ received: true, action: "ignored" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const asaasPaymentId = asaasPayment?.id;
    if (!asaasPaymentId) {
      throw new Error("Payment ID ausente no webhook");
    }

    // Find our internal payment record
    const { data: internalPayment, error: findErr } = await supabaseAdmin
      .from("asaas_payments")
      .select("*")
      .eq("asaas_payment_id", asaasPaymentId)
      .maybeSingle();

    if (findErr) throw new Error(`Erro ao buscar pagamento: ${findErr.message}`);

    if (!internalPayment) {
      // Not a Backstage Pro payment — ignore silently
      console.log(`Payment ${asaasPaymentId} not found in backstage_pro — ignoring`);
      return new Response(JSON.stringify({ received: true, action: "not_backstage_pro" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify source_app
    if (internalPayment.source_app !== "backstage_pro") {
      console.log(`Payment ${asaasPaymentId} belongs to ${internalPayment.source_app} — ignoring`);
      return new Response(JSON.stringify({ received: true, action: "wrong_app" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Already processed?
    if (internalPayment.status === "confirmed" || internalPayment.status === "received") {
      console.log(`Payment ${asaasPaymentId} already processed`);
      return new Response(JSON.stringify({ received: true, action: "already_processed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const newStatus = event === "PAYMENT_CONFIRMED" ? "confirmed" : "received";

    // Update payment status
    await supabaseAdmin
      .from("asaas_payments")
      .update({
        status: newStatus,
        payment_confirmed_at: now,
      })
      .eq("id", internalPayment.id);

    // Get empresa info
    const { data: empresa } = await supabaseAdmin
      .from("empresas")
      .select("nome_empresa, plano_id, vencimento")
      .eq("id", internalPayment.empresa_id)
      .single();

    // --- ACTIVATION LOGIC ---
    if (internalPayment.payment_type === "base_plan") {
      // Activate base plan
      const planoId = internalPayment.related_plano_id;
      if (planoId) {
        const { data: plano } = await supabaseAdmin
          .from("planos")
          .select("nome, periodicidade")
          .eq("id", planoId)
          .single();

        // Calculate new expiration
        const nowDate = new Date();
        let vencimento: string | null = null;
        if (plano?.periodicidade === "mensal") {
          const v = new Date(nowDate);
          v.setDate(v.getDate() + 30);
          vencimento = v.toISOString();
        } else if (plano?.periodicidade === "anual") {
          const v = new Date(nowDate);
          v.setFullYear(v.getFullYear() + 1);
          vencimento = v.toISOString();
        }

        await supabaseAdmin
          .from("empresas")
          .update({
            plano_bloqueado: false,
            status_pagamento: "pago",
            status: "ativo",
            plano: plano?.nome || null,
            plano_id: planoId,
            vencimento,
            data_contrato: nowDate.toISOString(),
            precisa_escolher_plano: false,
          })
          .eq("id", internalPayment.empresa_id);

        await supabaseAdmin.from("system_logs").insert({
          tipo: "pagamento",
          acao: "asaas_plano_ativado",
          descricao: `Plano ${plano?.nome} ativado via pagamento Asaas para ${empresa?.nome_empresa}`,
          empresa_id: internalPayment.empresa_id,
          empresa_nome: empresa?.nome_empresa,
        });
      }
    } else if (internalPayment.payment_type === "modules") {
      // Activate batch modules
      const batchId = internalPayment.related_batch_request_id;
      if (batchId) {
        // Get batch items
        const { data: batchItems } = await supabaseAdmin
          .from("module_batch_request_items")
          .select("module_id, valor")
          .eq("batch_request_id", batchId);

        // Use empresa's current vencimento for module expires_at
        const expiresAt = empresa?.vencimento || null;

        if (batchItems && batchItems.length > 0) {
          for (const item of batchItems) {
            // Check if module already exists
            const { data: existing } = await supabaseAdmin
              .from("empresa_modules")
              .select("id, status")
              .eq("empresa_id", internalPayment.empresa_id)
              .eq("module_id", item.module_id)
              .maybeSingle();

            if (existing) {
              if (existing.status !== "active") {
                await supabaseAdmin
                  .from("empresa_modules")
                  .update({
                    status: "active",
                    activated_at: now,
                    valor_cobrado: item.valor,
                    origem: "asaas_pagamento",
                    granted_by_admin: false,
                    expires_at: expiresAt,
                  })
                  .eq("id", existing.id);
              }
            } else {
              await supabaseAdmin.from("empresa_modules").insert({
                empresa_id: internalPayment.empresa_id,
                module_id: item.module_id,
                status: "active",
                activated_at: now,
                valor_cobrado: item.valor,
                origem: "asaas_pagamento",
                granted_by_admin: false,
                expires_at: expiresAt,
              });
            }
          }

          // Update batch request status
          await supabaseAdmin
            .from("module_batch_requests")
            .update({ status: "approved", approved_at: now })
            .eq("id", batchId);
        }

        await supabaseAdmin.from("system_logs").insert({
          tipo: "pagamento",
          acao: "asaas_modulos_ativados",
          descricao: `${batchItems?.length || 0} módulos ativados via pagamento Asaas para ${empresa?.nome_empresa}`,
          empresa_id: internalPayment.empresa_id,
          empresa_nome: empresa?.nome_empresa,
        });
      }
    }

    // Notify master
    await supabaseAdmin.from("notificacoes_master").insert({
      empresa_id: internalPayment.empresa_id,
      tipo: "pagamento_confirmado",
      mensagem: `Pagamento Asaas confirmado: R$ ${Number(internalPayment.amount).toFixed(2)} (${internalPayment.payment_type}) - ${empresa?.nome_empresa}`,
      dados: {
        asaas_payment_id: asaasPaymentId,
        payment_type: internalPayment.payment_type,
        amount: internalPayment.amount,
      },
    });

    return new Response(JSON.stringify({ received: true, action: "activated" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("asaas-webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
