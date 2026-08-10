import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, jsonCorsResponse } from "../_shared/cors.ts";
import {
  getActivationRedirectUrl,
  mergeActivationMetadata,
} from "../_shared/account-activation.ts";

const corsHeaders = buildCorsHeaders();
const genericMessage =
  "Se a conta estiver pendente, um link de ativação será enviado para o email informado.";

async function findUserByEmail(
  supabaseAdmin: ReturnType<typeof createClient>,
  email: string,
) {
  const perPage = 500;

  for (let page = 1; ; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;

    const user = data.users.find((candidate) => candidate.email === email);
    if (user || data.users.length < perPage) return user ?? null;
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

  try {
    const { email } = await req.json();
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";

    // Keep the public response identical to prevent account enumeration.
    if (!normalizedEmail) {
      return jsonCorsResponse({ success: true, message: genericMessage });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const user = await findUserByEmail(supabaseAdmin, normalizedEmail);

    if (user) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("ativado")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profile && !profile.ativado) {
        const lastRequestedAt = Date.parse(
          String(user.user_metadata?.account_activation_requested_at ?? ""),
        );
        const canSend =
          !Number.isFinite(lastRequestedAt) ||
          Date.now() - lastRequestedAt >= 60_000;

        if (canSend) {
          await supabaseAdmin.auth.admin.updateUserById(user.id, {
            user_metadata: mergeActivationMetadata(
              user.user_metadata,
              "recovery",
            ),
          });

          const publicClient = createClient(
            supabaseUrl,
            Deno.env.get("SUPABASE_ANON_KEY")!,
          );
          const redirectTo = getActivationRedirectUrl(Deno.env.get("APP_URL"));
          const { error: resetError } =
            await publicClient.auth.resetPasswordForEmail(normalizedEmail, {
              redirectTo,
            });
          if (resetError) console.error("Activation email error:", resetError.message);
        }
      }
    }
  } catch (error) {
    // Public activation requests must not reveal whether the email exists,
    // whether it is active, or whether the email provider rejected the send.
    console.error(
      "Account activation request failed:",
      error instanceof Error ? error.message : error,
    );
  }

  return new Response(
    JSON.stringify({ success: true, message: genericMessage }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
