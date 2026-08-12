import { describe, expect, it } from "vitest";
import {
  resolveEditablePlano,
  shouldApplyMasterPlanTransition,
  type MasterEditableEmpresa,
  type MasterPlanoLike,
} from "./master-company-plan-edit";

const paidPlano: MasterPlanoLike = { id: "plano-paid", nome: "Básico", periodicidade: "mensal" };
const otherPaidPlano: MasterPlanoLike = { id: "plano-paid-2", nome: "Pro", periodicidade: "mensal" };
const trialPlano: MasterPlanoLike = { id: "plano-trial", nome: "Teste Gratuito de 7 Dias", periodicidade: "trial" };
const lifetimePlano: MasterPlanoLike = { id: "plano-vitalicio", nome: "Vitalícia", periodicidade: "vitalicio" };
const legacyPlano: MasterPlanoLike = { id: "plano-legacy", nome: "Legado", periodicidade: "mensal" };

describe("resolveEditablePlano", () => {
  it("resolves an active plan directly", () => {
    const result = resolveEditablePlano([paidPlano], [paidPlano], null, "Básico");
    expect(result).toBe(paidPlano);
  });

  it("falls back to the unfiltered list when the empresa is left on its current, now-inactive plan", () => {
    const editItem: MasterEditableEmpresa = { plano: "Legado", plano_id: "plano-legacy", status_pagamento: "pago" };
    // "Legado" no longer appears in the active-only list.
    const result = resolveEditablePlano([paidPlano], [paidPlano, legacyPlano], editItem, "Legado");
    expect(result).toBe(legacyPlano);
  });

  it("does not fall back when the empresa is being switched to a different, unknown plan", () => {
    const editItem: MasterEditableEmpresa = { plano: "Legado", plano_id: "plano-legacy", status_pagamento: "pago" };
    // Dropdown now points at a plan name that isn't active and isn't the empresa's own current plan.
    const result = resolveEditablePlano([paidPlano], [paidPlano, legacyPlano], editItem, "Outro Plano Desconhecido");
    expect(result).toBeUndefined();
  });

  it("does not fall back when creating a new empresa (no editItem)", () => {
    const result = resolveEditablePlano([paidPlano], [paidPlano, legacyPlano], null, "Legado");
    expect(result).toBeUndefined();
  });
});

describe("shouldApplyMasterPlanTransition", () => {
  it("applies the transition when the plan name changed", () => {
    const editItem: MasterEditableEmpresa = { plano: "Básico", plano_id: paidPlano.id, status_pagamento: "pago" };
    expect(shouldApplyMasterPlanTransition(editItem, otherPaidPlano)).toBe(true);
  });

  it("applies the transition whenever the selected plan is trial", () => {
    const editItem: MasterEditableEmpresa = { plano: trialPlano.nome, plano_id: null, status_pagamento: null };
    expect(shouldApplyMasterPlanTransition(editItem, trialPlano)).toBe(true);
  });

  it("applies the transition whenever the selected plan is vitalícia", () => {
    const editItem: MasterEditableEmpresa = { plano: lifetimePlano.nome, plano_id: lifetimePlano.id, status_pagamento: "isento" };
    expect(shouldApplyMasterPlanTransition(editItem, lifetimePlano)).toBe(true);
  });

  it("applies the transition to sanitize a legacy paid company stuck on status_pagamento = 'pendente', even though the plan name didn't change", () => {
    const editItem: MasterEditableEmpresa = {
      plano: paidPlano.nome,
      plano_id: paidPlano.id,
      status_pagamento: "pendente",
    };
    expect(shouldApplyMasterPlanTransition(editItem, paidPlano)).toBe(true);
  });

  it("does not apply the transition for a normal, already-consistent paid company left on the same plan", () => {
    const editItem: MasterEditableEmpresa = {
      plano: paidPlano.nome,
      plano_id: paidPlano.id,
      status_pagamento: "pago",
    };
    expect(shouldApplyMasterPlanTransition(editItem, paidPlano)).toBe(false);
  });

  it("does not treat a pending status as inconsistent when plano_id doesn't match the selected plan (a real change is already being applied via planChanged)", () => {
    // Same scenario, but this only documents that the paidStateInconsistent
    // branch specifically targets the "plan unchanged" case - a real
    // plano_id mismatch is already covered by planChanged above.
    const editItem: MasterEditableEmpresa = {
      plano: "Outro",
      plano_id: "plano-other",
      status_pagamento: "pendente",
    };
    expect(shouldApplyMasterPlanTransition(editItem, paidPlano)).toBe(true);
  });
});
