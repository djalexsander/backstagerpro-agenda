export const asaasConfirmationEvents = [
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
] as const;

export type AsaasConfirmationEvent =
  (typeof asaasConfirmationEvents)[number];

export type ParsedAsaasWebhook =
  | { action: "ignored"; event: string }
  | {
      action: "process";
      eventId: string;
      event: AsaasConfirmationEvent;
      eventCreatedAt: string | null;
      paymentId: string;
      externalReference: string | null;
      amount: number;
    };

export type AsaasWebhookAuthorization =
  | "authorized"
  | "misconfigured"
  | "unauthorized";

const MAX_PROVIDER_ID_LENGTH = 255;

export function authorizeAsaasWebhook(
  configuredToken: string | undefined,
  receivedHeaderToken: string | null,
): AsaasWebhookAuthorization {
  if (!configuredToken || configuredToken.length < 32) {
    return "misconfigured";
  }

  return receivedHeaderToken === configuredToken
    ? "authorized"
    : "unauthorized";
}

function isProviderId(value: unknown, prefix: string): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(prefix) &&
    value.length > prefix.length &&
    value.length <= MAX_PROVIDER_ID_LENGTH
  );
}

function parseProviderTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;

  const withoutTimezone =
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value);
  const normalized = withoutTimezone
    ? `${value.replace(" ", "T")}Z`
    : value;
  const timestamp = Date.parse(normalized);

  if (!Number.isFinite(timestamp)) {
    throw new Error("Data do evento Asaas inválida");
  }

  return new Date(timestamp).toISOString();
}

export function parseAsaasWebhook(body: unknown): ParsedAsaasWebhook {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Payload do webhook inválido");
  }

  const record = body as Record<string, unknown>;
  const event = record.event;
  if (typeof event !== "string" || !event) {
    throw new Error("Evento do webhook ausente");
  }

  if (
    !asaasConfirmationEvents.includes(event as AsaasConfirmationEvent)
  ) {
    return { action: "ignored", event };
  }

  if (!isProviderId(record.id, "evt_")) {
    throw new Error("ID do evento Asaas inválido");
  }

  const payment = record.payment;
  if (!payment || typeof payment !== "object" || Array.isArray(payment)) {
    throw new Error("Pagamento ausente no webhook");
  }

  const paymentRecord = payment as Record<string, unknown>;
  if (!isProviderId(paymentRecord.id, "pay_")) {
    throw new Error("ID do pagamento Asaas inválido");
  }

  const amount = paymentRecord.value;
  const amountInCents =
    typeof amount === "number" ? Math.round(amount * 100) : Number.NaN;
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    Math.abs(amount * 100 - amountInCents) > 1e-8
  ) {
    throw new Error("Valor do pagamento Asaas inválido");
  }

  const eventCreatedAt = parseProviderTimestamp(record.dateCreated);
  const externalReference =
    typeof paymentRecord.externalReference === "string"
      ? paymentRecord.externalReference
      : null;

  return {
    action: "process",
    eventId: record.id,
    event: event as AsaasConfirmationEvent,
    eventCreatedAt,
    paymentId: paymentRecord.id,
    externalReference,
    amount: amountInCents / 100,
  };
}
