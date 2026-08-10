import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { EnrichedEmpresaModule } from "@/types/subscription";

const { rpc, maybeSingle, eq, select, from } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ eq, maybeSingle }));
  const select = vi.fn(() => ({ eq, maybeSingle }));
  const from = vi.fn(() => ({ select }));
  return { rpc: vi.fn(), maybeSingle, eq, select, from };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from } }));

import {
  applyPermissionToggle,
  buildEmptyPermissionRows,
  fetchUserModulePermissions,
  filterConfigurableModules,
  groupPermissionRows,
  resolveCreatedUserId,
  saveUserModulePermissions,
  type ModulePermissionEntry,
} from "./user-module-permissions-service";

describe("user-module-permissions-service", () => {
  afterEach(() => {
    rpc.mockReset();
    maybeSingle.mockReset();
    eq.mockClear();
    select.mockClear();
    from.mockClear();
  });

  describe("fetchUserModulePermissions", () => {
    it("maps snake_case RPC rows into ModulePermissionEntry and defaults _user_id to the caller when omitted", async () => {
      rpc.mockResolvedValue({
        data: [
          {
            feature_key: "checkin_checkout",
            module_nome: "Check-in / Check-out",
            can_view: true,
            can_create: false,
            can_edit: false,
            can_delete: false,
          },
        ],
        error: null,
      });

      const result = await fetchUserModulePermissions("company-1");

      expect(rpc).toHaveBeenCalledWith("list_user_module_permissions", {
        _empresa_id: "company-1",
        _user_id: undefined,
      });
      expect(result).toEqual([
        {
          featureKey: "checkin_checkout",
          moduleName: "Check-in / Check-out",
          canView: true,
          canCreate: false,
          canEdit: false,
          canDelete: false,
        },
      ]);
    });

    it("passes a specific _user_id through when reading someone else's permissions", async () => {
      rpc.mockResolvedValue({ data: [], error: null });
      await fetchUserModulePermissions("company-1", "user-9");
      expect(rpc).toHaveBeenCalledWith("list_user_module_permissions", {
        _empresa_id: "company-1",
        _user_id: "user-9",
      });
    });

    it("returns an empty list instead of null when the RPC returns no rows", async () => {
      rpc.mockResolvedValue({ data: null, error: null });
      expect(await fetchUserModulePermissions("company-1", "user-9")).toEqual([]);
    });

    it("maps a known error code (UP001) to a Portuguese message", async () => {
      rpc.mockResolvedValue({ data: null, error: { code: "UP001", message: "raw" } });
      await expect(fetchUserModulePermissions("company-1", "user-9")).rejects.toThrow(
        "Este usuário não pertence a esta empresa.",
      );
    });

    it("falls back to the raw error message for an unmapped error code", async () => {
      rpc.mockResolvedValue({ data: null, error: { code: "XX999", message: "algo inesperado" } });
      await expect(fetchUserModulePermissions("company-1", "user-9")).rejects.toThrow("algo inesperado");
    });
  });

  describe("saveUserModulePermissions", () => {
    it("converts entries back to the snake_case RPC payload", async () => {
      rpc.mockResolvedValue({ data: [], error: null });

      await saveUserModulePermissions("company-1", "user-9", [
        {
          featureKey: "checkin_checkout",
          moduleName: "Check-in / Check-out",
          canView: true,
          canCreate: true,
          canEdit: false,
          canDelete: false,
        },
      ]);

      expect(rpc).toHaveBeenCalledWith("set_user_module_permissions", {
        _empresa_id: "company-1",
        _user_id: "user-9",
        _permissions: [
          { feature_key: "checkin_checkout", can_view: true, can_create: true, can_edit: false, can_delete: false },
        ],
      });
    });

    it("sends an empty array as-is (full replace with zero grants)", async () => {
      rpc.mockResolvedValue({ data: [], error: null });
      await saveUserModulePermissions("company-1", "user-9", []);
      expect(rpc).toHaveBeenCalledWith("set_user_module_permissions", {
        _empresa_id: "company-1",
        _user_id: "user-9",
        _permissions: [],
      });
    });

    it("maps the module-not-active error code (UP004) to a Portuguese message", async () => {
      rpc.mockResolvedValue({ data: null, error: { code: "UP004", message: "raw" } });
      await expect(saveUserModulePermissions("company-1", "user-9", [])).rejects.toThrow(
        "Um dos módulos selecionados não está ativo para esta empresa.",
      );
    });

    it("maps the master-target error code (UP002) to a Portuguese message", async () => {
      rpc.mockResolvedValue({ data: null, error: { code: "UP002", message: "raw" } });
      await expect(saveUserModulePermissions("company-1", "user-9", [])).rejects.toThrow(
        "Contas master_admin não são afetadas por permissões de módulo.",
      );
    });
  });

  describe("resolveCreatedUserId", () => {
    it("finds the user_id by email within the company", async () => {
      maybeSingle.mockResolvedValue({ data: { user_id: "user-42" }, error: null });
      const id = await resolveCreatedUserId("company-1", "new@example.com");
      expect(from).toHaveBeenCalledWith("profiles");
      expect(select).toHaveBeenCalledWith("user_id");
      expect(eq).toHaveBeenCalledWith("empresa_id", "company-1");
      expect(eq).toHaveBeenCalledWith("email", "new@example.com");
      expect(id).toBe("user-42");
    });

    it("returns null instead of throwing when no matching profile is found", async () => {
      maybeSingle.mockResolvedValue({ data: null, error: null });
      expect(await resolveCreatedUserId("company-1", "missing@example.com")).toBeNull();
    });

    it("returns null instead of throwing on a query error", async () => {
      maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
      expect(await resolveCreatedUserId("company-1", "err@example.com")).toBeNull();
    });
  });

  describe("buildEmptyPermissionRows", () => {
    it("builds one all-false row per active, non-capacity module with a resolvable feature_key", () => {
      const activeModules = [
        { catalog: { feature_key: "checkin_checkout", nome: "Check-in / Check-out", is_capacity_module: false } },
        { catalog: { feature_key: "locacao_materiais", nome: "Locações", is_capacity_module: false } },
        { catalog: null },
      ] as unknown as EnrichedEmpresaModule[];

      expect(buildEmptyPermissionRows(activeModules)).toEqual([
        {
          featureKey: "checkin_checkout",
          moduleName: "Check-in / Check-out",
          canView: false,
          canCreate: false,
          canEdit: false,
          canDelete: false,
        },
        {
          featureKey: "locacao_materiais",
          moduleName: "Locações",
          canView: false,
          canCreate: false,
          canEdit: false,
          canDelete: false,
        },
      ]);
    });

    it("never pre-checks anything - a new user always starts with every action unchecked, capacity modules included in the exclusion", () => {
      const activeModules = [
        { catalog: { feature_key: "checkin_checkout", nome: "Check-in / Check-out", is_capacity_module: false } },
        { catalog: { feature_key: "extra_usuarios", nome: "Pacote extra de usuários", is_capacity_module: true } },
      ] as unknown as EnrichedEmpresaModule[];

      const rows = buildEmptyPermissionRows(activeModules);
      expect(rows).toHaveLength(1);
      expect(rows.every((row) => !row.canView && !row.canCreate && !row.canEdit && !row.canDelete)).toBe(true);
    });

    it("excludes capacity modules (extra_usuarios/extra_eventos/extra_storage) - they are quota add-ons, not a configurable screen", () => {
      const activeModules = [
        { catalog: { feature_key: "checkin_checkout", nome: "Check-in / Check-out", is_capacity_module: false } },
        { catalog: { feature_key: "extra_usuarios", nome: "Pacote extra de usuários", is_capacity_module: true } },
      ] as unknown as EnrichedEmpresaModule[];

      expect(buildEmptyPermissionRows(activeModules).map((row) => row.featureKey)).toEqual(["checkin_checkout"]);
    });

    it("returns an empty list when the company has no active modules", () => {
      expect(buildEmptyPermissionRows([])).toEqual([]);
    });
  });

  describe("filterConfigurableModules", () => {
    const rows: ModulePermissionEntry[] = [
      { featureKey: "checkin_checkout", moduleName: "Check-in / Check-out", canView: true, canCreate: false, canEdit: false, canDelete: false },
      { featureKey: "extra_eventos", moduleName: "Pacote extra de eventos", canView: true, canCreate: false, canEdit: false, canDelete: false },
    ];
    const catalog = [
      { feature_key: "checkin_checkout", is_capacity_module: false },
      { feature_key: "extra_eventos", is_capacity_module: true },
    ];

    it("drops rows whose feature_key is flagged is_capacity_module in the catalog", () => {
      expect(filterConfigurableModules(rows, catalog).map((row) => row.featureKey)).toEqual(["checkin_checkout"]);
    });

    it("keeps everything when the catalog has no capacity modules", () => {
      expect(filterConfigurableModules(rows, [{ feature_key: "checkin_checkout", is_capacity_module: false }])).toHaveLength(2);
    });
  });

  describe("groupPermissionRows", () => {
    const row = (featureKey: string): ModulePermissionEntry => ({
      featureKey,
      moduleName: featureKey,
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
    });

    it("groups modules into the same 4 categories as the sidebar menu", () => {
      const categories = groupPermissionRows([
        row("checkin_checkout"),
        row("financeiro_avancado"),
        row("notificacoes_premium"),
      ]);

      expect(categories.map((c) => c.id)).toEqual(["materiais-operacoes", "administracao", "configuracoes"]);
      expect(categories.map((c) => c.label)).toEqual(["Materiais & Operações", "Administração", "Configurações"]);
      expect(categories.find((c) => c.id === "materiais-operacoes")?.rows.map((r) => r.featureKey)).toEqual(["checkin_checkout"]);
    });

    it("omits a category entirely when none of the given rows belong to it", () => {
      const categories = groupPermissionRows([row("checkin_checkout")]);
      expect(categories).toHaveLength(1);
      expect(categories[0].id).toBe("materiais-operacoes");
    });

    it("returns no categories for an empty input", () => {
      expect(groupPermissionRows([])).toEqual([]);
    });

    it("falls back an unmapped/future feature_key to Configurações instead of dropping it", () => {
      const categories = groupPermissionRows([row("um_modulo_novo_do_futuro")]);
      expect(categories).toHaveLength(1);
      expect(categories[0].id).toBe("configuracoes");
      expect(categories[0].rows.map((r) => r.featureKey)).toEqual(["um_modulo_novo_do_futuro"]);
    });

    it("keeps every module belonging to the same category together, in the order given", () => {
      const categories = groupPermissionRows([
        row("etiquetas_materiais"),
        row("gestao_materiais"),
        row("checkin_checkout"),
      ]);
      expect(categories).toHaveLength(1);
      expect(categories[0].rows.map((r) => r.featureKey)).toEqual([
        "etiquetas_materiais",
        "gestao_materiais",
        "checkin_checkout",
      ]);
    });
  });
});

