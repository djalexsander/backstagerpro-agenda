import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Não autorizado");
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
        const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
        if (listErr) throw new Error("Erro ao buscar usuários: " + listErr.message);
        
        const existingUser = listData.users.find((u: any) => u.email === normalizedEmail);
        if (!existingUser) throw new Error("Usuário não encontrado no sistema de autenticação");
        
        userId = existingUser.id;
        isNewUser = false;
      } else {
        throw new Error("Erro ao criar usuário: " + createError.message);
      }
    } else {
      userId = newUser.user!.id;
      isNewUser = true;
    }

    // Check if link already exists
    const { data: existingLink } = await supabaseAdmin
      .from("empresa_usuarios")
      .select("id")
      .eq("empresa_id", empresa_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingLink) {
      return new Response(
        JSON.stringify({
          success: true,
          isNewUser: false,
          message: "Usuário já vinculado a esta empresa",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Link user to empresa
    const { error: linkError } = await supabaseAdmin
      .from("empresa_usuarios")
      .insert({ empresa_id, user_id: userId, perfil: perfil || "usuario" });
    if (linkError) throw new Error("Erro ao vincular usuário: " + linkError.message);

    // Ensure user_roles entry exists
    await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: userId, role: perfil || "usuario" },
        { onConflict: "user_id,role" }
      );

    // Always ensure profile exists with name and email
    // Wait a moment for the trigger to potentially create the profile
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingProfile) {
      await supabaseAdmin
        .from("profiles")
        .update({ 
          full_name: full_name || normalizedEmail, 
          email: normalizedEmail,
          empresa_id: empresa_id 
        } as any)
        .eq("user_id", userId);
    } else {
      await supabaseAdmin
        .from("profiles")
        .insert({ 
          user_id: userId, 
          full_name: full_name || normalizedEmail, 
          email: normalizedEmail,
          empresa_id 
        } as any);
    }

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
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Erro desconhecido" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
