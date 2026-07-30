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
