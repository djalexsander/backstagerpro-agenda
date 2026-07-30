export const PENDING_PAYMENT_STATUSES = [
  "pendente",
  "aguardando_pagamento",
  "pagamento_em_analise",
] as const;

export interface CompanyAccessRecord {
  plano_id: string | null;
  plan_periodicity?: string | null;
  plano_bloqueado: boolean;
  trial_expires_at: string | null;
  status: string | null;
  status_pagamento: string | null;
  vencimento: string | null;
  precisa_escolher_plano: boolean;
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
