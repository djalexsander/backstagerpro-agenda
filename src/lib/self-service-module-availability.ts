import type { ModuleCatalogRow } from "@/types/subscription";
import { doesCompanyModuleBlockPurchase } from "./company-module-entitlements";

interface CompanyModuleState {
  empresa_id: string;
  module_id: string;
  status: string;
}

interface ModuleRequestState {
  empresa_id: string;
  module_id: string;
  status: string;
}

interface ModulePaymentState {
  empresa_id: string;
  module_id: string;
  status: string;
}

interface ModuleBatchState {
  empresa_id: string;
  status: string;
  module_batch_request_items?: Array<{ module_id: string }> | null;
}

export interface SelfServiceModuleAvailabilityInput {
  companyId: string | null | undefined;
  catalog: ModuleCatalogRow[];
  companyModules: CompanyModuleState[];
  moduleRequests: ModuleRequestState[];
  batchRequests: ModuleBatchState[];
  modulePayments: ModulePaymentState[];
}

const BLOCKING_REQUEST_STATUSES = new Set(["pending"]);
const BLOCKING_BATCH_STATUSES = new Set(["pending", "paid"]);
const BLOCKING_PAYMENT_STATUSES = new Set(["pending", "paid"]);

export function getLifetimeLicensedCatalogModules(
  catalog: ModuleCatalogRow[],
): ModuleCatalogRow[] {
  return catalog.filter(
    (module) => module.ativo && module.feature_key !== "extra_storage",
  );
}

export type SelfServiceModuleProgressStatus =
  | "activation_pending"
  | "payment_confirmed"
  | "payment_pending"
  | "request_pending";

export interface SelfServiceModuleProgress {
  module: ModuleCatalogRow;
  status: SelfServiceModuleProgressStatus;
}

const PROGRESS_PRIORITY: Record<SelfServiceModuleProgressStatus, number> = {
  request_pending: 1,
  payment_pending: 2,
  payment_confirmed: 3,
  activation_pending: 4,
};

/** Returns each in-flight module once, scoped to the current company. */
export function getSelfServiceModulesInProgress({
  companyId,
  catalog,
  companyModules,
  moduleRequests,
  batchRequests,
  modulePayments,
}: SelfServiceModuleAvailabilityInput): SelfServiceModuleProgress[] {
  if (!companyId) return [];

  const states = new Map<string, SelfServiceModuleProgressStatus>();
  const setState = (moduleId: string, status: SelfServiceModuleProgressStatus) => {
    const current = states.get(moduleId);
    if (!current || PROGRESS_PRIORITY[status] > PROGRESS_PRIORITY[current]) {
      states.set(moduleId, status);
    }
  };

  companyModules
    .filter((row) => row.empresa_id === companyId && row.status === "pending")
    .forEach((row) => setState(row.module_id, "activation_pending"));

  moduleRequests
    .filter((row) => row.empresa_id === companyId && row.status === "pending")
    .forEach((row) => setState(row.module_id, "request_pending"));

  modulePayments
    .filter((row) => row.empresa_id === companyId && BLOCKING_PAYMENT_STATUSES.has(row.status))
    .forEach((row) => setState(
      row.module_id,
      row.status === "paid" ? "payment_confirmed" : "payment_pending",
    ));

  batchRequests
    .filter((row) => row.empresa_id === companyId && BLOCKING_BATCH_STATUSES.has(row.status))
    .forEach((row) => {
      (row.module_batch_request_items || []).forEach((item) => setState(
        item.module_id,
        row.status === "paid" ? "payment_confirmed" : "request_pending",
      ));
    });

  return catalog
    .filter((module) => module.feature_key !== "extra_storage" && states.has(module.id))
    .map((module) => ({ module, status: states.get(module.id)! }));
}

/**
 * Applies the existing entitlement state machine to the self-service catalog.
 * Provisioned inactive rows, as well as cancelled/rejected rows, are not a
 * purchase. Active/pending entitlements and commercial operations still in
 * progress block a duplicate request.
 */
export function getSelfServiceAvailableModules({
  companyId,
  catalog,
  companyModules,
  moduleRequests,
  batchRequests,
  modulePayments,
}: SelfServiceModuleAvailabilityInput): ModuleCatalogRow[] {
  if (!companyId) return [];

  const unavailableModuleIds = new Set<string>();

  companyModules
    .filter((row) => row.empresa_id === companyId && doesCompanyModuleBlockPurchase(row.status))
    .forEach((row) => unavailableModuleIds.add(row.module_id));

  moduleRequests
    .filter((row) => row.empresa_id === companyId && BLOCKING_REQUEST_STATUSES.has(row.status))
    .forEach((row) => unavailableModuleIds.add(row.module_id));

  modulePayments
    .filter((row) => row.empresa_id === companyId && BLOCKING_PAYMENT_STATUSES.has(row.status))
    .forEach((row) => unavailableModuleIds.add(row.module_id));

  batchRequests
    .filter((row) => row.empresa_id === companyId && BLOCKING_BATCH_STATUSES.has(row.status))
    .forEach((row) => {
      (row.module_batch_request_items || []).forEach((item) => {
        unavailableModuleIds.add(item.module_id);
      });
    });

  return catalog.filter(
    (module) =>
      module.ativo
      && module.feature_key !== "extra_storage"
      && !unavailableModuleIds.has(module.id),
  );
}
