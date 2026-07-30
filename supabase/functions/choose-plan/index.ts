import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertPlanSelectionAdmin,
  validatePlanSelectionRequest,
} from "../_shared/plan-selection.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SelectionResult = {
  tipo: "free" | "paid";
  empresa_id: string;
  empresa_nome: string;
  plano_id?: string;
  plano_nome?: string;
  trial_expires_at?: string;
  vencimento?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Não autorizado" }, 401);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const accessToken = authHeader.slice("Bearer ".length).trim();
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(accessToken);
    if (userError || !user) {
      return jsonResponse({ error: "Não autorizado" }, 401);
    }

    const { data: roles, error: rolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    if (rolesError) throw rolesError;
    assertPlanSelectionAdmin(roles?.map((item) => item.role) ?? []);

    const selection = validatePlanSelectionRequest(await req.json());
    const { data, error: selectionError } = await supabaseAdmin.rpc(
      "choose_company_plan",
      {
        _actor_id: user.id,
        _selection_type: selection.type,
        _plan_id: selection.planId,
      },
    );
    if (selectionError) throw selectionError;

    const result = data as SelectionResult;
    if (!result?.empresa_id || result.tipo !== selection.type) {
      throw new Error("Resposta inválida ao selecionar plano");
    }

    if (result.tipo === "paid") {
      await supabaseAdmin.from("notificacoes_master").insert({
        empresa_id: result.empresa_id,
        tipo: "pagamento_pendente",
        mensagem: `${result.empresa_nome} solicitou o plano ${result.plano_nome ?? ""}. Aguardando pagamento e aprovação.`,
        dados: {
          plano_id: result.plano_id,
          plano_nome: result.plano_nome,
        },
      });
    }

    await supabaseAdmin.from("system_logs").insert({
      tipo: "plano",
      acao:
        result.tipo === "free" ? "trial_ativado" : "plano_solicitado",
      descricao:
        result.tipo === "free"
          ? "Trial de 7 dias ativado via auto cadastro"
          : `Plano ${result.plano_nome ?? ""} solicitado via auto cadastro`,
      user_id: user.id,
      user_name: user.email,
      empresa_id: result.empresa_id,
      empresa_nome: result.empresa_nome,
      dados: {
        plano_id: result.plano_id ?? null,
        trial_expires_at: result.trial_expires_at ?? null,
        vencimento: result.vencimento ?? null,
      },
    });

    return jsonResponse({ success: true, tipo: result.tipo });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao selecionar plano";
    return jsonResponse({ error: message }, 400);
  }
});
