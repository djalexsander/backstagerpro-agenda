import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getActivationRedirectUrl,
  mergeActivationMetadata,
} from "../_shared/account-activation.ts";
import {
  assertCanonicalCompanyAssignment,
  normalizeCompanyRole,
} from "../_shared/company-tenancy.ts";
import { describeCompanyRoleRpcError } from "../_shared/company-user-role.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Não autorizado");

    const token = authHeader.replace("Bearer ", "").trim();
    const {
      data: { user: caller },
    } = await supabaseAdmin.auth.getUser(token);
    if (!caller) throw new Error("Não autorizado");

    const { data: callerRoles, error: roleCheckError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id);
    if (roleCheckError) throw roleCheckError;
    if (!callerRoles?.some((item) => item.role === "master_admin")) {
      throw new Error("Acesso negado: apenas master admin");
    }

    const { empresa_id, email, full_name, role } = await req.json();
    if (!email || !empresa_id) {
      throw new Error("Email e empresa são obrigatórios");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const displayName = full_name || normalizedEmail;
    const targetRole = normalizeCompanyRole(role);
    const redirectTo = getActivationRedirectUrl(Deno.env.get("APP_URL"));
    let authUser = await findUserByEmail(supabaseAdmin, normalizedEmail);
    let isNewUser = false;

    if (!authUser) {
      const { data: inviteData, error: inviteError } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
          redirectTo,
          data: {
            full_name: displayName,
            empresa_id,
            role: targetRole,
            ...mergeActivationMetadata(null, "invite"),
          },
        });
      if (inviteError) throw inviteError;
      authUser = inviteData.user;
      isNewUser = true;
    }

    const { data: profile, error: profileLookupError } = await supabaseAdmin
      .from("profiles")
      .select("id, empresa_id, ativado")
      .eq("user_id", authUser.id)
      .maybeSingle();
    if (profileLookupError) throw profileLookupError;

    assertCanonicalCompanyAssignment(profile?.empresa_id, empresa_id);

    // Transactional single-canonical-role write (P0-7). Replaces a bare upsert
    // that left a previous role in place when an existing user was re-linked
    // with a different one. The RPC reconciles user_roles to exactly one row
    // and rejects master targets / non-company roles server-side.
    const { error: roleError } = await supabaseAdmin.rpc(
      "service_set_company_user_role",
      {
        _actor_id: caller.id,
        _target_user_id: authUser.id,
        _empresa_id: empresa_id,
        _role: targetRole,
      },
    );
    if (roleError) {
      throw new Error(
        describeCompanyRoleRpcError(roleError.code, roleError.message).message,
      );
    }

    const profileValues = {
      full_name: displayName,
      email: normalizedEmail,
      empresa_id,
    };
    const profileResult = profile
      ? await supabaseAdmin
          .from("profiles")
          .update(profileValues)
          .eq("user_id", authUser.id)
      : await supabaseAdmin.from("profiles").insert({
          user_id: authUser.id,
          ...profileValues,
        });
    if (profileResult.error) throw profileResult.error;

    let activationEmailSent = isNewUser;
    if (!isNewUser && !profile?.ativado) {
      const { error: metadataError } =
        await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
          user_metadata: mergeActivationMetadata(
            {
              ...(authUser.user_metadata ?? {}),
              full_name: displayName,
              empresa_id,
              role: targetRole,
            },
            "recovery",
          ),
        });
      if (metadataError) throw metadataError;

      const publicClient = createClient(
        supabaseUrl,
        Deno.env.get("SUPABASE_ANON_KEY")!,
      );
      const { error: recoveryError } =
        await publicClient.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo,
        });
      if (recoveryError) throw recoveryError;
      activationEmailSent = true;
    }

    return new Response(
      JSON.stringify({
        user: authUser,
        linked: !isNewUser,
        activationEmailSent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
