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

interface SelfServiceModuleAvailabilityInput {
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

  return catalog.filter((module) => module.ativo && !unavailableModuleIds.has(module.id));
}
