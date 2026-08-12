import { beforeEach, describe, expect, it } from "vitest";
import {
  clearTerminalPrinterOverride,
  getTerminalPrinterOverride,
  hasTerminalPrinterOverride,
  saveTerminalPrinterOverride,
  type TerminalPrinterOverride,
} from "./terminal-printer-config";

function override(overrides: Partial<TerminalPrinterOverride> = {}): TerminalPrinterOverride {
  return {
    printerName: "PT-260",
    format: "50x30mm",
    widthMm: 50,
    heightMm: 30,
    orientation: "retrato",
    bobinaProfileId: null,
    ...overrides,
  };
}

describe("terminal printer override", () => {
  beforeEach(() => localStorage.clear());

  it("is null when nothing has ever been saved for this company/purpose", () => {
    expect(getTerminalPrinterOverride("company-1", "cupom")).toBeNull();
    expect(hasTerminalPrinterOverride("company-1", "cupom")).toBe(false);
  });

  it("round-trips a saved override, including a null bobina profile", () => {
    saveTerminalPrinterOverride("company-1", "etiqueta", override({ bobinaProfileId: "profile-9" }));
    expect(getTerminalPrinterOverride("company-1", "etiqueta")).toEqual(override({ bobinaProfileId: "profile-9" }));
    expect(hasTerminalPrinterOverride("company-1", "etiqueta")).toBe(true);
  });

  it("clears a saved override back to null", () => {
    saveTerminalPrinterOverride("company-1", "cupom", override());
    clearTerminalPrinterOverride("company-1", "cupom");
    expect(getTerminalPrinterOverride("company-1", "cupom")).toBeNull();
  });

  it("isolates by purpose - saving cupom never leaks into etiqueta or documento", () => {
    saveTerminalPrinterOverride("company-1", "cupom", override({ printerName: "POS-80" }));
    expect(getTerminalPrinterOverride("company-1", "etiqueta")).toBeNull();
    expect(getTerminalPrinterOverride("company-1", "documento")).toBeNull();
  });

  it("isolates by company - a master admin switching companies never inherits another company's terminal selection", () => {
    saveTerminalPrinterOverride("company-a", "cupom", override({ printerName: "POS-A" }));
    saveTerminalPrinterOverride("company-b", "cupom", override({ printerName: "POS-B" }));
    expect(getTerminalPrinterOverride("company-a", "cupom")?.printerName).toBe("POS-A");
    expect(getTerminalPrinterOverride("company-b", "cupom")?.printerName).toBe("POS-B");
    clearTerminalPrinterOverride("company-a", "cupom");
    expect(getTerminalPrinterOverride("company-a", "cupom")).toBeNull();
    expect(getTerminalPrinterOverride("company-b", "cupom")?.printerName).toBe("POS-B");
  });

  it("treats a blank/whitespace-only printer name as no override, mirroring resolveConfiguredPrinter", () => {
    saveTerminalPrinterOverride("company-1", "cupom", override({ printerName: "   " }));
    expect(getTerminalPrinterOverride("company-1", "cupom")).toBeNull();
  });

  it("degrades to null instead of throwing when the stored value is corrupted JSON", () => {
    localStorage.setItem("backstage:printer-override:company-1:cupom", "{not json");
    expect(() => getTerminalPrinterOverride("company-1", "cupom")).not.toThrow();
    expect(getTerminalPrinterOverride("company-1", "cupom")).toBeNull();
  });

  it("falls back to an in-memory store instead of throwing when localStorage itself is unavailable", () => {
    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("storage disabled");
    };
    Storage.prototype.getItem = () => {
      throw new Error("storage disabled");
    };
    try {
      expect(() => saveTerminalPrinterOverride("company-1", "cupom", override())).not.toThrow();
      expect(getTerminalPrinterOverride("company-1", "cupom")).toEqual(override());
    } finally {
      Storage.prototype.getItem = originalGetItem;
      Storage.prototype.setItem = originalSetItem;
    }
  });
});
