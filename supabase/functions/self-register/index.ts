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

    const { nome_empresa, email, telefone, password } = await req.json();

    if (!nome_empresa?.trim()) throw new Error("Nome da empresa é obrigatório");
    if (!email?.trim()) throw new Error("Email é obrigatório");
    if (!password || password.length < 6) throw new Error("A senha deve ter pelo menos 6 caracteres");

    const normalizedEmail = email.trim().toLowerCase();

    // Check if email already exists
    let existingUser = null;
    let page = 1;
    const perPage = 500;
    while (true) {
      const { data: { users: batch }, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      existingUser = batch.find((u: any) => u.email === normalizedEmail);
      if (existingUser || batch.length < perPage) break;
      page++;
    }

    if (existingUser) {
      throw new Error("Este email já está cadastrado no sistema. Faça login ou use 'Primeiro acesso'.");
    }

    // Create empresa
    const { data: empresa, error: empresaErr } = await supabaseAdmin
      .from("empresas")
      .insert({
        nome_empresa: nome_empresa.trim(),
        email: normalizedEmail,
        telefone: telefone?.trim() || null,
        status: "ativo",
        plano: null,
        plano_id: null,
        plano_bloqueado: false,
        precisa_escolher_plano: true,
        data_contrato: new Date().toISOString().split("T")[0],
      })
      .select("id")
      .single();
    if (empresaErr) throw empresaErr;

    // Create auth user (auto-confirmed)
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: nome_empresa.trim(),
        empresa_id: empresa.id,
        role: "admin_empresa",
      },
    });
    if (authErr) {
      // Cleanup empresa if user creation fails
      await supabaseAdmin.from("empresas").delete().eq("id", empresa.id);
      throw authErr;
    }

    // Mark profile as activated
    await supabaseAdmin
      .from("profiles")
      .update({ ativado: true, email: normalizedEmail })
      .eq("user_id", authData.user.id);

    // Create empresa_usuarios entry
    await supabaseAdmin.from("empresa_usuarios").insert({
      empresa_id: empresa.id,
      user_id: authData.user.id,
      perfil: "admin",
    });

    // Notify master admin
    await supabaseAdmin.from("notificacoes_master").insert({
      empresa_id: empresa.id,
      tipo: "auto_cadastro",
      mensagem: `Nova empresa auto-cadastrada: ${nome_empresa.trim()} (${normalizedEmail})`,
      dados: { nome_empresa: nome_empresa.trim(), email: normalizedEmail, telefone: telefone?.trim() || null },
    });

    // Log
    await supabaseAdmin.from("system_logs").insert({
      tipo: "auth",
      acao: "auto_cadastro",
      descricao: `Auto cadastro: ${nome_empresa.trim()} (${normalizedEmail})`,
      user_id: authData.user.id,
      user_name: nome_empresa.trim(),
      empresa_id: empresa.id,
      empresa_nome: nome_empresa.trim(),
    });

    return new Response(JSON.stringify({ success: true, empresa_id: empresa.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
