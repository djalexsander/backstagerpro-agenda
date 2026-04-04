import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    const today = now.toISOString().split("T")[0];

    // Fetch companies with vencimento in the next 7 days (not blocked, not vitalicio)
    const { data: empresas, error: empError } = await supabase
      .from("empresas")
      .select("id, nome_empresa, email, vencimento, plano, plano_id, plano_bloqueado, status_pagamento")
      .eq("plano_bloqueado", false)
      .not("vencimento", "is", null);

    if (empError) {
      console.error("Error fetching empresas:", empError);
      return new Response(JSON.stringify({ error: empError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Also check plans to exclude vitalicio
    const { data: planos } = await supabase
      .from("planos")
      .select("id, periodicidade");

    const vitalicioIds = new Set(
      (planos || [])
        .filter((p: any) => p.periodicidade === "vitalicio")
        .map((p: any) => p.id)
    );

    const results: { empresa: string; dias: number; tipo: string }[] = [];

    for (const empresa of empresas || []) {
      // Skip vitalicio plans
      if (empresa.plano_id && vitalicioIds.has(empresa.plano_id)) continue;
      // Skip already paid
      if (empresa.status_pagamento === "pago") continue;

      const vencimento = new Date(empresa.vencimento);
      const diffMs = vencimento.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      // Notify at 7, 5, 3, 1, 0 days before, and when overdue
      if (diffDays > 7) continue;

      let tipo = "";
      let mensagemMaster = "";
      let mensagemEmpresa = "";

      if (diffDays < 0) {
        tipo = "vencimento_expirado";
        mensagemMaster = `⚠️ Empresa "${empresa.nome_empresa}" está com o plano VENCIDO há ${Math.abs(diffDays)} dia(s).`;
        mensagemEmpresa = `Seu plano está vencido há ${Math.abs(diffDays)} dia(s). Regularize para evitar o bloqueio.`;
      } else if (diffDays === 0) {
        tipo = "vencimento_hoje";
        mensagemMaster = `🔔 Empresa "${empresa.nome_empresa}" vence HOJE.`;
        mensagemEmpresa = `Seu plano vence HOJE! Realize o pagamento para evitar bloqueio.`;
      } else {
        tipo = "vencimento_proximo";
        mensagemMaster = `📅 Empresa "${empresa.nome_empresa}" vence em ${diffDays} dia(s).`;
        mensagemEmpresa = `Seu plano vence em ${diffDays} dia(s). Realize o pagamento para manter o acesso.`;
      }

      // Check if we already notified today for this company
      const notifKey = `venc-${empresa.id}-${today}`;
      const { data: existing } = await supabase
        .from("notificacoes_master")
        .select("id")
        .eq("empresa_id", empresa.id)
        .eq("tipo", tipo)
        .gte("created_at", `${today}T00:00:00`)
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`Already notified ${empresa.nome_empresa} today for ${tipo}`);
        continue;
      }

      // Create master notification
      const { error: notifError } = await supabase
        .from("notificacoes_master")
        .insert({
          empresa_id: empresa.id,
          tipo,
          mensagem: mensagemMaster,
          dados: {
            dias_restantes: diffDays,
            vencimento: empresa.vencimento,
            plano: empresa.plano,
            email_empresa: empresa.email,
          },
        });

      if (notifError) {
        console.error(`Error creating notification for ${empresa.nome_empresa}:`, notifError);
      } else {
        results.push({
          empresa: empresa.nome_empresa,
          dias: diffDays,
          tipo,
        });
        console.log(`Notification created for ${empresa.nome_empresa} - ${tipo} (${diffDays} days)`);
      }
    }

    // Also check trial expiration for companies WITHOUT a plan
    const { data: trialEmpresas } = await supabase
      .from("empresas")
      .select("id, nome_empresa, email, trial_expires_at, plano_id, plano_bloqueado")
      .eq("plano_bloqueado", false)
      .is("plano_id", null)
      .not("trial_expires_at", "is", null);

    for (const empresa of trialEmpresas || []) {
      const trialEnd = new Date(empresa.trial_expires_at);
      const diffMs = trialEnd.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays > 5) continue;

      const tipo = diffDays < 0 ? "trial_expirado" : "trial_expirando";
      const mensagem = diffDays < 0
        ? `⚠️ Trial da empresa "${empresa.nome_empresa}" expirou há ${Math.abs(diffDays)} dia(s).`
        : `📅 Trial da empresa "${empresa.nome_empresa}" expira em ${diffDays} dia(s).`;

      const { data: existing } = await supabase
        .from("notificacoes_master")
        .select("id")
        .eq("empresa_id", empresa.id)
        .eq("tipo", tipo)
        .gte("created_at", `${today}T00:00:00`)
        .limit(1);

      if (existing && existing.length > 0) continue;

      await supabase.from("notificacoes_master").insert({
        empresa_id: empresa.id,
        tipo,
        mensagem,
        dados: {
          dias_restantes: diffDays,
          trial_expires_at: empresa.trial_expires_at,
          email_empresa: empresa.email,
        },
      });

      results.push({ empresa: empresa.nome_empresa, dias: diffDays, tipo });
    }

    console.log(`Check completed. ${results.length} notifications created.`);

    return new Response(
      JSON.stringify({ success: true, notificacoes_criadas: results.length, detalhes: results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
