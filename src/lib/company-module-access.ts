export function isCompanyModuleAccessible({
  featureKey,
  activeCatalogFeatureKeys,
  activeEntitlementFeatureKeys,
  isLifetime,
}: {
  featureKey: string;
  activeCatalogFeatureKeys: ReadonlySet<string>;
  activeEntitlementFeatureKeys: ReadonlySet<string>;
  isLifetime: boolean;
}): boolean {
  return (
    activeCatalogFeatureKeys.has(featureKey)
    && (isLifetime || activeEntitlementFeatureKeys.has(featureKey))
  );
}

export function isCustomerVisibleActiveEntitlement({
  status,
  catalog,
}: {
  status: string;
  catalog: { ativo: boolean; feature_key: string } | null;
}): boolean {
  return (
    status === "active"
    && catalog?.ativo === true
    && catalog.feature_key !== "extra_storage"
  );
}
