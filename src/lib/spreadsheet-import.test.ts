import writeExcelFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";
import {
  extractChecklistLinesFromSheets,
  parseSpreadsheetArrayBuffer,
  SPREADSHEET_IMPORT_LIMITS,
} from "@/lib/spreadsheet-import-core";
import {
  isLegacyXlsFile,
  isXlsxFile,
  validateSpreadsheetFile,
} from "@/lib/spreadsheet-import";

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

describe("spreadsheet import", () => {
  it("imports rows from every sheet of a real XLSX workbook", async () => {
    const workbook = writeExcelFile([
      {
        sheet: "Áudio",
        data: [
          ["Item", "Quantidade"],
          ["Microfone sem fio", 2],
          ["Cabo XLR", 10],
          ["Item duplicado"],
        ],
      },
      {
        sheet: "Palco",
        data: [
          ["Item duplicado"],
          ["Pedestal", true],
          [null, ""],
        ],
      },
    ]);
    const arrayBuffer = toArrayBuffer(await workbook.toBuffer());

    await expect(parseSpreadsheetArrayBuffer(arrayBuffer)).resolves.toEqual([
      "Item — Quantidade",
      "Microfone sem fio — 2",
      "Cabo XLR — 10",
      "Item duplicado",
      "Pedestal — true",
    ]);
  });

  it("rejects malformed spreadsheet bytes", async () => {
    const invalidFile = new TextEncoder().encode("not an xlsx file").buffer;
    await expect(parseSpreadsheetArrayBuffer(invalidFile)).rejects.toThrow();
  });

  it("rejects legacy XLS and oversized XLSX files before parsing", () => {
    const legacyFile = new File(["legacy"], "materiais.xls", {
      type: "application/vnd.ms-excel",
    });
    const oversizedFile = new File(
      [new Uint8Array(SPREADSHEET_IMPORT_LIMITS.maxFileSizeBytes + 1)],
      "materiais.xlsx",
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    );

    expect(isLegacyXlsFile(legacyFile)).toBe(true);
    expect(isXlsxFile(legacyFile)).toBe(false);
    expect(() => validateSpreadsheetFile(legacyFile)).toThrow(/\.xls/);
    expect(() => validateSpreadsheetFile(oversizedFile)).toThrow(/5 MiB/);
  });

  it("enforces the row limit after parsing", () => {
    const rows = Array.from(
      { length: SPREADSHEET_IMPORT_LIMITS.maxRows + 1 },
      () => ["item"],
    );

    expect(() =>
      extractChecklistLinesFromSheets([{ sheet: "Excesso", data: rows }]),
    ).toThrow(/limite.*linhas/);
  });
});
