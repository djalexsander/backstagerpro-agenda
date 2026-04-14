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

    const { nome_empresa, nome_responsavel, email, telefone, password } = await req.json();

    if (!nome_empresa?.trim()) throw new Error("Nome da empresa é obrigatório");
    if (!email?.trim()) throw new Error("Email é obrigatório");
    if (!password || password.length < 6) throw new Error("A senha deve ter pelo menos 6 caracteres");

    const normalizedEmail = email.trim().toLowerCase();
    const displayName = nome_responsavel?.trim() || nome_empresa.trim();

    // Check if email already exists in auth
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

    let userId: string;

    if (existingUser) {
      // Check if user is linked to any active empresa
      const { data: activeLinks } = await supabaseAdmin
        .from("empresa_usuarios")
        .select("empresa_id")
        .eq("user_id", existingUser.id);

      if (activeLinks && activeLinks.length > 0) {
        // Check if any of those empresas still exist
        const empresaIds = activeLinks.map((l: any) => l.empresa_id);
        const { data: existingEmpresas } = await supabaseAdmin
          .from("empresas")
          .select("id")
          .in("id", empresaIds);

        if (existingEmpresas && existingEmpresas.length > 0) {
          throw new Error("Este email já está cadastrado no sistema. Faça login ou use 'Primeiro acesso'.");
        }

        // Clean up orphaned empresa_usuarios links
        await supabaseAdmin
          .from("empresa_usuarios")
          .delete()
          .eq("user_id", existingUser.id);
      }

      // Orphaned user — update password and metadata, reuse account
      await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
        password,
        email_confirm: true,
        user_metadata: {
          full_name: displayName,
          role: "admin_empresa",
        },
      });

      userId = existingUser.id;

      // Clean up orphaned roles and profile
      await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
      await supabaseAdmin.from("profiles").delete().eq("user_id", userId);
    } else {
      userId = ""; // will be set after creation
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

    if (!existingUser) {
      // Create new auth user
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: displayName,
          empresa_id: empresa.id,
          role: "admin_empresa",
        },
      });
      if (authErr) {
        await supabaseAdmin.from("empresas").delete().eq("id", empresa.id);
        throw authErr;
      }
      userId = authData.user.id;
    } else {
      // Update metadata with new empresa_id
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          full_name: displayName,
          empresa_id: empresa.id,
          role: "admin_empresa",
        },
      });

      // Recreate profile and role for reused user
      await supabaseAdmin.from("profiles").insert({
        user_id: userId,
        full_name: displayName,
        email: normalizedEmail,
        empresa_id: empresa.id,
        ativado: true,
      });

      await supabaseAdmin.from("user_roles").insert({
        user_id: userId,
        role: "admin_empresa",
      });
    }

    // Mark profile as activated (for new users created by trigger)
    if (!existingUser) {
      await supabaseAdmin
        .from("profiles")
        .update({ ativado: true, email: normalizedEmail, full_name: displayName })
        .eq("user_id", userId);
    }

    // Create empresa_usuarios entry
    await supabaseAdmin.from("empresa_usuarios").insert({
      empresa_id: empresa.id,
      user_id: userId,
      perfil: "admin",
    });

    // Notify master admin
    await supabaseAdmin.from("notificacoes_master").insert({
      empresa_id: empresa.id,
      tipo: "auto_cadastro",
      mensagem: `Nova empresa auto-cadastrada: ${nome_empresa.trim()} (${normalizedEmail})`,
      dados: { nome_empresa: nome_empresa.trim(), nome_responsavel: displayName, email: normalizedEmail, telefone: telefone?.trim() || null },
    });

    // Log
    await supabaseAdmin.from("system_logs").insert({
      tipo: "auth",
      acao: "auto_cadastro",
      descricao: `Auto cadastro: ${nome_empresa.trim()} - ${displayName} (${normalizedEmail})`,
      user_id: userId,
      user_name: displayName,
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
