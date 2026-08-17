import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fileDayIds: [] as string[],
  linkedFiles: [] as Array<{ id: string; file_path: string }>,
  updatePayloads: [] as unknown[],
  updateFilters: [] as Array<Array<[string, unknown]>>,
  deletedDayIds: [] as string[],
  removeEventFile: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "event_files") {
        return {
          select: () => ({
            eq: () => ({
              in: (_column: string, ids: string[]) => {
                mocks.fileDayIds = ids;
                return Promise.resolve({ data: mocks.linkedFiles, error: null });
              },
            }),
          }),
        };
      }

      if (table === "event_days") {
        return {
          update: (payload: unknown) => {
            const filters: Array<[string, unknown]> = [];
            mocks.updatePayloads.push(payload);
            mocks.updateFilters.push(filters);
            const builder = {
              eq(column: string, value: unknown) {
                filters.push([column, value]);
                return builder;
              },
              select: () => ({
                single: () => Promise.resolve({ data: { id: "day-1" }, error: null }),
              }),
            };
            return builder;
          },
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: "day-new" }, error: null }),
            }),
          }),
          delete: () => ({
            eq: () => ({
              in: (_column: string, ids: string[]) => {
                mocks.deletedDayIds = ids;
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  },
}));

vi.mock("./event-file-service", () => ({
  removeEventFile: mocks.removeEventFile,
}));

import {
  planEventDayReconciliation,
  reconcileEventDays,
  type EventDayDraft,
  type ExistingEventDay,
} from "./event-days-service";

const existingDays: ExistingEventDay[] = [
  { id: "day-1", day_number: 1, date: "2026-08-20", artist: "A", show_time: "20:00:00", observations: null },
  { id: "day-2", day_number: 2, date: "2026-08-21", artist: "B", show_time: "21:00:00", observations: "Original" },
];

function unchangedDrafts(): EventDayDraft[] {
  return existingDays.map((day) => ({ ...day }));
}

describe("event day reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileDayIds = [];
    mocks.linkedFiles = [];
    mocks.updatePayloads = [];
    mocks.updateFilters = [];
    mocks.deletedDayIds = [];
    mocks.removeEventFile.mockResolvedValue(undefined);
  });

  it("keeps every event_day id when only the event name changes", () => {
    const plan = planEventDayReconciliation(existingDays, unchangedDrafts());

    expect(plan.updates.map((item) => item.id)).toEqual(["day-1", "day-2"]);
    expect(plan.inserts).toEqual([]);
    expect(plan.removals).toEqual([]);
  });

  it("does not remove riders when only the event status changes", () => {
    const riders = [
      { id: "rider-1", event_day_id: "day-1" },
      { id: "rider-2", event_day_id: "day-2" },
    ];
    const plan = planEventDayReconciliation(existingDays, unchangedDrafts());
    const removedIds = new Set(plan.removals.map((day) => day.id));

    expect(riders.filter((file) => removedIds.has(file.event_day_id))).toEqual([]);
    expect(riders.map((file) => file.event_day_id)).toEqual(["day-1", "day-2"]);
  });

  it("updates day data while preserving that day id", () => {
    const desired = unchangedDrafts();
    desired[1] = { ...desired[1], artist: "Artista atualizado", observations: "Nova observação" };

    const plan = planEventDayReconciliation(existingDays, desired);

    expect(plan.updates[1]).toMatchObject({
      id: "day-2",
      day: { artist: "Artista atualizado", observations: "Nova observação" },
    });
    expect(plan.removals).toEqual([]);
  });

  it("adds one new day without replacing existing ids", () => {
    const desired = [
      ...unchangedDrafts(),
      { day_number: 3, date: "2026-08-22", artist: "C", show_time: null, observations: null },
    ];

    const plan = planEventDayReconciliation(existingDays, desired);

    expect(plan.updates.map((item) => item.id)).toEqual(["day-1", "day-2"]);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({ index: 2, day: { day_number: 3 } });
    expect(plan.removals).toEqual([]);
  });

  it("removes only the day omitted by the user", () => {
    const plan = planEventDayReconciliation(existingDays, [unchangedDrafts()[0]]);

    expect(plan.updates.map((item) => item.id)).toEqual(["day-1"]);
    expect(plan.removals.map((day) => day.id)).toEqual(["day-2"]);
  });

  it("keeps riders linked to preserved days when another day is removed", () => {
    const riders = [
      { id: "rider-1", event_day_id: "day-1" },
      { id: "rider-2", event_day_id: "day-2" },
    ];
    const plan = planEventDayReconciliation(existingDays, [unchangedDrafts()[0]]);
    const removedIds = new Set(plan.removals.map((day) => day.id));

    expect(riders.filter((file) => !removedIds.has(file.event_day_id))).toEqual([
      { id: "rider-1", event_day_id: "day-1" },
    ]);
    expect(riders.filter((file) => removedIds.has(file.event_day_id))).toEqual([
      { id: "rider-2", event_day_id: "day-2" },
    ]);
  });

  it("keeps a single-day event as an update with the same id", () => {
    const oneDay = [existingDays[0]];
    const plan = planEventDayReconciliation(oneDay, [{ ...oneDay[0], artist: "Solo" }]);

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].id).toBe("day-1");
    expect(plan.inserts).toEqual([]);
    expect(plan.removals).toEqual([]);
  });

  it("requires confirmation and explicitly cleans only riders of removed days", async () => {
    mocks.linkedFiles = [{ id: "rider-2", file_path: "event/day-2/rider.pdf" }];
    const confirmRemoval = vi.fn(() => true);

    const persisted = await reconcileEventDays({
      eventId: "event-1",
      empresaId: "empresa-1",
      existingDays,
      desiredDays: [unchangedDrafts()[0]],
      role: "admin_empresa",
      confirmLinkedFileRemoval: confirmRemoval,
    });

    expect(confirmRemoval).toHaveBeenCalledWith(1, 1);
    expect(mocks.fileDayIds).toEqual(["day-2"]);
    expect(mocks.removeEventFile).toHaveBeenCalledTimes(1);
    expect(mocks.removeEventFile).toHaveBeenCalledWith({
      eventId: "event-1",
      fileId: "rider-2",
      filePath: "event/day-2/rider.pdf",
      role: "admin_empresa",
    });
    expect(mocks.deletedDayIds).toEqual(["day-2"]);
    expect(mocks.updateFilters[0]).toEqual([
      ["id", "day-1"],
      ["event_id", "event-1"],
    ]);
    expect(persisted).toEqual([{ id: "day-1" }]);
  });
});
