import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, jsonCorsResponse } from "../_shared/cors.ts";
import {
  accessTokenHasOtpAuthenticationMethod,
  normalizeActivationFlow,
  validateActivationPassword,
} from "../_shared/account-activation.ts";

const corsHeaders = buildCorsHeaders();

function jsonResponse(body: unknown, status = 200) {
  return jsonCorsResponse(body, status, {});
}

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
      return jsonResponse({ error: "Link inválido ou expirado" }, 401);
    }

    const accessToken = authHeader.slice("Bearer ".length).trim();
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // getUser validates the access token with Supabase Auth. JWT claims are
    // inspected only after this server-side validation.
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(accessToken);
    if (userError || !user) {
      return jsonResponse({ error: "Link inválido ou expirado" }, 401);
    }
    const { password: rawPassword, flow_type: rawFlow } = await req.json();
    const password = validateActivationPassword(rawPassword);
    const flow = normalizeActivationFlow(rawFlow);
    const expectedFlow = normalizeActivationFlow(
      user.user_metadata?.account_activation_flow,
    );

    if (
      !flow ||
      !expectedFlow ||
      flow !== expectedFlow ||
      !accessTokenHasOtpAuthenticationMethod(accessToken)
    ) {
      return jsonResponse({ error: "Convite ou recuperação inválidos" }, 401);
    }

    const { data: consumedAt, error: consumeError } = await supabaseAdmin.rpc(
      "consume_account_activation",
      { _user_id: user.id },
    );
    if (consumeError) throw consumeError;
    if (!consumedAt) {
      return jsonResponse(
        { error: "Este link já foi utilizado ou a conta já está ativada" },
        409,
      );
    }

    const { error: passwordError } =
      await supabaseAdmin.auth.admin.updateUserById(user.id, { password });
    if (passwordError) {
      // Release only the claim consumed by this request. A concurrent or later
      // successful activation cannot be reverted by this compensation.
      await supabaseAdmin
        .from("profiles")
        .update({ ativado: false, activated_at: null })
        .eq("user_id", user.id)
        .eq("activated_at", consumedAt);
      throw passwordError;
    }

    const cleanMetadata = { ...(user.user_metadata ?? {}) };
    delete cleanMetadata.account_activation_flow;
    delete cleanMetadata.account_activation_requested_at;
    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: cleanMetadata,
    });

    await supabaseAdmin.from("system_logs").insert({
      tipo: "auth",
      acao: "conta_ativada",
      descricao: `Conta ativada por ${flow} com OTP validado`,
      user_id: user.id,
      user_name: user.email,
    });

    return jsonResponse({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return jsonResponse({ error: message }, 400);
  }
});
