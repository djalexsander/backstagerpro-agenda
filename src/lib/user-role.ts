export type AppRole = "master_admin" | "admin_empresa" | "usuario";

type StoredRole = AppRole | "admin" | "user";

interface RoleRecord {
  role: string | null;
}

const ROLE_PRIORITY: Record<AppRole, number> = {
  master_admin: 3,
  admin_empresa: 2,
  usuario: 1,
};

const NORMALIZED_ROLES: Record<StoredRole, AppRole> = {
  master_admin: "master_admin",
  admin_empresa: "admin_empresa",
  usuario: "usuario",
  admin: "admin_empresa",
  user: "usuario",
};

export function normalizeAppRole(role: string | null | undefined): AppRole | null {
  if (!role || !(role in NORMALIZED_ROLES)) return null;
  return NORMALIZED_ROLES[role as StoredRole];
}

export function selectHighestPriorityRole(roles: readonly RoleRecord[]): AppRole | null {
  let selectedRole: AppRole | null = null;

  for (const { role } of roles) {
    const normalizedRole = normalizeAppRole(role);
    if (
      normalizedRole &&
      (!selectedRole || ROLE_PRIORITY[normalizedRole] > ROLE_PRIORITY[selectedRole])
    ) {
      selectedRole = normalizedRole;
    }
  }

  return selectedRole;
}
