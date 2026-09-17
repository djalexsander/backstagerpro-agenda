export const PENDING_PAYMENT_STATUSES = [
  "pendente",
  "aguardando_pagamento",
  "pagamento_em_analise",
] as const;

// Mirrors public.subscription_grace_period_days() / subscription_days_until_due
// (supabase/migrations/20260917090000_subscription_grace_period_and_billing_notifications.sql).
// Keep these two in sync by hand - there is no runtime cross-call between
// the frontend and Postgres for this constant.
export const SUBSCRIPTION_GRACE_PERIOD_DAYS = 3;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// ceil((due - now) / 1 day): 0 = due today, negative = days elapsed since
// due. Millisecond-based (not calendar/timezone based) so it matches the
// backend's epoch-seconds computation regardless of the browser's timezone.
function daysUntilDue(dueIso: string, now: Date): number {
  return Math.ceil((Date.parse(dueIso) - now.getTime()) / ONE_DAY_MS);
}

// True once the due date's own day AND the full grace window after it have
// both elapsed - i.e. operational write access should be cut. Only applies
// to a paid plan's vencimento; trial expiry never gets a grace period (see
// hasCompanyOperationalAccess below).
function isPastGracePeriod(
  dueIso: string | null,
  now: Date,
  graceDays: number = SUBSCRIPTION_GRACE_PERIOD_DAYS,
): boolean {
  if (!dueIso) return false;
  const timestamp = Date.parse(dueIso);
  if (!Number.isFinite(timestamp)) return false;
  return daysUntilDue(dueIso, now) <= -(graceDays + 1);
}

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
    !isPastGracePeriod(company.vencimento, now)
  );
}

export interface CompanyAccessState {
  blocked: boolean;
  /** Past the raw due date (plan) or trial deadline - informational, does not by itself mean blocked; see inGracePeriod. */
  expired: boolean;
  /** Past due on a paid plan's vencimento but still inside the grace window: expired is true, blocked is false. Never true for trial. */
  inGracePeriod: boolean;
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
  const hasPlan = !!company.plano_id;
  const expired = isLifetime
    ? false
    : hasPlan
      ? isDateExpired(company.vencimento, now)
      : isDateExpired(company.trial_expires_at, now);
  // Grace period is exclusive to an already-paid plan's own vencimento - a
  // free trial expiring gets no grace (deactivate_trial_modules already
  // treats it as an immediate cutoff), and plano_bloqueado/status are
  // unconditional regardless of grace.
  const blockedBySubscription =
    !isLifetime && hasPlan ? isPastGracePeriod(company.vencimento, now) : expired;

  return {
    blocked: company.plano_bloqueado || blockedBySubscription || company.status === "inativo",
    expired,
    inGracePeriod: !isLifetime && hasPlan && expired && !blockedBySubscription,
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
