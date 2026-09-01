import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  empresaRow: null as Record<string, unknown> | null,
  updatePayloads: [] as Array<Record<string, unknown>>,
  updateEqArgs: [] as Array<[string, unknown]>,
  updateError: null as { code?: string; message?: string } | null,
  refreshProfile: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    empresaId: "company-1",
    role: "admin_empresa",
    isMasterAdmin: false,
    refreshProfile: mocks.refreshProfile,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

vi.mock("@/lib/logo-service", () => ({
  uploadCompanyLogo: vi.fn(),
  removeCompanyLogo: vi.fn(),
}));

// Only `public.empresas` is touched. The read chain
// (select -> eq -> maybeSingle) feeds useEmpresaDados; the write chain
// (update -> eq -> select -> maybeSingle) is the save mutation. We capture
// the payload and the `.eq()` target of every update.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "empresas") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: mocks.empresaRow, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          mocks.updatePayloads.push(payload);
          return {
            eq: (col: string, val: unknown) => {
              mocks.updateEqArgs.push([col, val]);
              const result = {
                data: mocks.updateError ? null : { ...(mocks.empresaRow ?? {}), ...payload },
                error: mocks.updateError,
              };
              return {
                select: () => ({ maybeSingle: () => Promise.resolve(result) }),
                then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
              };
            },
          };
        },
      };
    },
  },
}));

import ConfiguracoesEmpresa from "./ConfiguracoesEmpresa";

const baseRow = {
  id: "company-1",
  nome_empresa: "Alex Produções",
  razao_social: "Alex Produções Artísticas LTDA",
  cpf_cnpj: "12345678000190",
  email: "contato@alex.com",
  telefone: "1140028922",
  whatsapp: null,
  cep: "01310100",
  endereco: "Av. Paulista",
  numero: "1000",
  complemento: null,
  bairro: "Bela Vista",
  cidade: "São Paulo",
  estado: "SP",
  logo_url: null,
};

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConfiguracoesEmpresa />
    </QueryClientProvider>,
  );
}

describe("ConfiguracoesEmpresa", () => {
  beforeEach(() => {
    mocks.empresaRow = { ...baseRow };
    mocks.updatePayloads = [];
    mocks.updateEqArgs = [];
    mocks.updateError = null;
    mocks.refreshProfile.mockReset();
    mocks.toast.mockReset();
  });

  it("carrega os dados da empresa atual nos campos", async () => {
    renderPage();

    expect(await screen.findByDisplayValue("Alex Produções")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Alex Produções Artísticas LTDA")).toBeInTheDocument();
    expect(screen.getByDisplayValue("12345678000190")).toBeInTheDocument();
    expect(screen.getByDisplayValue("contato@alex.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("São Paulo")).toBeInTheDocument();
  });

  it("salva as alterações com o payload normalizado, escopado na empresa do useAuth", async () => {
    renderPage();

    const telefone = await screen.findByDisplayValue("1140028922");
    fireEvent.change(telefone, { target: { value: "11999998888" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar/i }));

    await waitFor(() => expect(mocks.updatePayloads).toHaveLength(1));
    expect(mocks.updatePayloads[0]).toMatchObject({
      nome_empresa: "Alex Produções",
      telefone: "11999998888",
      cpf_cnpj: "12345678000190",
      cidade: "São Paulo",
      estado: "SP",
    });
    expect(mocks.updateEqArgs[0]).toEqual(["id", "company-1"]);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Dados da empresa salvos!" })),
    );
    expect(mocks.refreshProfile).toHaveBeenCalled();
  });

  it("isolamento: o update é sempre .eq('id', <empresaId do useAuth>) e o payload nunca carrega id", async () => {
    renderPage();

    const nome = await screen.findByDisplayValue("Alex Produções");
    fireEvent.change(nome, { target: { value: "Empresa Renomeada" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar/i }));

    await waitFor(() => expect(mocks.updateEqArgs).toHaveLength(1));
    expect(mocks.updateEqArgs[0]).toEqual(["id", "company-1"]);
    expect(mocks.updatePayloads[0]).not.toHaveProperty("id");
  });

  it("mapeia o erro de CNPJ duplicado (23505) para um toast destrutivo", async () => {
    mocks.updateError = { code: "23505", message: "duplicate key value violates unique constraint" };
    renderPage();

    await screen.findByDisplayValue("Alex Produções");
    fireEvent.click(screen.getByRole("button", { name: /salvar/i }));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          description: expect.stringContaining("já está cadastrado em outra empresa"),
        }),
      ),
    );
  });

  it("bloqueia o salvamento (sem chamar o update) quando o CPF/CNPJ tem tamanho inválido", async () => {
    renderPage();

    const documento = await screen.findByDisplayValue("12345678000190");
    fireEvent.change(documento, { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: /salvar/i }));

    expect(await screen.findByText(/CPF \(11 dígitos\) ou CNPJ \(14 dígitos\)/i)).toBeInTheDocument();
    expect(mocks.updatePayloads).toHaveLength(0);
  });

  it("renderiza com todos os campos opcionais vazios sem quebrar", async () => {
    mocks.empresaRow = {
      id: "company-1",
      nome_empresa: "Só o Nome",
      razao_social: null,
      cpf_cnpj: null,
      email: null,
      telefone: null,
      whatsapp: null,
      cep: null,
      endereco: null,
      numero: null,
      complemento: null,
      bairro: null,
      cidade: null,
      estado: null,
      logo_url: null,
    };
    renderPage();

    expect(await screen.findByDisplayValue("Só o Nome")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /salvar/i })).toBeEnabled();
  });
});
