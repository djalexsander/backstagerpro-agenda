import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { UserModulePermissionsFields } from "./UserModulePermissionsFields";
import type { ModulePermissionEntry } from "@/lib/user-module-permissions-service";

// applyPermissionToggle/groupPermissionRows (the view<->other-actions rule and
// the sidebar-matching categorization) are pure domain logic that live in,
// and are unit-tested by, user-module-permissions-service.ts/.test.ts. The
// tests below exercise that logic end-to-end through real clicks/renders.

const checkinRow: ModulePermissionEntry = {
  featureKey: "checkin_checkout",
  moduleName: "Check-in / Check-out",
  canView: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
};

const financeiroRow: ModulePermissionEntry = {
  featureKey: "financeiro_avancado",
  moduleName: "Financeiro",
  canView: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
};

describe("UserModulePermissionsFields", () => {
  beforeAll(() => {
    // Radix Collapsible/Checkbox need a pointer-events-capable environment check in jsdom.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("shows a loading message instead of the checklist while loading", () => {
    render(<UserModulePermissionsFields rows={[]} onChange={vi.fn()} isLoading />);
    expect(screen.getByText(/carregando permiss/i)).toBeInTheDocument();
  });

  it("shows an explanatory empty state when the company has no active modules", () => {
    render(<UserModulePermissionsFields rows={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/não possui módulos ativos/i)).toBeInTheDocument();
  });

  it("groups modules under their sidebar-matching category, each with a module count", () => {
    render(<UserModulePermissionsFields rows={[checkinRow, financeiroRow]} onChange={vi.fn()} />);
    expect(screen.getByText("Materiais & Operações")).toBeInTheDocument();
    expect(screen.getByText("Administração")).toBeInTheDocument();
    // One module in each category here, so "(1)" appears twice - not ambiguous-throwing getByText.
    expect(screen.getAllByText("(1)")).toHaveLength(2);
  });

  it("shows the 4 action column headers once per open category, not once per module", () => {
    render(
      <UserModulePermissionsFields
        rows={[checkinRow, { ...checkinRow, featureKey: "controle_estoque", moduleName: "Estoque" }]}
        onChange={vi.fn()}
      />,
    );
    // Both modules land in "Materiais & Operações" - the header text appears exactly once for the whole group.
    expect(screen.getAllByText("Visualizar")).toHaveLength(1);
    expect(screen.getAllByText("Adicionar/Executar")).toHaveLength(1);
    expect(screen.getByText("Check-in / Check-out")).toBeInTheDocument();
    expect(screen.getByText("Estoque")).toBeInTheDocument();
  });

  it("reflects the granted flags as checked checkboxes, keyed by module via aria-label", () => {
    render(<UserModulePermissionsFields rows={[financeiroRow]} onChange={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Visualizar - Financeiro" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Excluir - Financeiro" })).toBeChecked();
  });

  it("a brand-new user's template (all-false rows) never renders a pre-checked box", () => {
    render(<UserModulePermissionsFields rows={[checkinRow]} onChange={vi.fn()} />);
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).not.toBeChecked();
    }
  });

  it("collapses and re-expands a category, hiding and restoring its module rows", () => {
    render(<UserModulePermissionsFields rows={[checkinRow]} onChange={vi.fn()} />);
    expect(screen.getByText("Check-in / Check-out")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Materiais & Operações/ }));
    expect(screen.queryByText("Check-in / Check-out")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Materiais & Operações/ }));
    expect(screen.getByText("Check-in / Check-out")).toBeInTheDocument();
  });

  it("calls onChange with the toggled row (checking Excluir also grants Visualizar)", () => {
    const onChange = vi.fn();
    render(<UserModulePermissionsFields rows={[checkinRow]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Excluir - Check-in / Check-out" }));

    expect(onChange).toHaveBeenCalledWith([{ ...checkinRow, canView: true, canDelete: true }]);
  });

  it("unchecking Visualizar clears the other 3 actions for that module", () => {
    const onChange = vi.fn();
    render(<UserModulePermissionsFields rows={[financeiroRow]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Visualizar - Financeiro" }));

    expect(onChange).toHaveBeenCalledWith([
      { ...financeiroRow, canView: false, canCreate: false, canEdit: false, canDelete: false },
    ]);
  });

  it("'Marcar todos' grants all 4 actions to every module in that category only", () => {
    const rentalRow: ModulePermissionEntry = {
      featureKey: "locacao_materiais",
      moduleName: "Locações",
      canView: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
    };
    const onChange = vi.fn();
    const { rerender } = render(
      <UserModulePermissionsFields rows={[checkinRow, rentalRow, financeiroRow]} onChange={onChange} />,
    );

    const materiaisGroup = screen.getByTestId("permission-category-materiais-operacoes");
    fireEvent.click(within(materiaisGroup).getByRole("button", { name: "Marcar todos" }));

    expect(onChange).toHaveBeenCalledWith([
      { ...checkinRow, canView: true, canCreate: true, canEdit: true, canDelete: true },
      { ...rentalRow, canView: true, canCreate: true, canEdit: true, canDelete: true },
      financeiroRow, // untouched - different category
    ]);

    onChange.mockClear();
    rerender(<UserModulePermissionsFields rows={[checkinRow, rentalRow, financeiroRow]} onChange={onChange} />);
    const adminGroup = screen.getByTestId("permission-category-administracao");
    fireEvent.click(within(adminGroup).getByRole("button", { name: "Limpar todos" }));

    expect(onChange).toHaveBeenCalledWith([
      checkinRow,
      rentalRow,
      { ...financeiroRow, canView: false, canCreate: false, canEdit: false, canDelete: false },
    ]);
  });
});
