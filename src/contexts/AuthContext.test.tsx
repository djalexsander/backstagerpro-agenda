import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initialSession: null as Record<string, unknown> | null,
  signInResult: {
    data: { user: null as Record<string, unknown> | null },
    error: null as Error | null,
  },
  profile: {
    full_name: "Ana",
    avatar_url: null as string | null,
    empresa_id: "123e4567-e89b-42d3-a456-426614174000" as string | null,
    ativado: true,
  },
  roles: [{ role: "admin_empresa" }],
  company: {
    plano_bloqueado: false,
    trial_expires_at: null as string | null,
    logo_url: null as string | null,
    nome_empresa: "Empresa Teste",
    status: "ativo",
    plano_id: "223e4567-e89b-42d3-a456-426614174000" as string | null,
    vencimento: "2099-01-01T00:00:00.000Z" as string | null,
    precisa_escolher_plano: false,
    status_pagamento: "pago" as string | null,
  },
  activated: true,
  unsubscribe: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  logInsert: vi.fn(),
}));

function createQuery(table: string) {
  let selected = "";

  const builder = {
    select(columns: string) {
      selected = columns;
      return builder;
    },
    eq() {
      return builder;
    },
    async single() {
      if (table === "profiles" && selected === "ativado") {
        return { data: { ativado: mocks.activated }, error: null };
      }
      if (table === "profiles") {
        return {
          data: { ...mocks.profile, ativado: mocks.activated },
          error: null,
        };
      }
      if (table === "empresas") {
        return { data: mocks.company, error: null };
      }
      return { data: null, error: null };
    },
    insert(payload: unknown) {
      mocks.logInsert(payload);
      return Promise.resolve({ data: null, error: null });
    },
    then<
      TResult1 = { data: unknown[]; error: Error | null },
      TResult2 = never,
    >(
      onfulfilled?:
        | ((
            value: { data: unknown[]; error: Error | null },
          ) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      const result = {
        data: table === "user_roles" ? mocks.roles : [],
        error: null,
      };
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  };

  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: mocks.initialSession },
      })),
      onAuthStateChange: vi.fn(
        (
          _callback: (
            event: string,
            session: Record<string, unknown> | null,
          ) => void,
        ) => ({
          data: {
            subscription: { unsubscribe: mocks.unsubscribe },
          },
        }),
      ),
      signInWithPassword: (credentials: unknown) => {
        mocks.signIn(credentials);
        return Promise.resolve(mocks.signInResult);
      },
      signOut: () => {
        mocks.signOut();
        return Promise.resolve({ error: null });
      },
    },
    from: (table: string) => createQuery(table),
  },
}));

import { AuthProvider, useAuth } from "./AuthContext";

let currentAuth: ReturnType<typeof useAuth> | undefined;

function Probe() {
  const auth = useAuth();
  currentAuth = auth;

  return (
    <>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="role">{auth.role ?? "none"}</span>
      <span data-testid="tenant">{auth.empresaId ?? "none"}</span>
      <span data-testid="readonly">{String(auth.empresaReadOnly)}</span>
      <span data-testid="payment">{auth.statusPagamento ?? "none"}</span>
      <span data-testid="activated">{String(auth.isAccountActivated)}</span>
    </>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentAuth = undefined;
    mocks.initialSession = null;
    mocks.signInResult = { data: { user: null }, error: null };
    mocks.profile = {
      full_name: "Ana",
      avatar_url: null,
      empresa_id: "123e4567-e89b-42d3-a456-426614174000",
      ativado: true,
    };
    mocks.roles = [{ role: "admin_empresa" }];
    mocks.company = {
      plano_bloqueado: false,
      trial_expires_at: null,
      logo_url: null,
      nome_empresa: "Empresa Teste",
      status: "ativo",
      plano_id: "223e4567-e89b-42d3-a456-426614174000",
      vencimento: "2099-01-01T00:00:00.000Z",
      precisa_escolher_plano: false,
      status_pagamento: "pago",
    };
    mocks.activated = true;
  });

  it("loads the canonical tenant and highest-priority role", async () => {
    mocks.initialSession = {
      user: {
        id: "user-1",
        email: "ana@example.com",
        user_metadata: {},
      },
    };
    mocks.roles = [
      { role: "usuario" },
      { role: "admin_empresa" },
      { role: "master_admin" },
    ];
    mocks.company.plano_bloqueado = true;

    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("role")).toHaveTextContent("master_admin");
    expect(screen.getByTestId("tenant")).toHaveTextContent(
      mocks.profile.empresa_id!,
    );
    expect(screen.getByTestId("readonly")).toHaveTextContent("false");
    expect(screen.getByTestId("payment")).toHaveTextContent("none");
  });

  it("exposes a blocked company as read-only for its administrator", async () => {
    mocks.initialSession = {
      user: {
        id: "user-2",
        email: "admin@example.com",
        user_metadata: {},
      },
    };
    mocks.company.plano_bloqueado = true;

    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("readonly")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("role")).toHaveTextContent("admin_empresa");
    expect(screen.getByTestId("payment")).toHaveTextContent("pago");
  });

  it("fails closed for an existing session whose account is not activated", async () => {
    mocks.initialSession = {
      user: {
        id: "user-pending-session",
        email: "pending-session@example.com",
        user_metadata: {},
      },
    };
    mocks.activated = false;

    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );
    expect(screen.getByTestId("activated")).toHaveTextContent("false");
    expect(screen.getByTestId("role")).toHaveTextContent("none");
    expect(screen.getByTestId("tenant")).toHaveTextContent("none");
  });

  it("signs an unactivated account back out", async () => {
    mocks.activated = false;
    mocks.signInResult = {
      data: {
        user: {
          id: "user-3",
          email: "pending@example.com",
          user_metadata: {},
        },
      },
      error: null,
    };
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );

    let result: { error: Error | null } | undefined;
    await act(async () => {
      result = await currentAuth!.signIn(
        "pending@example.com",
        "password123",
      );
    });

    expect(result?.error?.message).toMatch(/ainda não ativada/i);
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.logInsert).not.toHaveBeenCalled();
  });

  it("logs a successful activated sign-in without storing the password", async () => {
    mocks.signInResult = {
      data: {
        user: {
          id: "user-4",
          email: "active@example.com",
          user_metadata: { full_name: "Usuário Ativo" },
        },
      },
      error: null,
    };
    renderProvider();

    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );

    let result: { error: Error | null } | undefined;
    await act(async () => {
      result = await currentAuth!.signIn(
        "active@example.com",
        "password123",
      );
    });

    expect(result?.error).toBeNull();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.logInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: "auth",
        acao: "login",
        user_id: "user-4",
      }),
    );
    expect(JSON.stringify(mocks.logInsert.mock.calls)).not.toContain(
      "password123",
    );
  });

  it("delegates sign-out to Supabase Auth", async () => {
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("false"),
    );

    await act(async () => {
      await currentAuth!.signOut();
    });

    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
