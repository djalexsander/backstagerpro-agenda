import { describe, expect, it } from "vitest";
import {
  EVENT_FILE_MAX_BYTES,
  assertEventFileAdministrator,
  buildEventFilePath,
  canManageEventFiles,
  canReadEventFiles,
  validateEventPdf,
} from "./event-file-security";

const eventId = "123e4567-e89b-42d3-a456-426614174000";
const dayId = "223e4567-e89b-42d3-a456-426614174000";

describe("event file security", () => {
  it("allows tenant users to read but only administrators to mutate", () => {
    expect(canReadEventFiles("usuario")).toBe(true);
    expect(canManageEventFiles("usuario")).toBe(false);
    expect(canManageEventFiles("admin_empresa")).toBe(true);
    expect(canManageEventFiles("master_admin")).toBe(true);
    expect(canReadEventFiles("unknown")).toBe(false);
    expect(() => assertEventFileAdministrator("usuario")).toThrow(
      /apenas administradores/i,
    );
  });

  it("builds a single-folder PDF path without unsafe filename characters", () => {
    expect(
      buildEventFilePath({
        eventId,
        eventDayId: dayId,
        kind: "day",
        fileName: "../../Rider São João.PDF",
        timestamp: 123456,
      }),
    ).toBe(
      `${eventId}/day_${dayId}_123456_Rider_Sao_Joao.pdf`,
    );
  });

  it("rejects malformed event and day identifiers", () => {
    expect(() =>
      buildEventFilePath({
        eventId: "../other-tenant",
        kind: "material",
        fileName: "mapa.pdf",
      }),
    ).toThrow(/evento inválido/i);
    expect(() =>
      buildEventFilePath({
        eventId,
        eventDayId: "other-day",
        kind: "day",
        fileName: "rider.pdf",
      }),
    ).toThrow(/dia do evento inválido/i);
  });

  it("accepts only bounded PDF uploads", () => {
    expect(() =>
      validateEventPdf({
        name: "rider.pdf",
        size: 1024,
        type: "application/pdf",
      }),
    ).not.toThrow();
    expect(() =>
      validateEventPdf({ name: "rider.html", size: 1024, type: "text/html" }),
    ).toThrow(/PDF/i);
    expect(() =>
      validateEventPdf({
        name: "rider.pdf",
        size: EVENT_FILE_MAX_BYTES + 1,
        type: "application/pdf",
      }),
    ).toThrow(/20 MB/i);
  });
});