describe("applyPermissionToggle", () => {
  const checkinRow: ModulePermissionEntry = {
    featureKey: "checkin_checkout",
    moduleName: "Check-in / Check-out",
    canView: false,
    canCreate: false,
    canEdit: false,
    canDelete: false,
  };

  it("checking canView alone only sets canView", () => {
    expect(applyPermissionToggle(checkinRow, "canView", true)).toEqual({ ...checkinRow, canView: true });
  });

  it("checking canCreate/canEdit/canDelete also checks canView (mirrors the DB CHECK constraint)", () => {
    expect(applyPermissionToggle(checkinRow, "canCreate", true).canView).toBe(true);
    expect(applyPermissionToggle(checkinRow, "canEdit", true).canView).toBe(true);
    expect(applyPermissionToggle(checkinRow, "canDelete", true).canView).toBe(true);
  });

  it("unchecking canView clears canCreate/canEdit/canDelete", () => {
    const granted: ModulePermissionEntry = { ...checkinRow, canView: true, canCreate: true, canEdit: true, canDelete: true };
    expect(applyPermissionToggle(granted, "canView", false)).toEqual({
      ...checkinRow,
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
    });
  });

  it("unchecking one action leaves canView and the other actions untouched", () => {
    const granted: ModulePermissionEntry = { ...checkinRow, canView: true, canCreate: true, canEdit: true };
    expect(applyPermissionToggle(granted, "canEdit", false)).toEqual({
      ...checkinRow,
      canView: true,
      canCreate: true,
      canEdit: false,
    });
  });

  it("does not mutate the row passed in", () => {
    const original = { ...checkinRow };
    applyPermissionToggle(checkinRow, "canCreate", true);
    expect(checkinRow).toEqual(original);
  });
});
