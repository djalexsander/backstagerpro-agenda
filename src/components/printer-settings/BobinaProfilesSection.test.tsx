import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  toastMock,
  listBobinaProfilesMock,
  saveBobinaProfileMock,
  duplicateBobinaProfileMock,
  deleteBobinaProfileMock,
  setDefaultBobinaProfileMock,
} = vi.hoisted(() => ({
  toastMock: vi.fn(),
  listBobinaProfilesMock: vi.fn(),
  saveBobinaProfileMock: vi.fn(),
  duplicateBobinaProfileMock: vi.fn(),
  deleteBobinaProfileMock: vi.fn(),
  setDefaultBobinaProfileMock: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/lib/bobina-profile-service", () => ({
  listBobinaProfiles: listBobinaProfilesMock,
  saveBobinaProfile: saveBobinaProfileMock,
  duplicateBobinaProfile: duplicateBobinaProfileMock,
  deleteBobinaProfile: deleteBobinaProfileMock,
  setDefaultBobinaProfile: setDefaultBobinaProfileMock,
}));

import { BobinaProfilesSection } from "./BobinaProfilesSection";
import type { BobinaProfile } from "@/lib/bobina-profile-types";

function profile(overrides: Partial<BobinaProfile> = {}): BobinaProfile {
  return {
    id: "profile-1", empresa_id: "company-1", nome: "50x30 - 2 colunas",
    largura_etiqueta_mm: 50, altura_etiqueta_mm: 30, colunas: 2,
    espacamento_horizontal_mm: 3, espacamento_vertical_mm: 2,
    margem_esquerda_mm: 2, margem_direita_mm: 2, margem_superior_mm: 2, margem_inferior_mm: 2,
    orientacao: "retrato", largura_midia_mm: 110, offset_horizontal_mm: 0, offset_vertical_mm: 0,
    dpi: "automatico", dpi_personalizado: null, padrao: true, ativo: true, updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderSection(canManage = true) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <BobinaProfilesSection companyId="company-1" canManage={canManage} />
    </QueryClientProvider>,
  );
}

describe("BobinaProfilesSection", () => {
  beforeEach(() => {
    toastMock.mockReset();
    listBobinaProfilesMock.mockReset().mockResolvedValue([profile()]);
    saveBobinaProfileMock.mockReset().mockResolvedValue(profile({ id: "profile-2", nome: "Novo perfil" }));
    duplicateBobinaProfileMock.mockReset().mockResolvedValue(profile({ id: "profile-3" }));
    deleteBobinaProfileMock.mockReset().mockResolvedValue(undefined);
    setDefaultBobinaProfileMock.mockReset().mockResolvedValue(profile());
  });
  afterEach(() => vi.clearAllMocks());

  it("shows an empty state explaining the legacy fallback when no profile exists", async () => {
    listBobinaProfilesMock.mockResolvedValue([]);
    renderSection();
    expect(await screen.findByText(/Nenhum perfil de bobina cadastrado/i)).toBeInTheDocument();
  });

  it("lists a profile with its dimensions, column count and default badge", async () => {
    renderSection();
    expect(await screen.findByText("50x30 - 2 colunas")).toBeInTheDocument();
    expect(screen.getByText(/50 × 30 mm · 2 colunas/)).toBeInTheDocument();
    expect(screen.getByText("Padrão")).toBeInTheDocument();
  });

  it("hides management actions when canManage is false, but still shows the list", async () => {
    renderSection(false);
    expect(await screen.findByText("50x30 - 2 colunas")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /novo perfil/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /excluir/i })).not.toBeInTheDocument();
  });

  it("creates a new profile via the dialog and refreshes the list", async () => {
    renderSection();
    await screen.findByText("50x30 - 2 colunas");

    fireEvent.click(screen.getByRole("button", { name: /novo perfil/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText(/50x30 - 2 colunas/i), { target: { value: "Nova bobina" } });

    listBobinaProfilesMock.mockResolvedValue([profile(), profile({ id: "profile-2", nome: "Nova bobina", padrao: false })]);
    fireEvent.click(within(dialog).getByRole("button", { name: /salvar perfil/i }));

    await waitFor(() => expect(saveBobinaProfileMock).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ nome: "Nova bobina", colunas: 1 }),
    ));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Perfil de bobina criado" })));
  });

  it("duplicates a profile", async () => {
    renderSection();
    await screen.findByText("50x30 - 2 colunas");
    fireEvent.click(screen.getByRole("button", { name: /duplicar/i }));
    await waitFor(() => expect(duplicateBobinaProfileMock).toHaveBeenCalledWith("company-1", "profile-1"));
  });

  it("sets a non-default profile as the default", async () => {
    listBobinaProfilesMock.mockResolvedValue([profile({ padrao: false })]);
    renderSection();
    await screen.findByText("50x30 - 2 colunas");
    fireEvent.click(screen.getByRole("button", { name: /tornar padrão/i }));
    await waitFor(() => expect(setDefaultBobinaProfileMock).toHaveBeenCalledWith("company-1", "profile-1"));
  });

  it("does not offer 'tornar padrão' for a profile that already is the default", async () => {
    renderSection();
    await screen.findByText("50x30 - 2 colunas");
    expect(screen.queryByRole("button", { name: /tornar padrão/i })).not.toBeInTheDocument();
  });

  it("asks for confirmation before deleting, then calls the delete RPC", async () => {
    renderSection();
    await screen.findByText("50x30 - 2 colunas");
    fireEvent.click(screen.getByRole("button", { name: /excluir/i }));

    const confirmDialog = await screen.findByRole("alertdialog");
    expect(within(confirmDialog).getByText(/50x30 - 2 colunas/)).toBeInTheDocument();
    expect(deleteBobinaProfileMock).not.toHaveBeenCalled();

    fireEvent.click(within(confirmDialog).getByRole("button", { name: /^excluir$/i }));
    await waitFor(() => expect(deleteBobinaProfileMock).toHaveBeenCalledWith("company-1", "profile-1"));
  });
});
