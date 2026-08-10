import { FunctionsHttpError } from "@supabase/supabase-js";

const DEFAULT_FALLBACK = "Erro inesperado. Tente novamente.";

/**
 * supabase-js throws a FunctionsHttpError whose .message is always the
 * generic "Edge Function returned a non-2xx status code" - the actual
 * { error: "..." } body the function returned is only reachable via
 * error.context (the raw Response), read once here with .json(). Never
 * surface anything else from the response (headers, token, stack) to the
 * caller - only the "error" string field, if present.
 */
export async function getEdgeFunctionErrorMessage(
  error: unknown,
  fallback: string = DEFAULT_FALLBACK,
): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    // error.message here is always the generic "Edge Function returned a
    // non-2xx status code" - it is never useful, so every path below either
    // returns the real body message or the caller's fallback, never it.
    try {
      const body: unknown = await error.context.json();
      if (
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof (body as { error: unknown }).error === "string"
      ) {
        return (body as { error: string }).error;
      }
    } catch {
      // Response body was not JSON, or already consumed.
    }
    return fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
