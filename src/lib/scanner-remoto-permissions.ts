import { getCustodyPermissions, type CustodyPermissions } from "./checkin-checkout-permissions";

// Scanner Remoto is not a separate commercial module - by decision, it is
// the exact same Check-in/Check-out capability, reached from another
// device. Delegating to getCustodyPermissions (instead of re-implementing
// the same role/module/read-only rule a second time) is what guarantees the
// phone can never do more - or less - than the desktop already allows for a
// given user, by construction, matching the backend's own
// resolve_custody_company guard that every Scanner Remoto RPC also uses.
// `cancelar` is part of the shared shape but has no Scanner Remoto
// equivalent (there is no remote "cancel checkout" action) - callers simply
// don't use it.
export type ScannerRemotoPermissions = CustodyPermissions;

export function getScannerRemotoPermissions(args: {
  role: string | null;
  moduleEnabled: boolean;
  companyReadOnly: boolean;
  companySelected?: boolean;
}): ScannerRemotoPermissions {
  return getCustodyPermissions(args);
}
