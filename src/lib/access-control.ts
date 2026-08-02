export const PENDING_PAYMENT_STATUSES = [
  "pendente",
  "aguardando_pagamento",
  "pagamento_em_analise",
] as const;

export interface CompanyAccessRecord {
  plano_id: string | null;
  plan_periodicity?: string | null;
  plan_active?: boolean | null;
  plano_bloqueado: boolean;
  trial_expires_at: string | null;
  status: string | null;
  status_pagamento: string | null;
  vencimento: string | null;
  precisa_escolher_plano: boolean;
}

export function hasCompanyOperationalAccess(
  company: CompanyAccessRecord,
  now = new Date(),
): boolean {
  if (
    company.status !== "ativo" ||
    company.plano_bloqueado ||
    company.precisa_escolher_plano
  ) {
    return false;
  }

  if (!company.plano_id) {
    return (
      company.trial_expires_at !== null &&
      !isDateExpired(company.trial_expires_at, now)
    );
  }

  if (company.plan_active === false) return false;
  if (company.plan_periodicity === "vitalicio") return true;

  return (
    company.status_pagamento === "pago" &&
    company.vencimento !== null &&
    !isDateExpired(company.vencimento, now)
  );
}

export interface CompanyAccessState {
  blocked: boolean;
  expired: boolean;
  needsPlanSelection: boolean;
  paymentStatus: string | null;
}

interface SubscriptionRedirectInput {
  pathname: string;
  skipPlanCheck: boolean;
  isMasterAdmin: boolean;
  companyBlocked: boolean;
  needsPlanSelection: boolean;
  paymentStatus: string | null;
}

interface WaitingPaymentRedirectInput {
  isMasterAdmin: boolean;
  needsPlanSelection: boolean;
  paymentStatus: string | null;
}

function isDateExpired(value: string | null, now: Date): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp < now.getTime();
}

export function isPendingPaymentStatus(status: string | null): boolean {
  return status !== null && PENDING_PAYMENT_STATUSES.includes(
    status as (typeof PENDING_PAYMENT_STATUSES)[number],
  );
}

export function getCompanyAccessState(
  company: CompanyAccessRecord,
  now = new Date(),
): CompanyAccessState {
  const isLifetime = company.plan_periodicity === "vitalicio";
  const expired = isLifetime
    ? false
    : company.plano_id
      ? isDateExpired(company.vencimento, now)
      : isDateExpired(company.trial_expires_at, now);

  return {
    blocked: company.plano_bloqueado || expired || company.status === "inativo",
    expired,
    needsPlanSelection: company.precisa_escolher_plano,
    paymentStatus: company.status_pagamento,
  };
}

export function getSubscriptionRedirect({
  pathname,
  skipPlanCheck,
  isMasterAdmin,
  companyBlocked,
  needsPlanSelection,
  paymentStatus,
}: SubscriptionRedirectInput): string | null {
  if (isMasterAdmin || skipPlanCheck) return null;

  if (needsPlanSelection) return "/escolher-plano";
  if (isPendingPaymentStatus(paymentStatus)) return "/aguardando-pagamento";

  if (companyBlocked) {
    const isPlanRoute = pathname === "/plano";
    const isViewOnlyRoute = [
      "/agenda",
      "/dashboard",
      "/financeiro",
      "/documentos",
      "/funcionarios",
      "/backups",
      "/usuarios",
      "/modulos",
    ].some((route) => pathname.startsWith(route));
    const isEventView =
      pathname.startsWith("/evento/") &&
      !pathname.includes("/editar") &&
      !pathname.includes("/novo");

    if (!isPlanRoute && !isViewOnlyRoute && !isEventView) return "/plano";
  }

  return null;
}

export function getWaitingPaymentRedirect({
  isMasterAdmin,
  needsPlanSelection,
  paymentStatus,
}: WaitingPaymentRedirectInput): string | null {
  if (isMasterAdmin) return "/agenda";
  if (needsPlanSelection) return "/escolher-plano";
  if (isPendingPaymentStatus(paymentStatus)) return null;
  return "/agenda";
}
