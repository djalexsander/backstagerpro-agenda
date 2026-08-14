import type {
  RfidReadEvent,
  RfidReaderConnectionStatus,
  RfidReaderStatus,
} from "./rfid-types";

// ============================================================================
// ADAPTER DE HARDWARE RFID (interface)
// ============================================================================
//
// O domínio do Backstage (rfid-domain.ts, telas, banco) nunca deve saber se
// uma leitura veio de um reader TCP/IP, USB, serial, SDK proprietário,
// WebSocket ou middleware local - tudo entra pelo mesmo RfidReadEvent
// (rfid-types.ts) através desta interface. Implementações futuras
// (NetworkRfidReaderAdapter, SerialRfidReaderAdapter, adapters de SDK de
// fabricante) plugam aqui sem tocar em domínio, telas ou banco. Nenhuma
// marca/modelo específico é referenciada nesta etapa.

export type RfidTagReadListener = (event: RfidReadEvent) => void;
export type RfidStatusChangeListener = (status: RfidReaderStatus) => void;
/** Cancela a inscrição feita por onTagRead/onStatusChange. */
export type RfidUnsubscribe = () => void;

export interface RfidReaderAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  startInventory(): Promise<void>;
  stopInventory(): Promise<void>;
  onTagRead(callback: RfidTagReadListener): RfidUnsubscribe;
  onStatusChange(callback: RfidStatusChangeListener): RfidUnsubscribe;
  getStatus(): RfidReaderStatus;
}

export class RfidReaderAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RfidReaderAdapterError";
  }
}

// ============================================================================
// MOCK — desenvolvimento, testes e a tela de laboratório sem hardware físico
// ============================================================================

export interface MockRfidReaderAdapterOptions {
  readerId?: string;
  /** Simula latência de conexão real; 0 por padrão para manter os testes determinísticos. */
  connectDelayMs?: number;
  /** Permite testar o caminho de falha de conexão sem depender de hardware. */
  failOnConnect?: boolean;
}

/**
 * Não fala com nenhum hardware. Mantém a mesma máquina de estados que um
 * adapter real precisaria respeitar (desconectado -> conectando ->
 * conectado -> lendo) e expõe simulateRead/simulateReads para injetar
 * RfidReadEvent manualmente - usado tanto pelos testes automatizados quanto,
 * futuramente, por uma tela de demonstração sem reader físico.
 */
export class MockRfidReaderAdapter implements RfidReaderAdapter {
  private status: RfidReaderStatus;
  private readonly connectDelayMs: number;
  private readonly failOnConnect: boolean;
  private readonly tagListeners = new Set<RfidTagReadListener>();
  private readonly statusListeners = new Set<RfidStatusChangeListener>();

  constructor(options: MockRfidReaderAdapterOptions = {}) {
    this.connectDelayMs = options.connectDelayMs ?? 0;
    this.failOnConnect = options.failOnConnect ?? false;
    this.status = {
      status: "desconectado",
      readerId: options.readerId ?? null,
      message: null,
    };
  }

  private setStatus(status: RfidReaderConnectionStatus, message: string | null = null) {
    this.status = { ...this.status, status, message };
    for (const listener of this.statusListeners) listener(this.status);
  }

  async connect(): Promise<void> {
    if (this.status.status === "conectado" || this.status.status === "lendo") return;
    this.setStatus("conectando");
    if (this.connectDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.connectDelayMs));
    }
    if (this.failOnConnect) {
      this.setStatus("erro", "Falha simulada ao conectar ao reader.");
      throw new RfidReaderAdapterError("Falha simulada ao conectar ao reader.");
    }
    this.setStatus("conectado");
  }

  async disconnect(): Promise<void> {
    this.setStatus("desconectado");
  }

  async startInventory(): Promise<void> {
    if (this.status.status === "desconectado" || this.status.status === "conectando") {
      throw new RfidReaderAdapterError("Conecte o reader antes de iniciar a leitura.");
    }
    if (this.status.status === "lendo") return;
    this.setStatus("lendo");
  }

  async stopInventory(): Promise<void> {
    if (this.status.status !== "lendo") return;
    this.setStatus("conectado");
  }

  onTagRead(callback: RfidTagReadListener): RfidUnsubscribe {
    this.tagListeners.add(callback);
    return () => this.tagListeners.delete(callback);
  }

  onStatusChange(callback: RfidStatusChangeListener): RfidUnsubscribe {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  getStatus(): RfidReaderStatus {
    return this.status;
  }

  /**
   * Injeta uma leitura simulada, como se tivesse vindo do rádio. Só entrega
   * aos ouvintes quando o mock está em "lendo" - um reader parado não
   * reporta tags, e o mock deve preservar essa garantia para os testes
   * exercitarem start/stop de verdade.
   */
  simulateRead(event: Partial<RfidReadEvent> & { epc: string }): void {
    if (this.status.status !== "lendo") return;
    const fullEvent: RfidReadEvent = {
      epc: event.epc,
      antenna: event.antenna,
      rssi: event.rssi,
      readerId: event.readerId ?? this.status.readerId ?? undefined,
      timestamp: event.timestamp ?? new Date().toISOString(),
    };
    for (const listener of this.tagListeners) listener(fullEvent);
  }

  simulateReads(epcs: string[]): void {
    for (const epc of epcs) this.simulateRead({ epc });
  }
}
