import { describe, expect, it } from "vitest";
import {
  deriveCustodyStatus,
  getCustodyMaterialActions,
  materialMatchesCustodyIdentifier,
  normalizeCustodyScan,
  validateCheckin,
  validateCheckout,
} from "./checkin-checkout-domain";
import type {
  CheckinInput,
  CheckoutInput,
  CustodyMaterialSearchResult,
} from "./checkin-checkout-types";

const material: CustodyMaterialSearchResult = {
  id: "6ad882a7-28de-4fb2-a2ee-dcc426d478da",
  nome: "Mesa de Som Principal",
  codigo_interno: "MESA-001",
  identificador_unico: "15b13cd1-6921-49a4-b67d-54c1b0e39acc",
  codigo_barras: "BSP-1234567890ABCDEF1234",
  conteudo_qr_code:
    "BACKSTAGE-PRO:MATERIAL:15b13cd1-6921-49a4-b67d-54c1b0e39acc",
  numero_patrimonio: "PAT-900",
  numero_serie: "SERIE-XY",
  tipo_controle: "individual",
  status_operacional: "disponivel",
  ativo: true,
  unidade_medida: "unidade",
  foto_path: null,
  saldos: [
    {
      localizacao_id: "d668ca10-623d-492d-9f04-e57ea5a7c075",
      localizacao_codigo: "DEP",
      localizacao_nome: "Depósito",
      localizacao_ativa: true,
      quantidade: 1,
    },
  ],
  custodias_abertas: [],
};

const checkout: CheckoutInput = {
  materialId: material.id,
  quantity: 1,
  originLocationId: material.saldos[0].localizacao_id,
  responsibleType: "funcionario",
  responsibleId: "3cda43fd-d8b3-4e8f-8942-3dc26221c3b1",
  purpose: "uso_interno",
  condition: "bom",
  clientUuid: "38190048-f440-4393-bafc-e0f89f89c109",
};

describe("check-in/check-out domain", () => {
  it("normalizes keyboard scanners without changing identifier content", () => {
    expect(normalizeCustodyScan("\tMESA-001\r\n")).toBe("MESA-001");
  });

  it.each([
    material.id,
    material.identificador_unico!,
    material.conteudo_qr_code!,
    material.codigo_barras!,
    material.codigo_interno,
    material.numero_patrimonio!,
    material.numero_serie!,
    "mesa de som",
  ])("identifies material by %s", (identifier) => {
    expect(materialMatchesCustodyIdentifier(material, identifier)).toBe(true);
  });

  it("shows only checkout while an individual item is available", () => {
    expect(getCustodyMaterialActions(material)).toEqual({
      available: 1,
      pending: 0,
      canCheckout: true,
      canCheckin: false,
    });
  });

  it("shows only checkin while an individual item is in custody", () => {
    expect(
      getCustodyMaterialActions({
        ...material,
        saldos: [],
        custodias_abertas: [
          {
            id: "0452577c-a907-4e87-aeb0-c07934ef9c27",
            quantidade_retirada: 1,
            quantidade_devolvida: 0,
            quantidade_pendente: 1,
            responsavel_nome: "Técnico",
            retirada_em: "2026-08-02T12:00:00.000Z",
            previsao_retorno: null,
            status: "aberta",
          },
        ],
      }),
    ).toMatchObject({ canCheckout: false, canCheckin: true });
  });

  it("allows quantity checkout only within the selected official balance", () => {
    const quantitative = {
      ...material,
      tipo_controle: "quantidade" as const,
      saldos: [{ ...material.saldos[0], quantidade: 20 }],
    };
    expect(validateCheckout({ ...checkout, quantity: 20 }, quantitative)).toEqual({});
    expect(validateCheckout({ ...checkout, quantity: 21 }, quantitative)).toHaveProperty(
      "quantity",
    );
  });

  it("rejects non-unit quantity for individual materials", () => {
    expect(validateCheckout({ ...checkout, quantity: 2 }, material)).toHaveProperty(
      "quantity",
    );
  });

  it("rejects inactive origin and missing responsible", () => {
    expect(
      validateCheckout(
        { ...checkout, responsibleId: "" },
        { ...material, saldos: [{ ...material.saldos[0], localizacao_ativa: false }] },
      ),
    ).toMatchObject({ originLocationId: expect.any(String), responsibleId: expect.any(String) });
  });

  it("validates partial and total checkins against pending quantity", () => {
    const input: CheckinInput = {
      custodyId: "7a002b5a-2ca2-4228-bf91-80583fa26610",
      quantity: 15,
      destinationLocationId: material.saldos[0].localizacao_id,
      returnCondition: "bom",
      clientUuid: "d1456bb1-476c-455b-83a1-f507c828afc6",
    };
    expect(validateCheckin(input, 20, false)).toEqual({});
    expect(validateCheckin({ ...input, quantity: 21 }, 20, false)).toHaveProperty(
      "quantity",
    );
    expect(validateCheckin({ ...input, quantity: 2 }, 1, true)).toHaveProperty(
      "quantity",
    );
  });

  it("derives open, partial and completed states without closing a remainder", () => {
    expect(deriveCustodyStatus(20, 0)).toBe("aberta");
    expect(deriveCustodyStatus(20, 15)).toBe("parcial");
    expect(deriveCustodyStatus(20, 20)).toBe("concluida");
  });
});
