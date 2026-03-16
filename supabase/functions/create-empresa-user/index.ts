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

    // Verify caller is master_admin
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await supabaseAdmin.auth.getUser(token);
    if (!caller) throw new Error("Não autorizado");

    const { data: roleCheck } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "master_admin")
      .single();
    if (!roleCheck) throw new Error("Acesso negado: apenas master admin");

    const { empresa_id, email, password, full_name, role } = await req.json();

    if (!email || !password || !empresa_id) {
      throw new Error("Email, senha e empresa são obrigatórios");
    }

    // Try to create auth user; if already exists, link to empresa
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: full_name || email,
        empresa_id,
        role: role || "usuario",
      },
    });

    if (createError) {
      // If user already exists, find them and link to the new empresa
      if (createError.message?.includes("already been registered")) {
        const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
        if (listErr) throw listErr;
        const existingUser = users.find((u: any) => u.email === email);
        if (!existingUser) throw new Error("Usuário não encontrado");

        // Update profile to link to new empresa
        const { error: profileErr } = await supabaseAdmin
          .from("profiles")
          .update({ empresa_id, full_name: full_name || email })
          .eq("user_id", existingUser.id);
        if (profileErr) throw profileErr;

        // Upsert role
        const { error: roleErr } = await supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: existingUser.id, role: role || "usuario" }, { onConflict: "user_id,role" });
        if (roleErr) throw roleErr;

        return new Response(JSON.stringify({ user: existingUser, linked: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw createError;
    }

    return new Response(JSON.stringify({ user: newUser.user }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
