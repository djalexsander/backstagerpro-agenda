import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("./MaterialPhotoGallery", () => ({ MaterialPhotoGallery: () => null }));
vi.mock("./MaterialPhotoImage", () => ({ MaterialPhotoImage: () => null }));
vi.mock("./MaterialIdentificationCard", () => ({ MaterialIdentificationCard: () => null }));
vi.mock("./MaterialRfidSection", () => ({ MaterialRfidSection: () => null }));

import { MaterialDetailsDialog } from "./MaterialDetailsDialog";

describe("MaterialDetailsDialog label navigation", () => {
  it("opens labels with the structured primary material id", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}><MemoryRouter>
        <MaterialDetailsDialog
          open
          onOpenChange={vi.fn()}
          companyId="company-a"
          canPrintLabels
          onChanged={vi.fn(async () => undefined)}
          material={{
            id: "11bd7b83-dc2f-43aa-8a4d-73f1d0388a51",
            nome: "line array",
            codigo_interno: "0003",
            status_operacional: "disponivel",
            ativo: true,
            tipo_controle: "individual",
            quantidade: 1,
            unidade_medida: "un",
            estoque_minimo: 0,
            fotos: [],
          } as never}
        />
      </MemoryRouter></QueryClientProvider>,
    );

    expect(screen.getByRole("link", { name: "Criar etiqueta" })).toHaveAttribute(
      "href",
      "/etiquetas?material_id=11bd7b83-dc2f-43aa-8a4d-73f1d0388a51",
    );
  });
});
