import { describe, expect, it } from "vitest";
import {
  STOCK_ERROR_MESSAGES,
  STOCK_UNIQUE_CONSTRAINT_MESSAGES,
  translateStockError,
} from "./stock-errors";

describe("translateStockError", () => {
  it.each(Object.entries(STOCK_ERROR_MESSAGES))(
    "traduz o código %s",
    (code, message) => {
      const result = translateStockError({
        code,
        message: "internal database detail",
      });
      expect(result.message).toBe(message);
      expect(result.handled).toBe(true);
      expect(result.message).not.toMatch(/internal|constraint/i);
    },
  );

  it.each(Object.entries(STOCK_UNIQUE_CONSTRAINT_MESSAGES))(
    "traduz a constraint %s",
    (constraint, message) => {
      const result = translateStockError({
        code: "23505",
        message: `duplicate key violates unique constraint "${constraint}"`,
      });
      expect(result.message).toBe(message);
      expect(result.handled).toBe(true);
    },
  );

  it("usa fallback seguro para erros desconhecidos", () => {
    const result = translateStockError({
      code: "XX999",
      message: 'relation "private_table" failed',
    });
    expect(result.handled).toBe(false);
    expect(result.message).not.toContain("private_table");
  });
});
