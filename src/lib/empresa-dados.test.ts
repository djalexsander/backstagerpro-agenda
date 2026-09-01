import { describe, expect, it } from "vitest";
import {
  BR_UFS,
  emptyEmpresaForm,
  empresaFormFromDados,
  formatEmpresaCep,
  formatEmpresaCidadeUf,
  formatEmpresaDocumento,
  formatEmpresaEndereco,
  formatEmpresaEnderecoCompleto,
  isCompleteEmpresaCep,
  isValidEmpresaDocumento,
  normalizeEmpresaForm,
  type EmpresaDados,
} from "./empresa-dados";

const fullDados: EmpresaDados = {
  id: "company-1",
  nome_empresa: "Alex Produções",
  razao_social: "Alex Produções Artísticas LTDA",
  cpf_cnpj: "12345678000190",
  email: "contato@alex.com",
  telefone: "(11) 4002-8922",
  whatsapp: "(11) 99999-0000",
  cep: "01310100",
  endereco: "Av. Paulista",
  numero: "1000",
  complemento: "Sala 12",
  bairro: "Bela Vista",
  cidade: "São Paulo",
  estado: "SP",
  logo_url: "https://example.com/logo.png",
};

describe("empresaFormFromDados", () => {
  it("returns an all-empty form when there is no company row", () => {
    expect(empresaFormFromDados(null)).toEqual(emptyEmpresaForm());
    expect(empresaFormFromDados(undefined)).toEqual(emptyEmpresaForm());
  });

  it("maps every field and turns null columns into empty strings", () => {
    const form = empresaFormFromDados({
      ...fullDados,
      razao_social: null,
      complemento: null,
      estado: null,
    });
    expect(form.nome_empresa).toBe("Alex Produções");
    expect(form.cidade).toBe("São Paulo");
    expect(form.razao_social).toBe("");
    expect(form.complemento).toBe("");
    expect(form.estado).toBe("");
  });
});

describe("normalizeEmpresaForm", () => {
  it("trims text, keeps only digits in cpf_cnpj/cep and uppercases the UF", () => {
    const payload = normalizeEmpresaForm({
      ...emptyEmpresaForm(),
      nome_empresa: "  Alex Produções  ",
      cpf_cnpj: "12.345.678/0001-90",
      cep: "01310-100",
      estado: "sp",
      cidade: "  São Paulo ",
    });
    expect(payload.nome_empresa).toBe("Alex Produções");
    expect(payload.cpf_cnpj).toBe("12345678000190");
    expect(payload.cep).toBe("01310100");
    expect(payload.estado).toBe("SP");
    expect(payload.cidade).toBe("São Paulo");
  });

  it("turns blank optional fields into null but never nulls nome_empresa", () => {
    const payload = normalizeEmpresaForm({
      ...emptyEmpresaForm(),
      nome_empresa: "Alex",
    });
    expect(payload.nome_empresa).toBe("Alex");
    expect(payload.razao_social).toBeNull();
    expect(payload.cpf_cnpj).toBeNull();
    expect(payload.email).toBeNull();
    expect(payload.telefone).toBeNull();
    expect(payload.whatsapp).toBeNull();
    expect(payload.cep).toBeNull();
    expect(payload.endereco).toBeNull();
    expect(payload.numero).toBeNull();
    expect(payload.complemento).toBeNull();
    expect(payload.bairro).toBeNull();
    expect(payload.cidade).toBeNull();
    expect(payload.estado).toBeNull();
  });
});

describe("isValidEmpresaDocumento", () => {
  it("accepts null (optional), 11-digit CPF and 14-digit CNPJ, rejects anything else", () => {
    expect(isValidEmpresaDocumento(null)).toBe(true);
    expect(isValidEmpresaDocumento("12345678909")).toBe(true);
    expect(isValidEmpresaDocumento("12345678000190")).toBe(true);
    expect(isValidEmpresaDocumento("123")).toBe(false);
    expect(isValidEmpresaDocumento("123456789012")).toBe(false);
  });
});

describe("isCompleteEmpresaCep", () => {
  it("accepts null or exactly 8 digits", () => {
    expect(isCompleteEmpresaCep(null)).toBe(true);
    expect(isCompleteEmpresaCep("01310100")).toBe(true);
    expect(isCompleteEmpresaCep("013101")).toBe(false);
  });
});

describe("formatEmpresaDocumento", () => {
  it("masks CPF, CNPJ, and passes through unknown lengths / empty", () => {
    expect(formatEmpresaDocumento("12345678909")).toBe("123.456.789-09");
    expect(formatEmpresaDocumento("12345678000190")).toBe("12.345.678/0001-90");
    expect(formatEmpresaDocumento("123")).toBe("123");
    expect(formatEmpresaDocumento(null)).toBe("");
    expect(formatEmpresaDocumento(undefined)).toBe("");
  });
});

describe("formatEmpresaCep", () => {
  it("masks 8 digits and passes through the rest", () => {
    expect(formatEmpresaCep("01310100")).toBe("01310-100");
    expect(formatEmpresaCep("013")).toBe("013");
    expect(formatEmpresaCep(null)).toBe("");
  });
});

describe("formatEmpresaCidadeUf", () => {
  it("joins city and UF, tolerating missing parts", () => {
    expect(formatEmpresaCidadeUf({ cidade: "São Paulo", estado: "SP" })).toBe("São Paulo/SP");
    expect(formatEmpresaCidadeUf({ cidade: "São Paulo", estado: null })).toBe("São Paulo");
    expect(formatEmpresaCidadeUf({ cidade: null, estado: "SP" })).toBe("SP");
    expect(formatEmpresaCidadeUf({ cidade: null, estado: null })).toBe("");
    expect(formatEmpresaCidadeUf({})).toBe("");
  });
});

describe("formatEmpresaEndereco", () => {
  it("builds one line from street/number/complement/neighbourhood", () => {
    expect(formatEmpresaEndereco(fullDados)).toBe("Av. Paulista, 1000, Sala 12 — Bela Vista");
  });

  it("tolerates partial data and returns empty when there is nothing", () => {
    expect(formatEmpresaEndereco({ endereco: "Av. Paulista", numero: null, bairro: "Centro" }))
      .toBe("Av. Paulista — Centro");
    expect(formatEmpresaEndereco({ endereco: "Rua A" })).toBe("Rua A");
    expect(formatEmpresaEndereco({})).toBe("");
    expect(formatEmpresaEndereco({ endereco: null, numero: null, complemento: null, bairro: null }))
      .toBe("");
  });
});

describe("formatEmpresaEnderecoCompleto", () => {
  it("includes city/UF and CEP", () => {
    expect(formatEmpresaEnderecoCompleto(fullDados)).toBe(
      "Av. Paulista, 1000, Sala 12 — Bela Vista — São Paulo/SP — CEP 01310-100",
    );
  });

  it("returns empty string when the company has no address at all", () => {
    expect(formatEmpresaEnderecoCompleto({})).toBe("");
    expect(
      formatEmpresaEnderecoCompleto({
        endereco: null,
        numero: null,
        complemento: null,
        bairro: null,
        cidade: null,
        estado: null,
        cep: null,
      }),
    ).toBe("");
  });
});

describe("BR_UFS", () => {
  it("has the 27 federative units", () => {
    expect(BR_UFS).toHaveLength(27);
    expect(BR_UFS).toContain("SP");
    expect(BR_UFS).toContain("DF");
  });
});
