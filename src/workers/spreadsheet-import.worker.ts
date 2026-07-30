import { parseSpreadsheetArrayBuffer } from "@/lib/spreadsheet-import-core";

interface SpreadsheetWorkerScope {
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null;
  postMessage(message: { ok: true; lines: string[] } | { ok: false; error: string }): void;
}

const workerScope = self as unknown as SpreadsheetWorkerScope;

workerScope.onmessage = async (event) => {
  try {
    const lines = await parseSpreadsheetArrayBuffer(event.data);
    workerScope.postMessage({ ok: true, lines });
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "Não foi possível processar a planilha.",
    });
  }
};
