import type { CellValue, Sheet } from "read-excel-file/web-worker";

export const SPREADSHEET_IMPORT_LIMITS = {
  maxFileSizeBytes: 5 * 1024 * 1024,
  maxSheets: 20,
  maxRows: 5_000,
  maxCells: 50_000,
  maxCellTextLength: 2_000,
} as const;

function cellValueToText(value: CellValue | null): string {
  if (value === null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  const text = String(value).trim();
  if (text.length > SPREADSHEET_IMPORT_LIMITS.maxCellTextLength) {
    throw new Error(
      `A planilha contém uma célula com mais de ${SPREADSHEET_IMPORT_LIMITS.maxCellTextLength} caracteres.`,
    );
  }

  return text;
}

export function extractChecklistLinesFromSheets(sheets: Sheet[]): string[] {
  if (sheets.length > SPREADSHEET_IMPORT_LIMITS.maxSheets) {
    throw new Error(
      `A planilha excede o limite de ${SPREADSHEET_IMPORT_LIMITS.maxSheets} abas.`,
    );
  }

  const uniqueLines = new Set<string>();
  let rowCount = 0;
  let cellCount = 0;

  for (const { data } of sheets) {
    rowCount += data.length;
    if (rowCount > SPREADSHEET_IMPORT_LIMITS.maxRows) {
      throw new Error(
        `A planilha excede o limite de ${SPREADSHEET_IMPORT_LIMITS.maxRows} linhas.`,
      );
    }

    for (const row of data) {
      cellCount += row.length;
      if (cellCount > SPREADSHEET_IMPORT_LIMITS.maxCells) {
        throw new Error(
          `A planilha excede o limite de ${SPREADSHEET_IMPORT_LIMITS.maxCells} células.`,
        );
      }

      const text = row
        .map(cellValueToText)
        .filter((cell) => cell.length > 0)
        .join(" — ");

      if (text.length > 2) uniqueLines.add(text);
    }
  }

  return [...uniqueLines];
}

export async function parseSpreadsheetArrayBuffer(arrayBuffer: ArrayBuffer): Promise<string[]> {
  const { default: readExcelFile } = await import("read-excel-file/web-worker");
  const sheets = await readExcelFile(arrayBuffer);
  return extractChecklistLinesFromSheets(sheets);
}
