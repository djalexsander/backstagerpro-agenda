const LIFETIME_PERIODICITY = "vitalicio";
const TRIAL_PERIODICITY = "trial";

export interface MasterPlanoLike {
  id: string;
  nome: string;
  periodicidade?: string | null;
}

export interface MasterEditableEmpresa {
  plano: string | null;
  plano_id: string | null;
  status_pagamento: string | null;
}

/**
 * Resolves which plan row backs the Master "editar empresa" plan Select.
 * The Select is only ever populated with active plans, so a company parked
 * on a legacy/inactive plan has no matching option - but as long as the
 * dropdown is left untouched (still pointing at that same plan name), the
 * save must still resolve it instead of failing with "Plano selecionado não
 * foi encontrado". Only a genuine reassignment to a different plan requires
 * an active match.
 */
export function resolveEditablePlano<T extends MasterPlanoLike>(
  activePlanos: T[],
  allPlanos: T[],
  editItem: MasterEditableEmpresa | null,
  selectedPlanoNome: string,
): T | undefined {
  const active = activePlanos.find((p) => p.nome === selectedPlanoNome);
  if (active) return active;

  if (editItem && editItem.plano === selectedPlanoNome) {
    return allPlanos.find((p) => p.nome === selectedPlanoNome);
  }

  return undefined;
}

/**
 * Whether saving "editar empresa" must go through the canonical,
 * transactional master_set_company_plan RPC instead of a plain metadata
 * update. Every trial/vitalícia (re)assignment and every real plan change
 * always does; so does a paid plan left untouched but caught with
 * status_pagamento = 'pendente' - the exact legacy-inconsistent state a
 * paid plano_id can get stuck in with no billing path forward and no
 * pending charge to reconcile. Routing that state through the RPC lets the
 * Master sanitize it without an artificial plan swap.
 */
export function shouldApplyMasterPlanTransition(
  editItem: MasterEditableEmpresa,
  selectedPlano: MasterPlanoLike,
): boolean {
  const planChanged = editItem.plano !== selectedPlano.nome;
  const isVitalicio = selectedPlano.periodicidade === LIFETIME_PERIODICITY;
  const isTrial = selectedPlano.periodicidade === TRIAL_PERIODICITY;

  const paidStateInconsistent =
    !isVitalicio &&
    !isTrial &&
    editItem.plano_id === selectedPlano.id &&
    editItem.status_pagamento === "pendente";

  return isVitalicio || isTrial || planChanged || paidStateInconsistent;
}
