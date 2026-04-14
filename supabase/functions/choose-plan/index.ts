import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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

    const { tipo, plano_id } = await req.json();

    if (tipo === "free") {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 7);

      await supabaseAdmin
        .from("empresas")
        .update({
          plano: "Teste Free 7 dias",
          plano_id: null,
          trial_expires_at: trialEnd.toISOString(),
          vencimento: trialEnd.toISOString(),
          precisa_escolher_plano: false,
          plano_bloqueado: false,
          status: "ativo",
          status_pagamento: null,
        })
        .eq("id", profile.empresa_id);

      await supabaseAdmin.from("system_logs").insert({
        tipo: "plano",
        acao: "trial_ativado",
        descricao: `Trial de 7 dias ativado via auto cadastro`,
        user_id: user.id,
        empresa_id: profile.empresa_id,
      });

      return new Response(JSON.stringify({ success: true, tipo: "free" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (tipo === "paid" && plano_id) {
      // Get plano info
      const { data: plano } = await supabaseAdmin
        .from("planos")
        .select("nome, periodicidade")
        .eq("id", plano_id)
        .single();

      // Calculate vencimento based on periodicidade
      const now = new Date();
      let vencimento: string | null = null;
      if (plano?.periodicidade === "mensal") {
        const v = new Date(now);
        v.setDate(v.getDate() + 30);
        vencimento = v.toISOString();
      } else if (plano?.periodicidade === "anual") {
        const v = new Date(now);
        v.setFullYear(v.getFullYear() + 1);
        vencimento = v.toISOString();
      }
      // vitalicio = null (sem vencimento)

      await supabaseAdmin
        .from("empresas")
        .update({
          precisa_escolher_plano: false,
          plano_bloqueado: true,
          status_pagamento: "pendente",
          plano: plano?.nome || null,
          plano_id: plano_id,
          trial_expires_at: null,
          data_contrato: now.toISOString(),
          vencimento: vencimento,
        })
        .eq("id", profile.empresa_id);

      // Deactivate any trial modules when subscribing to a paid plan
      await supabaseAdmin.rpc("deactivate_trial_modules", {
        _empresa_id: profile.empresa_id,
      });

      // Notify master
      const { data: empresa } = await supabaseAdmin
        .from("empresas")
        .select("nome_empresa")
        .eq("id", profile.empresa_id)
        .single();

      await supabaseAdmin.from("notificacoes_master").insert({
        empresa_id: profile.empresa_id,
        tipo: "pagamento_pendente",
        mensagem: `${empresa?.nome_empresa} solicitou o plano ${plano?.nome || ""}. Aguardando pagamento e aprovação.`,
        dados: { plano_id, plano_nome: plano?.nome },
      });

      await supabaseAdmin.from("system_logs").insert({
        tipo: "plano",
        acao: "plano_solicitado",
        descricao: `Plano ${plano?.nome} solicitado via auto cadastro`,
        user_id: user.id,
        empresa_id: profile.empresa_id,
        empresa_nome: empresa?.nome_empresa,
      });

      return new Response(JSON.stringify({ success: true, tipo: "paid" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Tipo inválido. Use 'free' ou 'paid'.");
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
