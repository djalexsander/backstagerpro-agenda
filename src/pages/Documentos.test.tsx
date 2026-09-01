import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SelectShimProps = {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
};

const mocks = vi.hoisted(() => ({
  empresaDados: null as Record<string, unknown> | null,
  templates: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  generatedInserts: [] as Array<Record<string, unknown>>,
  resolveTemplate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    empresaId: "company-1",
    empresaNome: "Alex Produções",
    empresaLogoUrl: null,
    empresaReadOnly: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

vi.mock("@/hooks/useEmpresaDados", () => ({
  useEmpresaDados: () => ({ data: mocks.empresaDados, isLoading: false }),
}));

vi.mock("@/lib/document-placeholders", () => ({
  resolveDocumentTemplateContent: mocks.resolveTemplate,
}));

// Radix Select não abre de forma confiável no jsdom (pointer capture). Um
// shim de <select> nativo mantém o fluxo "escolher evento -> Gerar" testável.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: SelectShimProps) => (
    <select
      data-testid="native-select"
      value={value || ""}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      <option value="" hidden />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: SelectShimProps) => <>{children}</>,
  SelectItem: ({ value, children }: SelectShimProps) => <option value={value}>{children}</option>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          order: () => {
            if (table === "document_templates") return Promise.resolve({ data: mocks.templates, error: null });
            if (table === "events") return Promise.resolve({ data: mocks.events, error: null });
            return Promise.resolve({ data: [], error: null });
          },
        }),
      }),
      insert: (payload: Record<string, unknown>) => {
        if (table === "generated_documents") mocks.generatedInserts.push(payload);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import Documentos from "./Documentos";

const template = {
  id: "tpl-1",
  nome: "Contrato Padrão",
  tipo: "contrato",
  conteudo: "CONTRATADA: {{empresa_nome}} - CNPJ {{empresa_cnpj}}",
  created_at: "2026-09-01T12:00:00Z",
};

const evento = {
  id: "event-1",
  name: "Festival Backstage",
  date: "2026-09-10",
  city: "São Paulo",
  venue: "Arena",
  artist: "Banda Teste",
  show_time: "21:00:00",
  observations: null,
};

const fullEmpresa = {
  id: "company-1",
  nome_empresa: "Alex Produções",
  razao_social: "Alex Produções LTDA",
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
      <Documentos />
    </QueryClientProvider>,
  );
}

async function generateFromFirstTemplate() {
  fireEvent.click(await screen.findByRole("button", { name: "Gerar" }));
  fireEvent.change(await screen.findByTestId("native-select"), { target: { value: "event-1" } });
  fireEvent.click(screen.getByRole("button", { name: /gerar documento/i }));
}

describe("Documentos - dados da empresa nos documentos gerados", () => {
  beforeEach(() => {
    mocks.empresaDados = { ...fullEmpresa };
    mocks.templates = [template];
    mocks.events = [evento];
    mocks.generatedInserts = [];
    mocks.resolveTemplate.mockReset();
    mocks.resolveTemplate.mockResolvedValue("CONTEUDO FINAL");
    mocks.toast.mockReset();
  });

  it("passa os dados da empresa atual (useEmpresaDados) para o resolver de placeholders", async () => {
    renderPage();
    await generateFromFirstTemplate();

    await waitFor(() => expect(mocks.resolveTemplate).toHaveBeenCalledTimes(1));
    const args = mocks.resolveTemplate.mock.calls[0][0];
    expect(args.company).toEqual(fullEmpresa);
    expect(args.companyName).toBe("Alex Produções");
    expect(typeof args.templateContent).toBe("string");

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Documento gerado com sucesso!" }),
      ),
    );
    expect(mocks.generatedInserts[0]).toMatchObject({
      empresa_id: "company-1",
      conteudo_final: "CONTEUDO FINAL",
    });
  });

  it("gera normalmente quando a empresa tem só o nome (demais campos vazios)", async () => {
    mocks.empresaDados = {
      id: "company-1",
      nome_empresa: "Alex Produções",
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
    await generateFromFirstTemplate();

    await waitFor(() => expect(mocks.resolveTemplate).toHaveBeenCalledTimes(1));
    expect(mocks.resolveTemplate.mock.calls[0][0].company).toEqual(mocks.empresaDados);
    await waitFor(() => expect(mocks.generatedInserts).toHaveLength(1));
  });
});
