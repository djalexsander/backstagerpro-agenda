import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { NewRentalDialog } from "./NewRentalDialog";
import type { CustodyResponsibleOption } from "@/lib/checkin-checkout-types";
import type { CustomerOption } from "@/lib/material-rental-types";

function makeCustomer(overrides: Partial<CustomerOption> & { id: string; nome: string }): CustomerOption {
  return {
    tipo_pessoa: "pessoa_fisica",
    nome_fantasia: null,
    cpf_cnpj: null,
    email: null,
    telefone: null,
    observacoes: null,
    ativo: true,
    ...overrides,
  };
}

const djAlex = makeCustomer({
  id: "c-dj-alex",
  nome: "DJ ALEX EVENTOS LTDA",
  nome_fantasia: "DJ ALEX EVENTOS",
  cpf_cnpj: "12.345.678/0001-90",
});
const outroCliente = makeCustomer({ id: "c-outro", nome: "Outro Cliente", telefone: "(11) 99999-0000" });
const baseCustomers = [djAlex, outroCliente];

const responsibles: CustodyResponsibleOption[] = [
  { tipo: "usuario", id: "user-1", nome: "Operador", detalhe: "Equipe interna" },
];

function mockRpcSearch(pool: CustomerOption[]) {
  rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
    if (name === "listar_clientes") {
      const busca = typeof args?._busca === "string" ? args._busca.toLowerCase() : "";
      const limit = typeof args?._limite === "number" ? args._limite : 150;
      const filtered = pool.filter(
        (customer) =>
          !busca ||
          customer.nome.toLowerCase().includes(busca) ||
          (customer.nome_fantasia?.toLowerCase().includes(busca) ?? false),
      );
      return Promise.resolve({ data: filtered.slice(0, limit), error: null });
    }
    if (name === "salvar_cliente") {
      const created = makeCustomer({
        id: "c-new",
        nome: String(args?._nome ?? ""),
      });
      return Promise.resolve({ data: created, error: null });
    }
    if (name === "criar_locacao_material") {
      return Promise.resolve({ data: { id: "rental-1", numero: "LOC-0001" }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
}

function renderDialog({
  customers = baseCustomers,
  onCreated = vi.fn(),
  onCustomerCreated = vi.fn(),
}: {
  customers?: CustomerOption[];
  onCreated?: (id: string) => void;
  onCustomerCreated?: () => Promise<void> | void;
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <NewRentalDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        customers={customers}
        responsibles={responsibles}
        onCreated={onCreated}
        onCustomerCreated={onCustomerCreated}
      />
    </QueryClientProvider>,
  );
  return { onCreated, onCustomerCreated };
}

const SEARCH_PLACEHOLDER = "Nome, CPF/CNPJ, telefone ou e-mail...";

function openCombobox() {
  fireEvent.click(screen.getByRole("combobox", { name: "Cliente" }));
}

describe("NewRentalDialog - combobox de cliente", () => {
  beforeAll(() => {
    // cmdk's <Command> chama ResizeObserver (CommandList) e scrollIntoView
    // (navegação por teclado) internamente - jsdom 20 não implementa
    // nenhum dos dois, então sem esses stubs qualquer teste que abra o
    // combobox quebra com "not a function", nada relacionado à lógica
    // sendo testada.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    rpc.mockReset();
    mockRpcSearch(baseCustomers);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("abre o combobox ao clicar no campo e mostra a lista já carregada, sem round-trip extra", async () => {
    renderDialog();
    openCombobox();

    expect(await screen.findByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument();
    expect(await screen.findByText("DJ ALEX EVENTOS")).toBeInTheDocument();
    expect(screen.getByText("Outro Cliente")).toBeInTheDocument();
    // Lista inicial vem da prop `customers` (já em cache pela página) - a
    // busca por RPC só dispara quando o operador digita algo.
    expect(rpc).not.toHaveBeenCalledWith("listar_clientes", expect.anything());
  });

  it("filtra por nome ao digitar, buscando no servidor (debounced)", async () => {
    renderDialog();
    openCombobox();
    fireEvent.change(await screen.findByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: "DJ ALE" } });

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        "listar_clientes",
        expect.objectContaining({ _busca: "DJ ALE", _empresa_id: "company-1" }),
      ),
    );
    expect(await screen.findByText("DJ ALEX EVENTOS")).toBeInTheDocument();
    expect(screen.queryByText("Outro Cliente")).not.toBeInTheDocument();
  });

  it("seleciona um cliente com o mouse e mostra o nome escolhido no campo", async () => {
    renderDialog();
    openCombobox();

    fireEvent.click(await screen.findByText("DJ ALEX EVENTOS"));

    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Cliente" })).toHaveTextContent("DJ ALEX EVENTOS");
  });

  it("seleciona um cliente com o teclado (seta para baixo + Enter)", async () => {
    renderDialog();
    openCombobox();
    const input = await screen.findByPlaceholderText(SEARCH_PLACEHOLDER);

    // DJ ALEX é o primeiro item e já nasce ativo por padrão no cmdk - sem
    // mover a seta, Enter selecionaria ele. Uma seta para baixo prova que a
    // navegação por teclado está de fato movendo a seleção para o segundo.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("combobox", { name: "Cliente" })).toHaveTextContent("Outro Cliente");
  });

  it("mostra estado de zero resultados e permite cadastrar rápido a partir do texto digitado", async () => {
    renderDialog();
    openCombobox();
    fireEvent.change(await screen.findByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: "Ninguem Com Esse Nome" } });

    await waitFor(() => expect(screen.getByText("Nenhum cliente encontrado.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar novo cliente" }));

    // Popover fecha e o texto digitado pré-preenche o cadastro rápido -
    // sem duplicar a chamada de criação automaticamente.
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalledWith("salvar_cliente", expect.anything());
    const quickInput = screen.getByPlaceholderText("Ou cadastre rapidamente um novo cliente") as HTMLInputElement;
    expect(quickInput.value).toBe("Ninguem Com Esse Nome");
  });

  it("cadastro rápido continua funcionando e o novo cliente aparece selecionado no combobox", async () => {
    const { onCustomerCreated } = renderDialog();
    fireEvent.change(screen.getByPlaceholderText("Ou cadastre rapidamente um novo cliente"), {
      target: { value: "Cliente Novo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar cliente" }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        "salvar_cliente",
        expect.objectContaining({ _empresa_id: "company-1", _nome: "Cliente Novo" }),
      ),
    );
    await waitFor(() => expect(onCustomerCreated).toHaveBeenCalled());
    expect(screen.getByRole("combobox", { name: "Cliente" })).toHaveTextContent("Cliente Novo");
    expect((screen.getByPlaceholderText("Ou cadastre rapidamente um novo cliente") as HTMLInputElement).value).toBe("");
  });

  it("salva a locação com o cliente selecionado no combobox", async () => {
    const { onCreated } = renderDialog();
    openCombobox();
    fireEvent.click(await screen.findByText("DJ ALEX EVENTOS"));

    fireEvent.click(screen.getByRole("button", { name: "Criar e adicionar materiais" }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        "criar_locacao_material",
        expect.objectContaining({ _empresa_id: "company-1", _cliente_id: "c-dj-alex" }),
      ),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("rental-1"));
  });

  it("não cria locação sem cliente selecionado", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Criar e adicionar materiais" }));

    expect(screen.getByRole("heading", { name: "Nova locação" })).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalledWith("criar_locacao_material", expect.anything());
  });

  it("limita a lista renderizada mesmo com muitos clientes carregados, sem travar a interface", async () => {
    const manyCustomers = Array.from({ length: 200 }, (_, index) =>
      makeCustomer({ id: `c-${index}`, nome: `Cliente ${String(index).padStart(3, "0")}` }),
    );
    renderDialog({ customers: manyCustomers });
    openCombobox();

    await screen.findByPlaceholderText(SEARCH_PLACEHOLDER);
    const options = screen.getAllByRole("option");
    expect(options.length).toBeLessThanOrEqual(20);
    expect(screen.getByText(/Mostrando 20 de 200\+ clientes/)).toBeInTheDocument();
  });

  it("sempre busca clientes isolados pela empresa atual (_empresa_id)", async () => {
    renderDialog();
    openCombobox();
    fireEvent.change(await screen.findByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: "Outro" } });

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("listar_clientes", expect.anything()));
    const clienteCalls = rpc.mock.calls.filter(([name]) => name === "listar_clientes");
    expect(clienteCalls.length).toBeGreaterThan(0);
    for (const [, args] of clienteCalls) {
      expect((args as Record<string, unknown>)._empresa_id).toBe("company-1");
    }
  });
});
