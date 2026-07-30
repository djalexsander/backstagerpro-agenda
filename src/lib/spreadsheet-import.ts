import { SPREADSHEET_IMPORT_LIMITS } from "@/lib/spreadsheet-import-core";

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SPREADSHEET_PARSE_TIMEOUT_MS = 15_000;

interface SpreadsheetWorkerSuccess {
  ok: true;
  lines: string[];
}

interface SpreadsheetWorkerFailure {
  ok: false;
  error: string;
}

type SpreadsheetWorkerResponse = SpreadsheetWorkerSuccess | SpreadsheetWorkerFailure;
type SpreadsheetFileMetadata = Pick<File, "name" | "size" | "type">;

export function isLegacyXlsFile(file: Pick<File, "name">): boolean {
  return file.name.toLowerCase().endsWith(".xls");
}

export function isXlsxFile(file: Pick<File, "name" | "type">): boolean {
  return (
    file.name.toLowerCase().endsWith(".xlsx") ||
    file.type.toLowerCase() === XLSX_MIME_TYPE
  );
}

export function validateSpreadsheetFile(file: SpreadsheetFileMetadata): void {
  if (isLegacyXlsFile(file)) {
    throw new Error(
      "O formato legado .xls não é aceito por segurança. Abra o arquivo no Excel ou LibreOffice e salve como .xlsx.",
    );
  }

  if (!isXlsxFile(file)) {
    throw new Error("Selecione uma planilha no formato .xlsx.");
  }

  if (file.size === 0) {
    throw new Error("A planilha está vazia.");
  }

  if (file.size > SPREADSHEET_IMPORT_LIMITS.maxFileSizeBytes) {
    throw new Error("A planilha excede o limite de 5 MiB.");
  }
}

function hasZipSignature(arrayBuffer: ArrayBuffer): boolean {
  if (arrayBuffer.byteLength < 4) return false;
  const bytes = new Uint8Array(arrayBuffer, 0, 4);
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function parseInWorker(arrayBuffer: ArrayBuffer): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/spreadsheet-import.worker.ts", import.meta.url),
      { type: "module" },
    );

    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("A leitura da planilha excedeu o tempo limite de 15 segundos."));
    }, SPREADSHEET_PARSE_TIMEOUT_MS);

    const finish = () => {
      window.clearTimeout(timeout);
      worker.terminate();
    };

    worker.onmessage = (event: MessageEvent<SpreadsheetWorkerResponse>) => {
      finish();
      const response = event.data;
      if (response.ok === true) {
        resolve(response.lines);
      } else {
        reject(new Error(response.error));
      }
    };

    worker.onerror = () => {
      finish();
      reject(new Error("Não foi possível processar a planilha."));
    };

    worker.postMessage(arrayBuffer, [arrayBuffer]);
  });
}

export async function extractChecklistLinesFromSpreadsheet(file: File): Promise<string[]> {
  validateSpreadsheetFile(file);

  const arrayBuffer = await file.arrayBuffer();
  if (!hasZipSignature(arrayBuffer)) {
    throw new Error("O arquivo não contém uma planilha .xlsx válida.");
  }

  return parseInWorker(arrayBuffer);
}
