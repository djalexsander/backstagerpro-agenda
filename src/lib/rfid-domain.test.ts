import { describe, expect, it } from "vitest";
import {
  aggregateRfidReadEvents,
  buildSessionResultSnapshot,
  normalizeEpc,
  parseEpcList,
  reconcileRfidRead,
} from "@/lib/rfid-domain";
import type { EpcResolution, RfidReadEvent } from "@/lib/rfid-types";

describe("normalizeEpc", () => {
  it("uppercases and accepts plain hex", () => {
    expect(normalizeEpc("e2801160600002054abcdef1")).toBe("E2801160600002054ABCDEF1");
  });

  it("strips spaces, hyphens and colons used for readability", () => {
    expect(normalizeEpc("E2 80-11:60 60-00 02:05")).toBe("E280116060000205");
  });

  it("rejects non-hex content", () => {
    expect(normalizeEpc("not-an-epc!!")).toBeNull();
  });

  it("rejects strings shorter than 8 hex chars", () => {
    expect(normalizeEpc("ABCD")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(normalizeEpc("   ")).toBeNull();
  });
});

describe("parseEpcList", () => {
  it("splits by newline, comma, semicolon and tab", () => {
    const result = parseEpcList("AABBCCDD\nEEFF0011,11223344;55667788\t99AABBCC");
    expect(result.valid).toEqual([
      "AABBCCDD",
      "EEFF0011",
      "11223344",
      "55667788",
      "99AABBCC",
    ]);
  });

  it("deduplicates repeated EPCs while preserving first-seen order", () => {
    const result = parseEpcList("AABBCCDD\naabbccdd\nAABBCCDD");
    expect(result.valid).toEqual(["AABBCCDD"]);
    expect(result.duplicates).toEqual(["AABBCCDD", "AABBCCDD"]);
  });

  it("reports invalid entries without dropping the valid ones", () => {
    const result = parseEpcList("AABBCCDD\nnot-valid\n11223344");
    expect(result.valid).toEqual(["AABBCCDD", "11223344"]);
    expect(result.invalid).toEqual(["not-valid"]);
  });

  it("returns empty arrays for blank input", () => {
    const result = parseEpcList("   \n\n  ");
    expect(result).toEqual({ valid: [], invalid: [], duplicates: [] });
  });
});

describe("aggregateRfidReadEvents", () => {
  function event(overrides: Partial<RfidReadEvent> & { epc: string }): RfidReadEvent {
    return {
      timestamp: "2026-08-14T10:00:00.000Z",
      ...overrides,
    };
  }

  it("collapses many raw reads of the same tag into a single observation", () => {
    const events: RfidReadEvent[] = Array.from({ length: 148 }, () =>
      event({ epc: "AABBCCDD", rssi: -60 }),
    );
    const observations = aggregateRfidReadEvents(events);
    expect(observations).toHaveLength(1);
    expect(observations[0].readCount).toBe(148);
  });

  it("tracks first/last seen timestamps across out-of-order events", () => {
    const observations = aggregateRfidReadEvents([
      event({ epc: "AABBCCDD", timestamp: "2026-08-14T10:00:05.000Z" }),
      event({ epc: "AABBCCDD", timestamp: "2026-08-14T10:00:01.000Z" }),
      event({ epc: "AABBCCDD", timestamp: "2026-08-14T10:00:09.000Z" }),
    ]);
    expect(observations[0].firstSeenAt).toBe("2026-08-14T10:00:01.000Z");
    expect(observations[0].lastSeenAt).toBe("2026-08-14T10:00:09.000Z");
  });

  it("keeps the strongest RSSI as bestRssi and the most recent as lastRssi", () => {
    const observations = aggregateRfidReadEvents([
      event({ epc: "AABBCCDD", timestamp: "2026-08-14T10:00:01.000Z", rssi: -70 }),
      event({ epc: "AABBCCDD", timestamp: "2026-08-14T10:00:02.000Z", rssi: -40 }),
      event({ epc: "AABBCCDD", timestamp: "2026-08-14T10:00:03.000Z", rssi: -55 }),
    ]);
    expect(observations[0].bestRssi).toBe(-40);
    expect(observations[0].lastRssi).toBe(-55);
  });

  it("unions the antennas that detected the tag", () => {
    const observations = aggregateRfidReadEvents([
      event({ epc: "AABBCCDD", antenna: 1 }),
      event({ epc: "AABBCCDD", antenna: 2 }),
      event({ epc: "AABBCCDD", antenna: 1 }),
    ]);
    expect(observations[0].antennas.sort()).toEqual([1, 2]);
  });

  it("produces one observation per distinct EPC", () => {
    const observations = aggregateRfidReadEvents([
      event({ epc: "AAAAAAAA" }),
      event({ epc: "BBBBBBBB" }),
      event({ epc: "AAAAAAAA" }),
    ]);
    expect(observations.map((o) => o.epc).sort()).toEqual(["AAAAAAAA", "BBBBBBBB"]);
  });

  it("drops malformed EPCs instead of surfacing them as observations", () => {
    const observations = aggregateRfidReadEvents([event({ epc: "!!!" })]);
    expect(observations).toEqual([]);
  });

  it("returns an empty list for an empty input", () => {
    expect(aggregateRfidReadEvents([])).toEqual([]);
  });
});

describe("reconcileRfidRead", () => {
  it("classifies a simple found/missing/unexpected/unknown mix", () => {
    const result = reconcileRfidRead({
      expectedMaterialIds: ["mat-1", "mat-2", "mat-3"],
      resolutions: [
        { epc: "EPC-1", materialId: "mat-1", tagStatus: "ativa" },
        { epc: "EPC-2", materialId: "mat-4", tagStatus: "ativa" },
        { epc: "EPC-3", materialId: null, tagStatus: null },
      ],
    });

    expect(result.found).toEqual([{ materialId: "mat-1", epc: "EPC-1" }]);
    expect(result.missing).toEqual([{ materialId: "mat-2" }, { materialId: "mat-3" }]);
    expect(result.unexpected).toEqual([{ materialId: "mat-4", epc: "EPC-2" }]);
    expect(result.unknown).toEqual([{ epc: "EPC-3" }]);
    expect(result.counts).toEqual({
      expected: 3,
      found: 1,
      missing: 2,
      unexpected: 1,
      unknown: 1,
      inactiveTag: 0,
      conflicts: 0,
    });
  });

  it("routes tags with a non-active status to inactiveTag regardless of expectation", () => {
    const result = reconcileRfidRead({
      expectedMaterialIds: ["mat-1"],
      resolutions: [
        { epc: "EPC-OLD", materialId: "mat-1", tagStatus: "inativa" },
        { epc: "EPC-DAMAGED", materialId: "mat-9", tagStatus: "danificada" },
      ],
    });
    expect(result.found).toEqual([]);
    expect(result.missing).toEqual([{ materialId: "mat-1" }]);
    expect(result.inactiveTag).toEqual([
      { materialId: "mat-1", epc: "EPC-OLD", status: "inativa" },
      { materialId: "mat-9", epc: "EPC-DAMAGED", status: "danificada" },
    ]);
  });

  it("handles zero expected materials (everything read becomes unexpected/unknown)", () => {
    const result = reconcileRfidRead({
      expectedMaterialIds: [],
      resolutions: [
        { epc: "EPC-1", materialId: "mat-1", tagStatus: "ativa" },
        { epc: "EPC-2", materialId: null, tagStatus: null },
      ],
    });
    expect(result.counts.expected).toBe(0);
    expect(result.unexpected).toEqual([{ materialId: "mat-1", epc: "EPC-1" }]);
    expect(result.unknown).toEqual([{ epc: "EPC-2" }]);
  });

  it("handles zero reads (everything expected becomes missing)", () => {
    const result = reconcileRfidRead({
      expectedMaterialIds: ["mat-1", "mat-2"],
      resolutions: [],
    });
    expect(result.found).toEqual([]);
    expect(result.missing).toEqual([{ materialId: "mat-1" }, { materialId: "mat-2" }]);
    expect(result.counts).toMatchObject({ expected: 2, found: 0, missing: 2 });
  });

  it("handles zero expected and zero read without error", () => {
    const result = reconcileRfidRead({ expectedMaterialIds: [], resolutions: [] });
    expect(result.counts).toEqual({
      expected: 0,
      found: 0,
      missing: 0,
      unexpected: 0,
      unknown: 0,
      inactiveTag: 0,
      conflicts: 0,
    });
  });

  it("scales to 100+ tags without misclassifying any of them", () => {
    const expected = Array.from({ length: 120 }, (_, i) => `mat-${i}`);
    // 100 of the 120 expected materials are read; 15 extra unexpected reads;
    // 5 unknown EPCs on top - exercises found/missing/unexpected/unknown together at volume.
    const resolutions: EpcResolution[] = [
      ...expected.slice(0, 100).map((materialId, i) => ({
        epc: `EPC-FOUND-${i}`,
        materialId,
        tagStatus: "ativa" as const,
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        epc: `EPC-UNEXPECTED-${i}`,
        materialId: `extra-${i}`,
        tagStatus: "ativa" as const,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        epc: `EPC-UNKNOWN-${i}`,
        materialId: null,
        tagStatus: null,
      })),
    ];

    const result = reconcileRfidRead({ expectedMaterialIds: expected, resolutions });
    expect(result.counts.expected).toBe(120);
    expect(result.counts.found).toBe(100);
    expect(result.counts.missing).toBe(20);
    expect(result.counts.unexpected).toBe(15);
    expect(result.counts.unknown).toBe(5);
  });

  it("flags duplicate material ids in the expected list as a conflict without inflating counts", () => {
    const result = reconcileRfidRead({
      expectedMaterialIds: ["mat-1", "mat-1"],
      resolutions: [],
    });
    expect(result.counts.expected).toBe(1);
    expect(result.missing).toEqual([{ materialId: "mat-1" }]);
    expect(result.conflicts).toEqual([
      {
        epc: null,
        materialId: null,
        reason: "Lista de materiais esperados contém identificadores duplicados.",
      },
    ]);
  });

  it("flags the same EPC appearing twice in resolutions as a conflict", () => {
    const result = reconcileRfidRead({
      expectedMaterialIds: ["mat-1"],
      resolutions: [
        { epc: "EPC-1", materialId: "mat-1", tagStatus: "ativa" },
        { epc: "EPC-1", materialId: "mat-1", tagStatus: "ativa" },
      ],
    });
    expect(result.found).toEqual([{ materialId: "mat-1", epc: "EPC-1" }]);
    expect(result.conflicts).toHaveLength(1);
  });

  it("flags two different active tags resolving to the same material as a conflict", () => {
    const result = reconcileRfidRead({
      expectedMaterialIds: ["mat-1"],
      resolutions: [
        { epc: "EPC-A", materialId: "mat-1", tagStatus: "ativa" },
        { epc: "EPC-B", materialId: "mat-1", tagStatus: "ativa" },
      ],
    });
    expect(result.found).toEqual([{ materialId: "mat-1", epc: "EPC-A" }]);
    expect(result.conflicts).toEqual([
      {
        epc: "EPC-B",
        materialId: "mat-1",
        reason: "Mais de uma tag ativa lida resolveu para o mesmo material.",
      },
    ]);
  });
});

describe("buildSessionResultSnapshot", () => {
  it("projects a reconciliation result into the bounded snapshot shape", () => {
    const result = reconcileRfidRead({
      expectedMaterialIds: ["mat-1", "mat-2"],
      resolutions: [
        { epc: "EPC-1", materialId: "mat-1", tagStatus: "ativa" },
        { epc: "EPC-2", materialId: "mat-3", tagStatus: "ativa" },
        { epc: "EPC-3", materialId: null, tagStatus: null },
        { epc: "EPC-4", materialId: "mat-4", tagStatus: "danificada" },
      ],
    });
    expect(buildSessionResultSnapshot(result)).toEqual({
      found: ["mat-1"],
      missing: ["mat-2"],
      unexpected: [{ materialId: "mat-3", epc: "EPC-2" }],
      unknown: ["EPC-3"],
      inactiveTag: [{ materialId: "mat-4", epc: "EPC-4" }],
    });
  });
});
