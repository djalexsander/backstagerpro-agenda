// ============================================================================
// CONFIGURAÇÃO LOCAL DE READER RFID POR TERMINAL
// ============================================================================
//
// Mesma decisão já tomada para impressoras (ver terminal-printer-config.ts):
// qual reader físico está ligado a ESTA máquina é um fato sobre o terminal,
// não algo compartilhado entre a empresa toda. Dois terminais na mesma
// empresa podem apontar para dois readers UHF diferentes (ex.: portal fixo
// na doca vs leitor de bancada), e salvar em um não pode alterar o outro.
//
// localStorage dá esse isolamento de graça: dois terminais são, por
// construção, dois perfis de navegador/WebView2 diferentes. Sem tabela de
// registro de terminais, sem migration, sem round-trip ao servidor para
// ler/gravar.
//
// Nenhum segredo/credencial é armazenado aqui por enquanto (nem senha, nem
// token, nem chave de API): esta etapa só cobre reader de rede/USB/serial
// sem autenticação. Se um reader real exigir credencial no futuro, isso
// precisa de uma decisão de segurança própria (ex.: Tauri secure storage em
// vez de localStorage) antes de virar um campo aqui.

export type RfidConnectionType = "rede" | "usb" | "serial";

export interface TerminalRfidReaderConfig {
  readerLabel: string;
  connectionType: RfidConnectionType;
  host: string | null;
  port: number | null;
  serialPort: string | null;
  enabledAntennas: number[];
}

const OVERRIDE_KEY_PREFIX = "backstage:rfid-reader-override";

// Fallback em memória para quando o próprio localStorage está indisponível
// (navegação privada com storage desabilitado, WebView2 restrito por
// política) - mesma forma de try/catch-and-degrade de terminal-printer-config.ts.
const memoryFallback = new Map<string, string>();

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memoryFallback.set(key, value);
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    memoryFallback.delete(key);
  }
}

function overrideKey(companyId: string): string {
  return `${OVERRIDE_KEY_PREFIX}:${companyId}`;
}

/** Null quando este terminal nunca salvou uma configuração própria (instalação nova, ou limpa explicitamente). */
export function getTerminalRfidReaderConfig(companyId: string): TerminalRfidReaderConfig | null {
  const raw = readStorage(overrideKey(companyId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TerminalRfidReaderConfig> | null;
    if (!parsed || !parsed.readerLabel || !parsed.readerLabel.trim()) return null;
    return {
      readerLabel: parsed.readerLabel,
      connectionType:
        parsed.connectionType === "usb" || parsed.connectionType === "serial"
          ? parsed.connectionType
          : "rede",
      host: parsed.host ?? null,
      port: typeof parsed.port === "number" ? parsed.port : null,
      serialPort: parsed.serialPort ?? null,
      enabledAntennas: Array.isArray(parsed.enabledAntennas) ? parsed.enabledAntennas : [],
    };
  } catch {
    // Valor corrompido/estranho sob nossa chave (ex.: editado manualmente no devtools).
    return null;
  }
}

export function saveTerminalRfidReaderConfig(companyId: string, config: TerminalRfidReaderConfig): void {
  writeStorage(overrideKey(companyId), JSON.stringify(config));
}

export function clearTerminalRfidReaderConfig(companyId: string): void {
  removeStorage(overrideKey(companyId));
}

export function hasTerminalRfidReaderConfig(companyId: string): boolean {
  return getTerminalRfidReaderConfig(companyId) !== null;
}
