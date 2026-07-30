import { describe, expect, it } from "vitest";
import {
  normalizeAppRole,
  selectHighestPriorityRole,
} from "@/lib/user-role";

describe("user role priority", () => {
  it.each([
    ["master_admin", "master_admin"],
    ["admin_empresa", "admin_empresa"],
    ["usuario", "usuario"],
  ] as const)("selects %s when it is the only role", (storedRole, expectedRole) => {
    expect(selectHighestPriorityRole([{ role: storedRole }])).toBe(expectedRole);
  });

  it("prioritizes master_admin over admin_empresa and usuario regardless of row order", () => {
    expect(
      selectHighestPriorityRole([
        { role: "usuario" },
        { role: "master_admin" },
        { role: "admin_empresa" },
      ]),
    ).toBe("master_admin");

    expect(
      selectHighestPriorityRole([
        { role: "admin_empresa" },
        { role: "usuario" },
      ]),
    ).toBe("admin_empresa");
  });

  it("maps legacy roles and ignores unknown values", () => {
    expect(normalizeAppRole("admin")).toBe("admin_empresa");
    expect(normalizeAppRole("user")).toBe("usuario");
    expect(selectHighestPriorityRole([{ role: "unknown" }, { role: null }])).toBeNull();
  });

  it("returns null when the user has no roles", () => {
    expect(selectHighestPriorityRole([])).toBeNull();
  });
});
