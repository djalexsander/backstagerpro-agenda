import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getRegistrationClientIdentifier,
  getSelfRegistrationRedirectUrl,
  hashRegistrationIdentifier,
  isPendingSelfRegistration,
  selfRegistrationGenericMessage,
  validateSelfRegistrationInput,
} from "../_shared/self-registration.ts";

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

async function sendSignupConfirmation(
  supabaseUrl: string,
  email: string,
  redirectTo: string,
) {
  const publicClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  return publicClient.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: redirectTo },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido" }, 405);
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return jsonResponse({ error: "Requisição muito grande" }, 413);
  }

  try {
    const input = validateSelfRegistrationInput(await req.json());
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const rateLimitSecret = Deno.env.get("REGISTRATION_RATE_LIMIT_SECRET");
    const clientIdentifier = getRegistrationClientIdentifier(req);
    const [clientHash, emailHash] = await Promise.all([
      hashRegistrationIdentifier(`client:${clientIdentifier}`, rateLimitSecret),
      hashRegistrationIdentifier(`email:${input.email}`, rateLimitSecret),
    ]);

    const [clientLimit, emailLimit] = await Promise.all([
      supabaseAdmin.rpc("consume_self_registration_rate_limit", {
        _identifier_hash: clientHash,
        _max_requests: 5,
        _window_seconds: 3_600,
        _block_seconds: 3_600,
      }),
      supabaseAdmin.rpc("consume_self_registration_rate_limit", {
        _identifier_hash: emailHash,
        _max_requests: 3,
        _window_seconds: 3_600,
        _block_seconds: 3_600,
      }),
    ]);
    if (clientLimit.error) throw clientLimit.error;
    if (emailLimit.error) throw emailLimit.error;
    if (!clientLimit.data || !emailLimit.data) {
      return jsonResponse(
        { error: "Muitas tentativas. Aguarde antes de tentar novamente." },
        429,
      );
    }

    // Bots filling the hidden field receive the same non-enumerating response,
    // but no company or Auth user is created.
    if (input.honeypotFilled) {
      return jsonResponse({
        success: true,
        message: selfRegistrationGenericMessage,
      });
    }

    const redirectTo = getSelfRegistrationRedirectUrl(
      Deno.env.get("APP_URL"),
    );
    const { data: existingUser, error: existingUserError } =
      await supabaseAdmin
        .rpc("get_self_registration_auth_state", { _email: input.email })
        .maybeSingle();
    if (existingUserError) throw existingUserError;

    if (existingUser) {
      // Never update metadata, company assignment, password or confirmation
      // state of an account found through this public endpoint.
      if (isPendingSelfRegistration(existingUser)) {
        const { error: resendError } = await sendSignupConfirmation(
          supabaseUrl,
          input.email,
          redirectTo,
        );
        if (resendError) {
          console.error("Self-registration confirmation resend:", resendError.message);
        }
      }

      return jsonResponse({
        success: true,
        message: selfRegistrationGenericMessage,
      });
    }

    const { data: company, error: companyError } = await supabaseAdmin
      .from("empresas")
      .insert({
        nome_empresa: input.companyName,
        email: input.email,
        telefone: input.phone,
        status: "ativo",
        plano: null,
        plano_id: null,
        plano_bloqueado: false,
        precisa_escolher_plano: true,
        data_contrato: new Date().toISOString().split("T")[0],
      })
      .select("id")
      .single();
    if (companyError) throw companyError;

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: false,
        app_metadata: {
          registration_source: "self_register",
          empresa_id: company.id,
        },
        user_metadata: {
          full_name: input.responsibleName,
        },
      });

    if (authError || !authData.user) {
      await supabaseAdmin.from("empresas").delete().eq("id", company.id);

      // A concurrent request may have created the same Auth user after the
      // lookup. Keep that race indistinguishable and never update that user.
      if (
        authError &&
        (authError as { code?: string }).code === "email_exists"
      ) {
        return jsonResponse({
          success: true,
          message: selfRegistrationGenericMessage,
        });
      }
      throw authError ?? new Error("Não foi possível criar o usuário");
    }

    const userId = authData.user.id;
    const activatedAt = new Date().toISOString();
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({
        ativado: true,
        activated_at: activatedAt,
        email: input.email,
        full_name: input.responsibleName,
        empresa_id: company.id,
      })
      .eq("user_id", userId);
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      await supabaseAdmin.from("empresas").delete().eq("id", company.id);
      throw profileError;
    }

    // profiles.empresa_id is canonical. The database trigger synchronizes
    // empresa_usuarios and its role projection.
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: userId, role: "admin_empresa" },
        { onConflict: "user_id,role" },
      );
    if (roleError) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      await supabaseAdmin.from("empresas").delete().eq("id", company.id);
      throw roleError;
    }

    const { error: confirmationError } = await sendSignupConfirmation(
      supabaseUrl,
      input.email,
      redirectTo,
    );
    if (confirmationError) {
      // Preserve the pending registration so the user can safely request a
      // resend without recreating the company or changing the password.
      throw new Error(
        "Cadastro criado, mas o email de confirmação não pôde ser enviado. Tente novamente mais tarde.",
      );
    }

    await supabaseAdmin.from("notificacoes_master").insert({
      empresa_id: company.id,
      tipo: "auto_cadastro",
      mensagem: `Nova empresa aguardando confirmação: ${input.companyName} (${input.email})`,
      dados: {
        nome_empresa: input.companyName,
        nome_responsavel: input.responsibleName,
        email: input.email,
        telefone: input.phone,
      },
    });

    await supabaseAdmin.from("system_logs").insert({
      tipo: "auth",
      acao: "auto_cadastro_pendente",
      descricao: `Auto cadastro aguardando confirmação: ${input.companyName} - ${input.responsibleName} (${input.email})`,
      user_id: userId,
      user_name: input.responsibleName,
      empresa_id: company.id,
      empresa_nome: input.companyName,
    });

    return jsonResponse({
      success: true,
      message: selfRegistrationGenericMessage,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Não foi possível processar o cadastro";
    return jsonResponse({ error: message }, 400);
  }
});
