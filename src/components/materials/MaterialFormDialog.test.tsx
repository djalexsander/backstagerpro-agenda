import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialFormDialog } from "./MaterialFormDialog";
import type { MaterialCategory } from "@/lib/material-types";

const category: MaterialCategory = {
  id: "32000000-0000-4000-8000-000000000001",
  empresa_id: "31000000-0000-4000-8000-000000000001",
  nome: "Áudio",
  descricao: null,
  ativo: true,
  created_at: "2026-07-30T00:00:00Z",
  updated_at: "2026-07-30T00:00:00Z",
  created_by: null,
  updated_by: null,
};

function renderNewMaterialDialog(canGenerateIdentification = true) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MaterialFormDialog
        open
        onOpenChange={vi.fn()}
        empresaId="31000000-0000-4000-8000-000000000001"
        categories={[category]}
        material={null}
        canGenerateIdentification={canGenerateIdentification}
        onSaved={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("new material identification controls", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("generates and replaces a barcode inside the New Material dialog", () => {
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("550e8400-e29b-41d4-a716-446655440000")
      .mockReturnValueOnce("650e8400-e29b-41d4-a716-446655440000");
    renderNewMaterialDialog();

    const barcode = screen.getByLabelText(/Código de barras/i);
    fireEvent.click(
      screen.getByRole("button", { name: "Gerar código de barras" }),
    );
    expect(barcode).toHaveValue("BSP-550E8400E29B41D4A716");

    fireEvent.click(
      screen.getByRole("button", { name: "Gerar outro código" }),
    );
    expect(barcode).toHaveValue("BSP-650E8400E29B41D4A716");
  });

  it("shows automatic QR generation enabled by default", () => {
    renderNewMaterialDialog();

    expect(
      screen.getByRole("checkbox", { name: "Gerar QR Code ao salvar" }),
    ).toBeChecked();
    expect(screen.getByText("QR Code preparado no cadastro")).toBeVisible();
  });

  it("does not allow a read-only user to generate or alter identification", () => {
    renderNewMaterialDialog(false);

    expect(
      screen.getByRole("button", { name: "Gerar código de barras" }),
    ).toBeDisabled();
    expect(screen.getByLabelText(/Código de barras/i)).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: "Gerar QR Code ao salvar" }),
    ).toBeDisabled();
  });
});
