export type InternalRequestAuthorization =
  | "authorized"
  | "misconfigured"
  | "unauthorized";

const MINIMUM_SECRET_LENGTH = 32;

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maximumLength = Math.max(leftBytes.length, rightBytes.length, 1);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maximumLength; index += 1) {
    difference |=
      (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

export function authorizeInternalRequest(
  configuredSecret: string | undefined,
  receivedHeaderSecret: string | null,
): InternalRequestAuthorization {
  if (
    !configuredSecret ||
    configuredSecret.length < MINIMUM_SECRET_LENGTH
  ) {
    return "misconfigured";
  }

  if (!receivedHeaderSecret) {
    return "unauthorized";
  }

  return constantTimeEqual(configuredSecret, receivedHeaderSecret)
    ? "authorized"
    : "unauthorized";
}
