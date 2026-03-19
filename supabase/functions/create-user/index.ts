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

    // Verify caller is admin_empresa or master_admin
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await supabaseAdmin.auth.getUser(token);
    if (!caller) throw new Error("Não autorizado");

    const { data: callerRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id);

    const isMaster = callerRoles?.some((r: any) => r.role === "master_admin");
    const isAdmin = callerRoles?.some((r: any) => r.role === "admin_empresa");
    if (!isMaster && !isAdmin) throw new Error("Acesso negado");

    const { email, full_name, empresa_id, perfil } = await req.json();

    if (!email || !empresa_id) {
      throw new Error("Email e empresa são obrigatórios");
    }

    const normalizedEmail = email.trim().toLowerCase();
    let userId: string;
    let isNewUser = false;

    // Try to create user in Auth
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      email_confirm: true,
      user_metadata: {
        full_name: full_name || normalizedEmail,
        empresa_id,
        role: perfil || "usuario",
      },
    });

    if (createError) {
      if (createError.message?.includes("already been registered")) {
        // User already exists - find them
        const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
        if (listErr) throw listErr;
        const existingUser = users.find((u: any) => u.email === normalizedEmail);
        if (!existingUser) throw new Error("Usuário não encontrado");
        userId = existingUser.id;
        isNewUser = false;
      } else {
        throw createError;
      }
    } else {
      userId = newUser.user!.id;
      isNewUser = true;
    }

    // Link user to empresa via empresa_usuarios
    const { error: linkError } = await supabaseAdmin
      .from("empresa_usuarios")
      .upsert(
        { empresa_id, user_id: userId, perfil: perfil || "usuario" },
        { onConflict: "empresa_id,user_id" }
      );
    if (linkError) throw linkError;

    // Also update profiles.empresa_id if not set (for backward compat)
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("empresa_id")
      .eq("user_id", userId)
      .single();

    if (profile && !profile.empresa_id) {
      await supabaseAdmin
        .from("profiles")
        .update({ empresa_id, full_name: full_name || normalizedEmail })
        .eq("user_id", userId);
    }

    // Ensure user_roles entry exists
    await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: userId, role: perfil || "usuario" },
        { onConflict: "user_id,role" }
      );

    // Log
    await supabaseAdmin.from("system_logs").insert({
      tipo: "usuario",
      acao: isNewUser ? "usuario_criado" : "usuario_vinculado",
      descricao: isNewUser
        ? `Novo usuário criado: ${normalizedEmail}`
        : `Usuário existente vinculado à empresa: ${normalizedEmail}`,
      user_id: caller.id,
      user_name: caller.email,
      empresa_id,
    });

    return new Response(
      JSON.stringify({
        success: true,
        isNewUser,
        message: isNewUser
          ? "Usuário criado com sucesso"
          : "Usuário já existia e foi vinculado à empresa",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
