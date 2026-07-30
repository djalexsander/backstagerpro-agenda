export const DEFAULT_SAFE_DATABASE_ERROR_MESSAGE =
  "Não foi possível concluir a operação. Tente novamente.";

type SupabaseErrorLike = {
  code?: unknown;
  constraint?: unknown;
  details?: unknown;
  hint?: unknown;
  message?: unknown;
};

export type UniqueConstraintMessages = Readonly<Record<string, string>>;
export type DatabaseCodeMessages = Readonly<Record<string, string>>;

export class SafeSupabaseError extends Error {
  readonly handled: boolean;
  readonly originalError: unknown;

  constructor({
    message,
    originalError,
    handled,
  }: {
    message: string;
    originalError: unknown;
    handled: boolean;
  }) {
    super(message);
    this.name = "SafeSupabaseError";
    this.handled = handled;
    this.originalError = originalError;
  }
}

function asSupabaseError(error: unknown): SupabaseErrorLike {
  return typeof error === "object" && error !== null
    ? (error as SupabaseErrorLike)
    : {};
}

function diagnosticText(error: SupabaseErrorLike): string {
  return [
    error.constraint,
    error.message,
    error.details,
    error.hint,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

export function translateSupabaseError(
  error: unknown,
  {
    uniqueConstraintMessages = {},
    codeMessages = {},
    fallbackMessage = DEFAULT_SAFE_DATABASE_ERROR_MESSAGE,
  }: {
    uniqueConstraintMessages?: UniqueConstraintMessages;
    codeMessages?: DatabaseCodeMessages;
    fallbackMessage?: string;
  } = {},
): SafeSupabaseError {
  const supabaseError = asSupabaseError(error);
  const code =
    typeof supabaseError.code === "string" ? supabaseError.code : undefined;

  if (code === "23505") {
    const diagnostics = diagnosticText(supabaseError);
    const constraint = Object.keys(uniqueConstraintMessages).find((name) =>
      diagnostics.includes(name),
    );

    if (constraint) {
      return new SafeSupabaseError({
        message: uniqueConstraintMessages[constraint],
        originalError: error,
        handled: true,
      });
    }
  }

  if (code && codeMessages[code]) {
    return new SafeSupabaseError({
      message: codeMessages[code],
      originalError: error,
      handled: true,
    });
  }

  return new SafeSupabaseError({
    message: fallbackMessage,
    originalError: error,
    handled: false,
  });
}
