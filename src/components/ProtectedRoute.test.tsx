import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  loading: false,
  isAccountActivated: true,
  isAdmin: false,
  isMasterAdmin: false,
  empresaBloqueada: false,
  precisaEscolherPlano: false,
  statusPagamento: null as string | null,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => auth,
}));

import { ProtectedRoute } from "./ProtectedRoute";

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/agenda"]}>
      <Routes>
        <Route
          path="/agenda"
          element={
            <ProtectedRoute>
              <div>conteudo protegido</div>
            </ProtectedRoute>
          }
        />
        <Route path="/primeiro-acesso" element={<div>primeiro acesso</div>} />
        <Route path="/login" element={<div>login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute activation gate", () => {
  beforeEach(() => {
    auth.user = { id: "user-1" };
    auth.loading = false;
    auth.isAccountActivated = true;
  });

  it("redirects an authenticated unactivated account to Primeiro Acesso", () => {
    auth.isAccountActivated = false;

    renderRoute();

    expect(screen.getByText("primeiro acesso")).toBeInTheDocument();
    expect(screen.queryByText("conteudo protegido")).not.toBeInTheDocument();
  });

  it("keeps protected routes available to an activated account", () => {
    renderRoute();

    expect(screen.getByText("conteudo protegido")).toBeInTheDocument();
  });
});
