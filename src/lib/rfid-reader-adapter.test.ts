import { describe, expect, it, vi } from "vitest";
import { MockRfidReaderAdapter, RfidReaderAdapterError } from "@/lib/rfid-reader-adapter";
import type { RfidReadEvent } from "@/lib/rfid-types";

describe("MockRfidReaderAdapter", () => {
  it("starts disconnected", () => {
    const adapter = new MockRfidReaderAdapter();
    expect(adapter.getStatus().status).toBe("desconectado");
  });

  it("connects and reports conectado", async () => {
    const adapter = new MockRfidReaderAdapter();
    await adapter.connect();
    expect(adapter.getStatus().status).toBe("conectado");
  });

  it("surfaces a simulated connection failure without leaving a fake 'conectado' state", async () => {
    const adapter = new MockRfidReaderAdapter({ failOnConnect: true });
    await expect(adapter.connect()).rejects.toThrow(RfidReaderAdapterError);
    expect(adapter.getStatus().status).toBe("erro");
  });

  it("refuses to start inventory before connecting", async () => {
    const adapter = new MockRfidReaderAdapter();
    await expect(adapter.startInventory()).rejects.toThrow(RfidReaderAdapterError);
  });

  it("moves to 'lendo' once inventory starts, and back to 'conectado' once stopped", async () => {
    const adapter = new MockRfidReaderAdapter();
    await adapter.connect();
    await adapter.startInventory();
    expect(adapter.getStatus().status).toBe("lendo");
    await adapter.stopInventory();
    expect(adapter.getStatus().status).toBe("conectado");
  });

  it("disconnect resets to desconectado from any state", async () => {
    const adapter = new MockRfidReaderAdapter();
    await adapter.connect();
    await adapter.startInventory();
    await adapter.disconnect();
    expect(adapter.getStatus().status).toBe("desconectado");
  });

  it("delivers simulated reads to subscribers only while reading", async () => {
    const adapter = new MockRfidReaderAdapter();
    const received: RfidReadEvent[] = [];
    adapter.onTagRead((event) => received.push(event));

    adapter.simulateRead({ epc: "AABBCCDD" });
    expect(received).toHaveLength(0);

    await adapter.connect();
    adapter.simulateRead({ epc: "AABBCCDD" });
    expect(received).toHaveLength(0);

    await adapter.startInventory();
    adapter.simulateRead({ epc: "AABBCCDD" });
    expect(received).toHaveLength(1);
    expect(received[0].epc).toBe("AABBCCDD");

    await adapter.stopInventory();
    adapter.simulateRead({ epc: "AABBCCDD" });
    expect(received).toHaveLength(1);
  });

  it("simulateReads delivers one event per EPC", async () => {
    const adapter = new MockRfidReaderAdapter();
    const received: RfidReadEvent[] = [];
    adapter.onTagRead((event) => received.push(event));
    await adapter.connect();
    await adapter.startInventory();

    adapter.simulateReads(["AAAAAAAA", "BBBBBBBB", "CCCCCCCC"]);
    expect(received.map((e) => e.epc)).toEqual(["AAAAAAAA", "BBBBBBBB", "CCCCCCCC"]);
  });

  it("stops delivering events after unsubscribe", async () => {
    const adapter = new MockRfidReaderAdapter();
    const listener = vi.fn();
    const unsubscribe = adapter.onTagRead(listener);
    await adapter.connect();
    await adapter.startInventory();

    adapter.simulateRead({ epc: "AAAAAAAA" });
    unsubscribe();
    adapter.simulateRead({ epc: "BBBBBBBB" });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies status listeners on every transition", async () => {
    const adapter = new MockRfidReaderAdapter();
    const seen: string[] = [];
    adapter.onStatusChange((status) => seen.push(status.status));

    await adapter.connect();
    await adapter.startInventory();
    await adapter.stopInventory();
    await adapter.disconnect();

    expect(seen).toEqual(["conectando", "conectado", "lendo", "conectado", "desconectado"]);
  });

  it("fills in a default ISO timestamp and the configured readerId when not provided", async () => {
    const adapter = new MockRfidReaderAdapter({ readerId: "bench-1" });
    let received: RfidReadEvent | null = null;
    adapter.onTagRead((event) => (received = event));
    await adapter.connect();
    await adapter.startInventory();

    adapter.simulateRead({ epc: "AAAAAAAA" });

    expect(received?.readerId).toBe("bench-1");
    expect(typeof received?.timestamp).toBe("string");
  });
});
