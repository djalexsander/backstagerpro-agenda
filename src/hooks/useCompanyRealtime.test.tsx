import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useCompanyRealtime } from "./useCompanyRealtime";

interface OnCall {
  event: string;
  table: string;
  handler: () => void;
}

interface MockChannel {
  onCalls: OnCall[];
  on: (type: string, filter: { event: string; table: string }, handler: () => void) => MockChannel;
  subscribe: (callback: (status: string) => void) => MockChannel;
}

let lastChannel: MockChannel | null = null;
let mockSubscribeStatus = "SUBSCRIBED";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // realtime-domains.ts also imports CUSTODY_INVALIDATION_QUERY_KEYS/
    // RENTAL_INVALIDATION_QUERY_KEYS from the real checkin-checkout-service/
    // material-rental-service modules (not mocked here - only their
    // constants are used, not their RPC calls), and material-rental-service
    // binds supabase.rpc at module load time, so it must exist on this mock
    // even though no test here ever calls it.
    rpc: vi.fn(),
    channel: vi.fn(() => {
      const channel: MockChannel = {
        onCalls: [],
        on(type, filter, handler) {
          channel.onCalls.push({ event: filter.event, table: filter.table, handler });
          return channel;
        },
        subscribe(callback) {
          // Fires synchronously, same as the real client would report a
          // near-instant local subscription - no need for act()/waitFor
          // gymnastics since this happens inside the hook's own effect.
          callback(mockSubscribeStatus);
          return channel;
        },
      };
      lastChannel = channel;
      return channel;
    }),
    removeChannel: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useCompanyRealtime", () => {
  beforeEach(() => {
    lastChannel = null;
    mockSubscribeStatus = "SUBSCRIBED";
  });

  it("invalidates every subscribed domain's query keys as soon as it connects", async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => useCompanyRealtime("company-1", ["material_custodias"]),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));

    // Covers "ao reconectar, refazer/refetch do estado oficial" - the very
    // first SUBSCRIBED is itself a (re)connection from the hook's point of
    // view, so it must invalidate immediately rather than wait for a
    // Postgres Changes event that may never arrive if nothing changes.
    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["material-custodies", "company-1"]);
    expect(invalidatedKeys).toContainEqual(["materials", "company-1"]);
  });

  it("invalidates only the affected domain's query keys when a postgres_changes event fires", async () => {
    const { queryClient, wrapper } = createWrapper();

    renderHook(
      () => useCompanyRealtime("company-1", ["scanner_remoto_leituras", "materiais"]),
      { wrapper },
    );

    await waitFor(() => expect(lastChannel).not.toBeNull());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const insertHandler = lastChannel!.onCalls.find(
      (call) => call.table === "scanner_remoto_leituras" && call.event === "INSERT",
    );
    expect(insertHandler).toBeDefined();
    insertHandler!.handler();

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(["scanner-remoto-leituras", "company-1"]);
    // The event was for scanner_remoto_leituras only - materiais' own keys
    // must not be invalidated by an unrelated table's change.
    expect(invalidatedKeys).not.toContainEqual(["materials", "company-1"]);
  });

  it("subscribes to every requested event for a domain configured with more than one", async () => {
    const { wrapper } = createWrapper();

    renderHook(() => useCompanyRealtime("company-1", ["scanner_remoto_sessoes"]), { wrapper });

    await waitFor(() => expect(lastChannel).not.toBeNull());
    const events = lastChannel!.onCalls
      .filter((call) => call.table === "scanner_remoto_sessoes")
      .map((call) => call.event);
    expect(events).toEqual(["INSERT", "UPDATE", "DELETE"]);
  });

  it("reports disconnected when the channel errors out instead of claiming a false connection", async () => {
    mockSubscribeStatus = "CHANNEL_ERROR";
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useCompanyRealtime("company-1", ["material_custodias"]),
      { wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe("disconnected"));
  });

  it("does not open a channel when there is no company selected", () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCompanyRealtime(null, ["material_custodias"]), {
      wrapper,
    });

    expect(result.current.status).toBe("disconnected");
    expect(lastChannel).toBeNull();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
