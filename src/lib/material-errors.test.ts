import { describe, expect, it } from "vitest";
import {
  MATERIAL_UNIQUE_CONSTRAINT_MESSAGES,
  translateMaterialPersistenceError,
} from "./material-errors";

const fallbackMessage = "Não foi possível salvar. Tente novamente.";

describe("material persistence error translation", () => {
  it.each(
    Object.entries(MATERIAL_UNIQUE_CONSTRAINT_MESSAGES).map(
      ([constraint, message]) => ({ constraint, message }),
    ),
  )("translates PostgreSQL 23505 for $constraint", ({ constraint, message }) => {
    const technicalError = {
      code: "23505",
      details: "Key already exists.",
      message: `duplicate key value violates unique constraint "${constraint}"`,
    };

    const translated = translateMaterialPersistenceError(
      technicalError,
      fallbackMessage,
    );

    expect(translated.message).toBe(message);
    expect(translated.handled).toBe(true);
    expect(translated.originalError).toBe(technicalError);
    expect(translated.message).not.toContain(constraint);
  });

  it("uses the explicit constraint field when Supabase provides it", () => {
    const translated = translateMaterialPersistenceError(
      {
        code: "23505",
        constraint: "materiais_empresa_codigo_uidx",
        message: "duplicate key value",
      },
      fallbackMessage,
    );

    expect(translated.message).toBe(
      "Já existe um material com este código interno nesta empresa.",
    );
    expect(translated.handled).toBe(true);
  });

  it("uses a safe fallback for unknown database errors", () => {
    const technicalMessage =
      'duplicate key value violates unique constraint "constraint_desconhecida"';
    const translated = translateMaterialPersistenceError(
      { code: "23505", message: technicalMessage },
      fallbackMessage,
    );

    expect(translated.message).toBe(fallbackMessage);
    expect(translated.message).not.toContain(technicalMessage);
    expect(translated.handled).toBe(false);
  });

  it("does not translate a constraint without PostgreSQL code 23505", () => {
    const translated = translateMaterialPersistenceError(
      {
        code: "42501",
        message:
          'permission denied: materiais_empresa_codigo_uidx duplicate key value',
      },
      fallbackMessage,
    );

    expect(translated.message).toBe(fallbackMessage);
    expect(translated.handled).toBe(false);
  });
});
