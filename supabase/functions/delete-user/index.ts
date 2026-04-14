import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: caller },
    } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .single();

    if (
      !callerRole ||
      !["master_admin", "admin_empresa"].includes(callerRole.role)
    ) {
      return new Response(
        JSON.stringify({ error: "Sem permissão para excluir usuários" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "user_id é obrigatório" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (user_id === caller.id) {
      return new Response(
        JSON.stringify({ error: "Você não pode excluir a si mesmo" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (callerRole.role === "admin_empresa") {
      const { data: callerProfile } = await adminClient
        .from("profiles")
        .select("empresa_id")
        .eq("user_id", caller.id)
        .single();

      const { data: targetLink } = await adminClient
        .from("empresa_usuarios")
        .select("empresa_id")
        .eq("user_id", user_id)
        .eq("empresa_id", callerProfile?.empresa_id || "")
        .maybeSingle();

      if (!callerProfile?.empresa_id || !targetLink) {
        return new Response(
          JSON.stringify({
            error: "Sem permissão para excluir este usuário",
          }),
          {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // Delete from empresa_usuarios, user_roles, profiles (ignore errors if not found)
    await adminClient.from("empresa_usuarios").delete().eq("user_id", user_id);
    await adminClient.from("user_roles").delete().eq("user_id", user_id);
    await adminClient.from("profiles").delete().eq("user_id", user_id);

    // Delete from auth (ignore "User not found" — may already be deleted)
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(
      user_id
    );
    if (deleteError && !deleteError.message?.includes("User not found")) {
      throw deleteError;
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
