import { describe, expect, it } from "vitest";
import {
  matchMaterialIdentifierLocally,
  materialIdentifierCandidates,
  resolveMaterialByEpc,
  resolveMaterialIdentifier,
  type MaterialIdentifierFields,
} from "@/lib/material-resolution";
import { MATERIAL_QR_PREFIX } from "@/lib/material-identification";

const MATERIALS: MaterialIdentifierFields[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    nome: "Caixa de som JBL",
    codigo_interno: "SOM-001",
    identificador_unico: "22222222-2222-4222-8222-222222222222",
    codigo_barras: "BSP-AAAA1111",
    conteudo_qr_code: `${MATERIAL_QR_PREFIX}22222222-2222-4222-8222-222222222222`,
    numero_patrimonio: "PAT-500",
    numero_serie: "SN-900",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    nome: "Mesa de som Behringer",
    codigo_interno: "SOM-002",
  },
];

describe("materialIdentifierCandidates", () => {
  it("collects every non-empty identifier, normalized to lowercase", () => {
    const candidates = materialIdentifierCandidates(MATERIALS[0]);
    expect(candidates).toContain("som-001");
    expect(candidates).toContain("bsp-aaaa1111");
    expect(candidates).toContain("pat-500");
    expect(candidates).toContain("sn-900");
  });

  it("omits absent fields instead of including empty strings", () => {
    const candidates = materialIdentifierCandidates(MATERIALS[1]);
    expect(candidates).toEqual(["33333333-3333-4333-8333-333333333333", "som-002"]);
  });
});

describe("matchMaterialIdentifierLocally", () => {
  it("matches by internal code", () => {
    const result = matchMaterialIdentifierLocally(MATERIALS, "SOM-002");
    expect(result).toEqual({ status: "found", materialId: MATERIALS[1].id, source: "codigo_interno" });
  });

  it("matches by barcode", () => {
    const result = matchMaterialIdentifierLocally(MATERIALS, "bsp-aaaa1111");
    expect(result.status).toBe("found");
    if (result.status === "found") expect(result.materialId).toBe(MATERIALS[0].id);
  });

  it("matches full QR content by stripping the known prefix", () => {
    const result = matchMaterialIdentifierLocally(
      MATERIALS,
      `${MATERIAL_QR_PREFIX}22222222-2222-4222-8222-222222222222`,
    );
    expect(result.status).toBe("found");
    if (result.status === "found") expect(result.materialId).toBe(MATERIALS[0].id);
  });

  it("falls back to a name substring match as a last resort", () => {
    const result = matchMaterialIdentifierLocally(MATERIALS, "behringer");
    expect(result.status).toBe("found");
    if (result.status === "found") expect(result.materialId).toBe(MATERIALS[1].id);
  });

  it("returns not_found for an unmatched input", () => {
    expect(matchMaterialIdentifierLocally(MATERIALS, "nao-existe")).toEqual({ status: "not_found" });
  });

  it("returns not_found for blank input", () => {
    expect(matchMaterialIdentifierLocally(MATERIALS, "   ")).toEqual({ status: "not_found" });
  });
});

describe("resolveMaterialByEpc", () => {
  it("returns found for an active tag", async () => {
    const result = await resolveMaterialByEpc("AABBCCDD", async () => ({
      materialId: "mat-1",
      tagStatus: "ativa",
    }));
    expect(result).toEqual({ status: "found", materialId: "mat-1", source: "epc" });
  });

  it("returns tag_inactive for a registered but inactive tag", async () => {
    const result = await resolveMaterialByEpc("AABBCCDD", async () => ({
      materialId: "mat-1",
      tagStatus: "perdida",
    }));
    expect(result).toEqual({ status: "tag_inactive", materialId: "mat-1", tagStatus: "perdida" });
  });

  it("returns not_found when no tag is registered for the EPC", async () => {
    const result = await resolveMaterialByEpc("AABBCCDD", async () => ({
      materialId: null,
      tagStatus: null,
    }));
    expect(result).toEqual({ status: "not_found" });
  });

  it("returns not_found without calling the resolver for a malformed EPC", async () => {
    let called = false;
    const result = await resolveMaterialByEpc("!!!", async () => {
      called = true;
      return { materialId: "mat-1", tagStatus: "ativa" };
    });
    expect(result).toEqual({ status: "not_found" });
    expect(called).toBe(false);
  });
});

describe("resolveMaterialIdentifier", () => {
  it("prefers a local match over calling the EPC resolver", async () => {
    let called = false;
    const result = await resolveMaterialIdentifier("SOM-002", {
      materials: MATERIALS,
      resolveEpc: async () => {
        called = true;
        return { materialId: null, tagStatus: null };
      },
    });
    expect(result).toEqual({ status: "found", materialId: MATERIALS[1].id, source: "codigo_interno" });
    expect(called).toBe(false);
  });

  it("falls back to EPC resolution when there is no local match and a resolver is provided", async () => {
    const result = await resolveMaterialIdentifier("E280116060000205", {
      materials: MATERIALS,
      resolveEpc: async (epc) => (epc === "E280116060000205" ? { materialId: "mat-9", tagStatus: "ativa" } : { materialId: null, tagStatus: null }),
    });
    expect(result).toEqual({ status: "found", materialId: "mat-9", source: "epc" });
  });

  it("returns not_found when nothing matches locally and no EPC resolver was given", async () => {
    const result = await resolveMaterialIdentifier("nao-existe", { materials: MATERIALS });
    expect(result).toEqual({ status: "not_found" });
  });
});
