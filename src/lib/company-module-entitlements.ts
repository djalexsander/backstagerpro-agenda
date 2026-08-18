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
