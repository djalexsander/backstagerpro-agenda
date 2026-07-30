import { describe, expect, it } from "vitest";
import {
  stockBalanceStatus,
  validateStockAdjustment,
  validateStockMovement,
} from "./stock-domain";
import type {
  StockAdjustmentInput,
  StockMovementInput,
} from "./stock-types";

const movement = (
  overrides: Partial<StockMovementInput> = {},
): StockMovementInput => ({
  materialId: "material-1",
  type: "entrada",
  quantity: 1,
  destinationLocationId: "location-2",
  reason: "Operação manual",
  clientUuid: "operation-1",
  ...overrides,
});

const adjustment = (
  overrides: Partial<StockAdjustmentInput> = {},
): StockAdjustmentInput => ({
  materialId: "material-1",
  locationId: "location-1",
  physicalQuantity: 1,
  reason: "Contagem física",
  justification: "Contagem física",
  clientUuid: "operation-1",
  ...overrides,
});

describe("stock movement validation", () => {
  it.each([
    ["entrada", { destinationLocationId: "location-2" }],
    ["saldo_inicial", { destinationLocationId: "location-2" }],
    ["saida", { originLocationId: "location-1" }],
    [
      "transferencia",
      {
        originLocationId: "location-1",
        destinationLocationId: "location-2",
      },
    ],
  ] as const)("accepts a valid %s", (type, locations) => {
    expect(validateStockMovement(movement({ type, ...locations }), false)).toEqual(
      {},
    );
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fraction", 1.5],
    ["NaN", Number.NaN],
  ])("rejects %s quantity", (_label, quantity) => {
    expect(
      validateStockMovement(movement({ quantity }), false).quantity,
    ).toBeTruthy();
  });

  it.each([0, 2, 3, 10])(
    "rejects individual movement quantity %s",
    (quantity) => {
      expect(
        validateStockMovement(movement({ quantity }), true).quantity,
      ).toBeTruthy();
    },
  );

  it("accepts exactly one unit for an individual material", () => {
    expect(validateStockMovement(movement({ quantity: 1 }), true)).toEqual({});
  });

  it.each([
    ["entrada", "destinationLocationId"],
    ["saldo_inicial", "destinationLocationId"],
    ["saida", "originLocationId"],
  ] as const)("requires the correct location for %s", (type, field) => {
    const result = validateStockMovement(
      movement({
        type,
        originLocationId: null,
        destinationLocationId: null,
      }),
      false,
    );
    expect(result[field]).toBeTruthy();
  });

  it("requires both locations for transfer", () => {
    const result = validateStockMovement(
      movement({
        type: "transferencia",
        originLocationId: null,
        destinationLocationId: null,
      }),
      false,
    );
    expect(result.originLocationId).toBeTruthy();
    expect(result.destinationLocationId).toBeTruthy();
  });

  it.each(["location-1", "same-location"])(
    "rejects transfer to the same location (%s)",
    (locationId) => {
      expect(
        validateStockMovement(
          movement({
            type: "transferencia",
            originLocationId: locationId,
            destinationLocationId: locationId,
          }),
          false,
        ).destinationLocationId,
      ).toMatch(/diferentes/i);
    },
  );

  it("requires a material", () => {
    expect(
      validateStockMovement(movement({ materialId: "" }), false).materialId,
    ).toBeTruthy();
  });

  it.each(["entrada", "saida"] as const)(
    "requires a reason for %s",
    (type) => {
      expect(
        validateStockMovement(
          movement({
            type,
            reason: " ",
            originLocationId: type === "saida" ? "location-1" : null,
          }),
          false,
        ).reason,
      ).toBeTruthy();
    },
  );
});

describe("stock adjustment validation", () => {
  it.each([0, 1, 25, 999])(
    "accepts nonnegative integer physical quantity %s",
    (physicalQuantity) => {
      expect(
        validateStockAdjustment(adjustment({ physicalQuantity }), false),
      ).toEqual({});
    },
  );

  it.each([-1, 1.25, Number.NaN])(
    "rejects invalid physical quantity %s",
    (physicalQuantity) => {
      expect(
        validateStockAdjustment(adjustment({ physicalQuantity }), false)
          .physicalQuantity,
      ).toBeTruthy();
    },
  );

  it.each([0, 1])("accepts individual physical quantity %s", (physicalQuantity) => {
    expect(
      validateStockAdjustment(adjustment({ physicalQuantity }), true),
    ).toEqual({});
  });

  it.each([2, 3, 10])(
    "rejects individual physical quantity %s",
    (physicalQuantity) => {
      expect(
        validateStockAdjustment(adjustment({ physicalQuantity }), true)
          .physicalQuantity,
      ).toBeTruthy();
    },
  );

  it.each([
    ["materialId", { materialId: "" }],
    ["locationId", { locationId: "" }],
    ["justification", { justification: "   " }],
    ["reason", { reason: "   " }],
  ] as const)("requires %s", (field, override) => {
    expect(validateStockAdjustment(adjustment(override), false)[field]).toBeTruthy();
  });
});

describe("stock balance status", () => {
  it.each([
    [0, 0, "sem_saldo"],
    [0, 5, "sem_saldo"],
    [1, 5, "abaixo_minimo"],
    [4, 5, "abaixo_minimo"],
    [5, 5, "abaixo_minimo"],
    [10, 5, "normal"],
  ] as const)("classifies %s/%s as %s", (quantity, minimum, expected) => {
    expect(stockBalanceStatus(quantity, minimum)).toBe(expected);
  });
});
