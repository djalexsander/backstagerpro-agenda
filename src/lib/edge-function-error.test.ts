import { describe, expect, it } from "vitest";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { getEdgeFunctionErrorMessage } from "./edge-function-error";

function buildHttpError(body: unknown, ok = false) {
  return new FunctionsHttpError({
    json: async () => body,
  } as unknown as Response);
}

describe("getEdgeFunctionErrorMessage", () => {
  it("extracts the real { error } message from a FunctionsHttpError body", async () => {
    const error = buildHttpError({
      error: "Este usuário já pertence a outra empresa e não pode ser vinculado automaticamente",
    });

    expect(await getEdgeFunctionErrorMessage(error)).toBe(
      "Este usuário já pertence a outra empresa e não pode ser vinculado automaticamente",
    );
  });

  it("falls back to the provided default when the body has no error field", async () => {
    const error = buildHttpError({ success: false });

    expect(await getEdgeFunctionErrorMessage(error, "erro padrão")).toBe(
      "erro padrão",
    );
  });

  it("falls back gracefully when the response body is not valid JSON", async () => {
    const error = new FunctionsHttpError({
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response);

    expect(await getEdgeFunctionErrorMessage(error, "erro padrão")).toBe(
      "erro padrão",
    );
  });

  it("uses a plain Error's message when it is not a FunctionsHttpError", async () => {
    const error = new Error("Failed to send a request to the Edge Function");

    expect(await getEdgeFunctionErrorMessage(error)).toBe(
      "Failed to send a request to the Edge Function",
    );
  });

  it("uses the generic default for unknown, non-Error values", async () => {
    expect(await getEdgeFunctionErrorMessage("boom")).toBe(
      "Erro inesperado. Tente novamente.",
    );
    expect(await getEdgeFunctionErrorMessage(null)).toBe(
      "Erro inesperado. Tente novamente.",
    );
  });
});
