import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getActivationRedirectUrl,
  mergeActivationMetadata,
} from "../_shared/account-activation.ts";
import {
  assertCanonicalCompanyAssignment,
  assertCompanyAdminEndpointAccess,
  assertCompanyManagedTargetIsNotMaster,
  deriveCompanyForCompanyAdmin,
  validateCompanyManagedRole,
} from "../_shared/company-tenancy.ts";
import {
  describeCompanyRoleRpcError,
  reconcileCanonicalRole,
} from "../_shared/company-user-role.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function findUserByEmail(
  supabaseAdmin: Pick<ReturnType<typeof createClient<any>>, "auth">,
  email: string,
) {
  const perPage = 500;

  for (let page = 1; ; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw new Error("Erro ao buscar usuários: " + error.message);

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
    if (!authHeader) throw new Error("Não autorizado");

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user: caller },
    } = await supabaseAdmin.auth.getUser(token);
    if (!caller) throw new Error("Não autorizado");

    const [{ data: callerRoles, error: rolesError }, { data: callerProfile }] =
      await Promise.all([
        supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", caller.id),
        supabaseAdmin
          .from("profiles")
          .select("empresa_id")
          .eq("user_id", caller.id)
          .maybeSingle(),
      ]);
    if (rolesError) throw rolesError;

    assertCompanyAdminEndpointAccess(
      callerRoles?.map((item) => item.role) ?? [],
    );

    const { email, full_name, empresa_id, perfil } = await req.json();
    if (typeof email !== "string" || !email.trim()) {
      throw new Error("Email é obrigatório");
    }

    const targetEmpresaId = deriveCompanyForCompanyAdmin({
      callerEmpresaId: callerProfile?.empresa_id,
      requestedEmpresaId: empresa_id,
    });
    const targetRole = validateCompanyManagedRole(perfil);

    const { error: accessError } = await supabaseAdmin.rpc(
      "assert_actor_company_operational_access",
      {
        _actor_id: caller.id,
        _empresa_id: targetEmpresaId,
        _feature_key: null,
      },
    );
    if (accessError) {
      throw new Error(
        "A empresa não permite criar usuários no estado atual: " +
          accessError.message,
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const displayName = full_name || normalizedEmail;
    const redirectTo = getActivationRedirectUrl(Deno.env.get("APP_URL"));

    let authUser = await findUserByEmail(supabaseAdmin, normalizedEmail);
    let isNewUser = false;

    if (!authUser) {
      const { data: inviteData, error: inviteError } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
          redirectTo,
          data: {
            full_name: displayName,
            empresa_id: targetEmpresaId,
            role: targetRole,
            ...mergeActivationMetadata(null, "invite"),
          },
        });
      if (inviteError) {
        throw new Error("Erro ao enviar convite: " + inviteError.message);
      }
      authUser = inviteData.user;
      isNewUser = true;
    }

    const { data: existingProfile, error: profileLookupError } =
      await supabaseAdmin
        .from("profiles")
        .select("id, empresa_id, ativado")
        .eq("user_id", authUser.id)
        .maybeSingle();
    if (profileLookupError) throw profileLookupError;

    assertCanonicalCompanyAssignment(
      existingProfile?.empresa_id,
      targetEmpresaId,
    );

    const { data: targetRoles, error: targetRolesError } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", authUser.id);
    if (targetRolesError) throw targetRolesError;
    const previousRoles = targetRoles?.map((item) => item.role as string) ?? [];
    assertCompanyManagedTargetIsNotMaster(previousRoles);

    // Transactional single-canonical-role write. A bare upsert only inserted the
    // new (user_id, role) pair and left any previous role in place (P0-7), so a
    // re-invited member could keep an old privilege. This RPC inserts the target
    // role and deletes every other row for the user in one transaction,
    // re-checking the actor and rejecting master targets server-side.
    const { error: roleError } = await supabaseAdmin.rpc(
      "service_set_company_user_role",
      {
        _actor_id: caller.id,
        _target_user_id: authUser.id,
        _empresa_id: targetEmpresaId,
        _role: targetRole,
      },
    );
    if (roleError) {
      throw new Error(
        describeCompanyRoleRpcError(roleError.code, roleError.message).message,
      );
    }
    const roleReconciliation = reconcileCanonicalRole(previousRoles, targetRole);

    const profileValues = {
      full_name: displayName,
      email: normalizedEmail,
      empresa_id: targetEmpresaId,
    };
    const profileResult = existingProfile
      ? await supabaseAdmin
          .from("profiles")
          .update(profileValues)
          .eq("user_id", authUser.id)
      : await supabaseAdmin.from("profiles").insert({
          user_id: authUser.id,
          ...profileValues,
        });
    if (profileResult.error) {
      throw new Error("Erro ao salvar perfil: " + profileResult.error.message);
    }

    let activationEmailSent = isNewUser;
    if (!isNewUser && !existingProfile?.ativado) {
      const recoveryMetadata = mergeActivationMetadata(
        {
          ...(authUser.user_metadata ?? {}),
          full_name: displayName,
          empresa_id: targetEmpresaId,
          role: targetRole,
        },
        "recovery",
      );
      const { error: metadataError } =
        await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
          user_metadata: recoveryMetadata,
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
      if (recoveryError) {
        throw new Error("Erro ao reenviar ativação: " + recoveryError.message);
      }
      activationEmailSent = true;
    }

    await supabaseAdmin.from("system_logs").insert({
      tipo: "usuario",
      acao: isNewUser ? "usuario_convidado" : "usuario_atualizado",
      descricao: isNewUser
        ? `Convite enviado para novo usuário: ${normalizedEmail}`
        : activationEmailSent
          ? `Ativação reenviada para usuário: ${normalizedEmail}`
          : `Usuário existente atualizado: ${normalizedEmail}`,
      user_id: caller.id,
      user_name: caller.email,
      empresa_id: targetEmpresaId,
      dados: {
        target_email: normalizedEmail,
        role: targetRole,
        previous_roles: previousRoles,
        removed_roles: roleReconciliation.removed,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        isNewUser,
        activationEmailSent,
        message: activationEmailSent
          ? "Convite de uso único enviado por email"
          : "Usuário já estava ativo e foi atualizado",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
