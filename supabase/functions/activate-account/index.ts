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

    const { email, password } = await req.json();

    if (!email || !password) {
      throw new Error("Email e senha são obrigatórios");
    }

    if (password.length < 6) {
      throw new Error("A senha deve ter pelo menos 6 caracteres");
    }

    // Find user by email using filter (avoids pagination issues with listUsers)
    const normalizedEmail = email.trim().toLowerCase();
    const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      perPage: 1,
      page: 1,
    });

    // listUsers doesn't support email filter, so we search manually with pagination
    let user = null;
    let page = 1;
    const perPage = 500;
    while (!user) {
      const { data: { users: batch }, error: batchErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (batchErr) throw batchErr;
      if (batch.length === 0) break;
      user = batch.find((u: any) => u.email === normalizedEmail);
      if (batch.length < perPage) break;
      page++;
    }

    if (!user) {
      throw new Error("Email não encontrado no sistema. Verifique com o administrador.");
    }

    // Check if profile is already activated
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("ativado")
      .eq("user_id", user.id)
      .single();

    if (profileErr) throw new Error("Perfil não encontrado");

    if (profile.ativado) {
      throw new Error("Esta conta já foi ativada. Faça login normalmente.");
    }

    // Update password via admin API (user never sees the temporary password)
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password,
    });
    if (updateErr) throw updateErr;

    // Mark profile as activated
    const { error: activateErr } = await supabaseAdmin
      .from("profiles")
      .update({ ativado: true })
      .eq("user_id", user.id);
    if (activateErr) throw activateErr;

    // Log activation
    await supabaseAdmin.from("system_logs").insert({
      tipo: "auth",
      acao: "conta_ativada",
      descricao: `Conta ativada pelo primeiro acesso: ${email}`,
      user_id: user.id,
      user_name: email,
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
