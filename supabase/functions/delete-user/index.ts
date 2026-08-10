import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, jsonCorsResponse } from "../_shared/cors.ts";
import {
  isMissingAuthUserError,
  validateUserRemovalRequest,
} from "../_shared/user-removal.ts";

const corsHeaders = buildCorsHeaders();

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return jsonCorsResponse(body, status, {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Serviço indisponível" }, 503);
    }

    const authHeader = req.headers.get("Authorization");
    const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
    if (!bearerMatch) {
      return jsonResponse({ error: "Não autorizado" }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user: caller },
      error: callerError,
    } = await adminClient.auth.getUser(bearerMatch[1]);
    if (callerError || !caller) {
      return jsonResponse({ error: "Não autorizado" }, 401);
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return jsonResponse({ error: "Corpo JSON inválido" }, 400);
    }
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return jsonResponse({ error: "Corpo JSON inválido" }, 400);
    }

    let removalRequest;
    try {
      removalRequest = validateUserRemovalRequest(
        rawBody as Record<string, unknown>,
      );
    } catch (error) {
      return jsonResponse({
        error: error instanceof Error ? error.message : "Solicitação inválida",
      }, 400);
    }

    const { data: unlinkData, error: unlinkError } = await adminClient.rpc(
      "detach_company_user",
      {
        _actor_id: caller.id,
        _target_user_id: removalRequest.userId,
        _empresa_id: removalRequest.empresaId,
      },
    );

    if (unlinkError) {
      console.error("Company user detach failed:", {
        code: unlinkError.code,
        message: unlinkError.message,
      });
      const status =
        unlinkError.code === "42501"
          ? 403
          : unlinkError.code === "22023"
            ? 400
            : 500;
      return jsonResponse({
        error:
          status === 403
            ? "Sem permissão para remover este vínculo"
            : status === 400
              ? unlinkError.message
              : "Não foi possível remover o vínculo",
      }, status);
    }

    if (!unlinkData || typeof unlinkData !== "object" || Array.isArray(unlinkData)) {
      throw new Error("Resposta inválida da remoção de vínculo");
    }

    const result = unlinkData as Record<string, unknown>;
    const auditId = result.audit_id;
    const shouldDeleteAuth = result.should_delete_auth === true;
    if (typeof auditId !== "string") {
      throw new Error("Auditoria da remoção não foi criada");
    }

    if (!shouldDeleteAuth) {
      return jsonResponse({
        success: true,
        action: "company_unlinked",
        auth_user_deleted: false,
        remaining_links: result.remaining_links,
        audit_id: auditId,
      });
    }

    const { error: authDeleteError } =
      await adminClient.auth.admin.deleteUser(removalRequest.userId);
    const authDeleted =
      !authDeleteError || isMissingAuthUserError(authDeleteError.message);

    const { error: finalizeError } = await adminClient.rpc(
      "finalize_user_auth_deletion",
      {
        _audit_id: auditId,
        _success: authDeleted,
        _error: authDeleteError?.message ?? null,
      },
    );

    if (finalizeError) {
      console.error("Unable to finalize user Auth deletion audit:", finalizeError);
      return jsonResponse({
        error: "Exclusão processada, mas a auditoria precisa ser retomada",
        retryable: true,
        audit_id: auditId,
      }, 500);
    }

    if (!authDeleted) {
      console.error("Supabase Auth user deletion failed:", authDeleteError);
      return jsonResponse({
        error: "Vínculo removido; exclusão da identidade Auth pendente",
        retryable: true,
        audit_id: auditId,
      }, 500);
    }

    return jsonResponse({
      success: true,
      action: "auth_user_deleted",
      auth_user_deleted: true,
      remaining_links: 0,
      audit_id: auditId,
    });
  } catch (error) {
    console.error("delete-user error:", error);
    return jsonResponse({ error: "Erro interno ao remover usuário" }, 500);
  }
});
