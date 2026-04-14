import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ASAAS_API_URL = "https://api.asaas.com/v3";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const ASAAS_API_KEY = Deno.env.get("ASAAS_API_KEY");
    if (!ASAAS_API_KEY) throw new Error("ASAAS_API_KEY não configurada");

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Não autorizado");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) throw new Error("Não autorizado");

    // Get user's empresa
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("empresa_id")
      .eq("user_id", user.id)
      .single();
    if (!profile?.empresa_id) throw new Error("Empresa não encontrada");

    const { data: empresa } = await supabaseAdmin
      .from("empresas")
      .select("nome_empresa, email")
      .eq("id", profile.empresa_id)
      .single();

    const body = await req.json();
    const { payment_type, amount, description, related_batch_request_id, related_plano_id, due_date } = body;

    if (!payment_type || !amount) {
      throw new Error("payment_type e amount são obrigatórios");
    }
    if (!["base_plan", "modules"].includes(payment_type)) {
      throw new Error("payment_type inválido");
    }

    // 1. Find or create Asaas customer
    const customerName = empresa?.nome_empresa || "Cliente Backstage Pro";
    const customerEmail = empresa?.email || user.email;

    // Search existing customer by email
    const searchRes = await fetch(`${ASAAS_API_URL}/customers?email=${encodeURIComponent(customerEmail!)}`, {
      headers: { "access_token": ASAAS_API_KEY },
    });
    const searchData = await searchRes.json();

    let asaasCustomerId: string;
    if (searchData.data && searchData.data.length > 0) {
      asaasCustomerId = searchData.data[0].id;
    } else {
      // Create customer
      const createRes = await fetch(`${ASAAS_API_URL}/customers`, {
        method: "POST",
        headers: {
          "access_token": ASAAS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: customerName,
          email: customerEmail,
          externalReference: `backstage_pro:${profile.empresa_id}`,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(`Erro ao criar cliente Asaas: ${JSON.stringify(createData)}`);
      }
      asaasCustomerId = createData.id;
    }

    // 2. Create PIX charge
    const dueDate = due_date || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const chargeRes = await fetch(`${ASAAS_API_URL}/payments`, {
      method: "POST",
      headers: {
        "access_token": ASAAS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customer: asaasCustomerId,
        billingType: "PIX",
        value: Number(amount),
        dueDate,
        description: description || `Backstage Pro - ${payment_type === "base_plan" ? "Plano Base" : "Módulos Adicionais"}`,
        externalReference: JSON.stringify({
          source_app: "backstage_pro",
          empresa_id: profile.empresa_id,
          payment_type,
          related_batch_request_id: related_batch_request_id || null,
          related_plano_id: related_plano_id || null,
        }),
      }),
    });
    const chargeData = await chargeRes.json();
    if (!chargeRes.ok) {
      throw new Error(`Erro ao criar cobrança Asaas: ${JSON.stringify(chargeData)}`);
    }

    // 3. Get PIX QR Code
    let pixQrCode = null;
    let pixCopyPaste = null;
    if (chargeData.id) {
      const pixRes = await fetch(`${ASAAS_API_URL}/payments/${chargeData.id}/pixQrCode`, {
        headers: { "access_token": ASAAS_API_KEY },
      });
      if (pixRes.ok) {
        const pixData = await pixRes.json();
        pixQrCode = pixData.encodedImage;
        pixCopyPaste = pixData.payload;
      }
    }

    // 4. Save to asaas_payments table
    const { data: payment, error: insertErr } = await supabaseAdmin
      .from("asaas_payments")
      .insert({
        source_app: "backstage_pro",
        payment_type,
        asaas_payment_id: chargeData.id,
        asaas_customer_id: asaasCustomerId,
        empresa_id: profile.empresa_id,
        amount: Number(amount),
        status: "pending",
        payment_method: "pix",
        pix_qr_code: pixQrCode,
        pix_copy_paste: pixCopyPaste,
        invoice_url: chargeData.invoiceUrl || null,
        due_date: dueDate,
        related_batch_request_id: related_batch_request_id || null,
        related_plano_id: related_plano_id || null,
      })
      .select()
      .single();

    if (insertErr) throw new Error(`Erro ao salvar pagamento: ${insertErr.message}`);

    // 5. Log
    await supabaseAdmin.from("system_logs").insert({
      tipo: "pagamento",
      acao: "asaas_cobranca_criada",
      descricao: `Cobrança Asaas criada: R$ ${Number(amount).toFixed(2)} (${payment_type}) para ${empresa?.nome_empresa}`,
      empresa_id: profile.empresa_id,
      empresa_nome: empresa?.nome_empresa,
      user_id: user.id,
    });

    return new Response(JSON.stringify({
      success: true,
      payment_id: payment.id,
      asaas_payment_id: chargeData.id,
      pix_qr_code: pixQrCode,
      pix_copy_paste: pixCopyPaste,
      invoice_url: chargeData.invoiceUrl,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("create-asaas-charge error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
