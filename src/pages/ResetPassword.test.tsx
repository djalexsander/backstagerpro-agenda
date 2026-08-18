import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: "user-1" } as { id: string } | null,
    loading: false,
    isAccountActivated: true,
  },
  updateUser: vi.fn(async () => ({ error: null })),
  unsubscribe: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: mocks.unsubscribe } },
      })),
      updateUser: mocks.updateUser,
    },
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/hooks/useSystemSettings", () => ({
  usePlatformBranding: () => ({
    platformLogoUrl: null,
    platformName: "Backstage Pro",
  }),
}));

import ResetPassword from "./ResetPassword";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/reset-password"]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/primeiro-acesso" element={<div>primeiro acesso</div>} />
        <Route path="/login" element={<div>login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ResetPassword activation gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.user = { id: "user-1" };
    mocks.auth.loading = false;
    mocks.auth.isAccountActivated = true;
    window.location.hash = "#type=recovery";
  });

  it("routes an unactivated recovery session to Primeiro Acesso", async () => {
    mocks.auth.isAccountActivated = false;

    renderPage();

    expect(await screen.findByText("primeiro acesso")).toBeInTheDocument();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("continues to reset the password for an activated account", async () => {
    renderPage();

    const password = await screen.findByLabelText("Nova senha");
    fireEvent.change(password, { target: { value: "novaSenha123" } });
    fireEvent.change(screen.getByLabelText("Confirmar nova senha"), {
      target: { value: "novaSenha123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));

    await waitFor(() =>
      expect(mocks.updateUser).toHaveBeenCalledWith({ password: "novaSenha123" }),
    );
    expect(await screen.findByText(/Senha redefinida com sucesso/i)).toBeInTheDocument();
  });
});
