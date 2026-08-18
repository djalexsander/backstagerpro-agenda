export type CompanyModuleEntitlementStatus = "active" | "inactive" | "pending" | "cancelled" | "rejected";

interface BuildCompanyModuleEntitlementPayloadArgs {
  requestedStatus: CompanyModuleEntitlementStatus;
  grantedByAdmin: boolean;
  valorCobrado: number;
  origem: string;
  trialGranted: boolean;
  currentStatus?: CompanyModuleEntitlementStatus | null;
  existingActivatedAt?: string | null;
}

export interface ModuleDependencyRequirement {
  requiredModuleFeatureKey: string;
}

export interface ModuleDependencyValidationResult {
  isAllowed: boolean;
  missingDependencies: string[];
}

export interface ModuleDependencyEdge {
  module_id: string;
  required_module_id: string;
}

export function expandModuleSelectionWithDependencies({
  selectedModuleIds,
  moduleDependencies,
  activeModuleIds,
}: {
  selectedModuleIds: Iterable<string>;
  moduleDependencies: readonly ModuleDependencyEdge[];
  activeModuleIds: Iterable<string>;
}): Set<string> {
  const expanded = new Set(selectedModuleIds);
  const active = new Set(activeModuleIds);
  const dependenciesByModule = new Map<string, string[]>();

  for (const dependency of moduleDependencies) {
    const existing = dependenciesByModule.get(dependency.module_id) ?? [];
    existing.push(dependency.required_module_id);
    dependenciesByModule.set(dependency.module_id, existing);
  }

  const pending = [...expanded];
  while (pending.length > 0) {
    const moduleId = pending.pop()!;
    for (const requiredId of dependenciesByModule.get(moduleId) ?? []) {
      if (active.has(requiredId) || expanded.has(requiredId)) continue;
      expanded.add(requiredId);
      pending.push(requiredId);
    }
  }

  return expanded;
}

/** Same entitlement-state rule used by the Master catalog. */
export function doesCompanyModuleBlockPurchase(
  status: CompanyModuleEntitlementStatus | string,
): boolean {
  return status === "active" || status === "pending";
}

export function validateModuleDependenciesForActivation({
  moduleDependencies,
  activeModuleFeatureKeys,
}: {
  moduleDependencies: ModuleDependencyRequirement[];
  activeModuleFeatureKeys: Iterable<string>;
}): ModuleDependencyValidationResult {
  const activeFeatureKeys = new Set(
    Array.from(activeModuleFeatureKeys, (featureKey) => featureKey?.toLowerCase?.() ?? String(featureKey))
  );

  const missingDependencies = moduleDependencies
    .map((dependency) => dependency.requiredModuleFeatureKey?.toLowerCase?.() ?? String(dependency.requiredModuleFeatureKey))
    .filter((featureKey) => featureKey && !activeFeatureKeys.has(featureKey));

  return {
    isAllowed: missingDependencies.length === 0,
    missingDependencies,
  };
}

export function buildCompanyModuleEntitlementPayload({
  requestedStatus,
  grantedByAdmin,
  valorCobrado,
  origem,
  trialGranted,
  currentStatus,
  existingActivatedAt,
}: BuildCompanyModuleEntitlementPayloadArgs) {
  const payload: Record<string, unknown> = {
    status: requestedStatus,
    granted_by_admin: grantedByAdmin,
    valor_cobrado: valorCobrado,
    origem,
    trial_granted: trialGranted,
  };

  if (requestedStatus === "active") {
    payload.activated_at = existingActivatedAt ?? new Date().toISOString();
  } else if (requestedStatus !== "active") {
    payload.activated_at = null;
  }

  if (currentStatus === "active" && requestedStatus !== "active") {
    payload.activated_at = existingActivatedAt ?? null;
  }

  return payload;
}
