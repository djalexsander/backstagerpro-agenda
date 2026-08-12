import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useUpdateMock } = vi.hoisted(() => ({ useUpdateMock: vi.fn() }));
vi.mock("./UpdateProvider", () => ({ useUpdate: useUpdateMock }));

import { UpdateBanner } from "./UpdateBanner";

function context(overrides: Partial<ReturnType<typeof useUpdateMock>> = {}) {
  return {
    updateAvailable: false,
    isUpdating: false,
    newVersion: null,
    updateError: null,
    installUpdate: vi.fn(),
    dismissUpdate: vi.fn(),
    ...overrides,
  };
}

describe("UpdateBanner", () => {
  beforeEach(() => {
    useUpdateMock.mockReset();
  });

  it("renders nothing when no update is available", () => {
    useUpdateMock.mockReturnValue(context({ updateAvailable: false }));
    render(<UpdateBanner />);
    expect(screen.queryByText(/Nova versão disponível/i)).not.toBeInTheDocument();
  });

  it("shows the new version and an 'Atualizar agora' button when an update is available", () => {
    useUpdateMock.mockReturnValue(context({ updateAvailable: true, newVersion: "1.2.0" }));
    render(<UpdateBanner />);
    expect(screen.getByText(/Nova versão disponível/i)).toBeInTheDocument();
    expect(screen.getByText("v1.2.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /atualizar agora/i })).toBeInTheDocument();
  });

  it("omits the version tag when it isn't known yet (PWA path never reports one)", () => {
    useUpdateMock.mockReturnValue(context({ updateAvailable: true, newVersion: null }));
    render(<UpdateBanner />);
    expect(screen.getByText(/Nova versão disponível/i)).toBeInTheDocument();
    expect(screen.queryByText(/^v/)).not.toBeInTheDocument();
  });

  it("calls installUpdate when the button is clicked", () => {
    const installUpdate = vi.fn();
    useUpdateMock.mockReturnValue(context({ updateAvailable: true, installUpdate }));
    render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: /atualizar agora/i }));
    expect(installUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows a disabled loading state and hides the dismiss button while updating", () => {
    useUpdateMock.mockReturnValue(context({ updateAvailable: true, isUpdating: true }));
    render(<UpdateBanner />);
    const button = screen.getByRole("button", { name: /atualizando/i });
    expect(button).toBeDisabled();
    expect(screen.queryByLabelText(/dispensar/i)).not.toBeInTheDocument();
  });

  it("calls dismissUpdate when the dismiss button is clicked", () => {
    const dismissUpdate = vi.fn();
    useUpdateMock.mockReturnValue(context({ updateAvailable: true, dismissUpdate }));
    render(<UpdateBanner />);
    fireEvent.click(screen.getByLabelText(/dispensar/i));
    expect(dismissUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows the friendly error message when installation fails", () => {
    useUpdateMock.mockReturnValue(
      context({ updateAvailable: true, updateError: "Falha ao baixar/instalar a atualização." }),
    );
    render(<UpdateBanner />);
    expect(screen.getByText("Falha ao baixar/instalar a atualização.")).toBeInTheDocument();
  });

  it("shows no error row at all when there is nothing to report", () => {
    useUpdateMock.mockReturnValue(context({ updateAvailable: true, updateError: null }));
    render(<UpdateBanner />);
    expect(screen.queryByText(/falha/i)).not.toBeInTheDocument();
  });
});
