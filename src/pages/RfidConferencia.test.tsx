import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// P1 fix: the "Conferência de locação" session type cross-references
// locacao_materiais - without the module it led to an always-empty picker
// instead of a real workflow. This suite only exercises the Select's
// available options, not the rest of the RFID lab workflow.
const { authState, moduleState } = vi.hoisted(() => ({
  authState: {
    role: "admin_empresa" as string | null,
    empresaId: "company-1" as string | null,
    empresaReadOnly: false,
    isMasterAdmin: false,
  },
  moduleState: { enabledKeys: new Set<string>(["rfid_materiais", "gestao_materiais", "locacao_materiais"]) },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/useCompanyModules", () => ({
  useCompanyModules: () => ({
    hasModule: (featureKey: string) => moduleState.enabledKeys.has(featureKey),
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useModulePermission", () => ({
  useModulePermission: () => ({ permission: null, isLoading: false }),
}));
vi.mock("@/lib/material-service", () => ({ listMaterials: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/material-rental-service", () => ({
  getMaterialRental: vi.fn(),
  listMaterialRentals: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));
vi.mock("@/lib/rfid-service", () => ({
  finishReadSession: vi.fn(),
  recordReadSessionEpcs: vi.fn(),
  resolveEpcs: vi.fn().mockResolvedValue([]),
  startReadSession: vi.fn(),
}));
vi.mock("@/lib/terminal-rfid-config", () => ({ getTerminalRfidReaderConfig: vi.fn().mockReturnValue(null) }));

type SelectShimProps = {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
};

// Radix Select não abre de forma confiável no jsdom (pointer capture) - mesmo
// shim de <select> nativo já usado em Documentos.test.tsx.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: SelectShimProps) => (
    <select
      aria-label="tipo de sessão"
      value={value || ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: SelectShimProps) => <>{children}</>,
  SelectItem: ({ value, children }: SelectShimProps) => <option value={value}>{children}</option>,
}));

import RfidConferencia from "./RfidConferencia";

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RfidConferencia />
    </QueryClientProvider>,
  );
}

describe("RfidConferencia - P1: 'Conferência de locação' hidden without locacao_materiais", () => {
  beforeEach(() => {
    authState.role = "admin_empresa";
    authState.empresaId = "company-1";
    authState.isMasterAdmin = false;
    moduleState.enabledKeys = new Set(["rfid_materiais", "gestao_materiais", "locacao_materiais"]);
  });

  it("lists 'Conferência de locação' among the session types when locacao_materiais is active", async () => {
    renderPage();

    expect(await screen.findByRole("option", { name: /conferência de locação/i })).toBeInTheDocument();
    // Sanity: unrelated types are always present regardless of the module.
    expect(screen.getByRole("option", { name: /^inventário$/i })).toBeInTheDocument();
  });

  it("hides 'Conferência de locação' when locacao_materiais is inactive", async () => {
    moduleState.enabledKeys = new Set(["rfid_materiais", "gestao_materiais"]);
    renderPage();

    expect(await screen.findByRole("option", { name: /^inventário$/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /conferência de locação/i })).not.toBeInTheDocument();
  });

  it("a linked master_admin sees 'Conferência de locação' even with locacao_materiais inactive (existing bypass, not a new one)", async () => {
    authState.isMasterAdmin = true;
    moduleState.enabledKeys = new Set(["rfid_materiais", "gestao_materiais"]);
    renderPage();

    expect(await screen.findByRole("option", { name: /conferência de locação/i })).toBeInTheDocument();
  });
});
