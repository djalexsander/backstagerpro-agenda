import { afterEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import {
  excluirMinhasNotificacoesLidas,
  getPushSubscriptionState,
  isPushSupported,
  listMinhasNotificacoes,
  marcarNotificacaoLida,
  marcarTodasNotificacoesLidas,
  setNotificacaoPreferencia,
  subscribeToPush,
  unsubscribeFromPush,
} from "./push-notifications-service";

const VALID_VAPID_KEY = "B".repeat(87); // formato base64url tipico (65 bytes) - so o comprimento importa aqui

function definePushApis(
  overrides: {
    notificationPermission?: NotificationPermission;
    requestPermission?: () => Promise<NotificationPermission>;
    getSubscription?: () => Promise<unknown>;
    subscribe?: () => Promise<unknown>;
  } = {},
) {
  const requestPermission =
    overrides.requestPermission ?? vi.fn().mockResolvedValue(overrides.notificationPermission ?? "granted");
  vi.stubGlobal("Notification", {
    permission: overrides.notificationPermission ?? "default",
    requestPermission,
  });

  const pushManager = {
    getSubscription: overrides.getSubscription ?? vi.fn().mockResolvedValue(null),
    subscribe: overrides.subscribe ?? vi.fn(),
  };
  Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true, writable: true });
  Object.defineProperty(navigator, "serviceWorker", {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
    writable: true,
  });

  return { pushManager, requestPermission };
}

describe("push-notifications-service", () => {
  afterEach(() => {
    rpc.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    delete (window as unknown as { PushManager?: unknown }).PushManager;
  });

  describe("isPushSupported", () => {
    it("is false when serviceWorker/PushManager/Notification are unavailable (default jsdom env)", () => {
      expect(isPushSupported()).toBe(false);
    });

    it("is true once serviceWorker, PushManager and Notification are all present", () => {
      definePushApis();
      expect(isPushSupported()).toBe(true);
    });
  });

  describe("listMinhasNotificacoes", () => {
    it("maps snake_case rows into MinhaNotificacao and defaults to unread-and-read, limit 30", async () => {
      rpc.mockResolvedValue({
        data: [
          {
            destinatario_id: "d1",
            notificacao_id: "n1",
            categoria: "operacional",
            tipo: "locacao_criada",
            titulo: "Nova locação criada",
            mensagem: "LOC-1 · Cliente X · 2 materiais",
            referencia_tipo: "locacao",
            referencia_id: "loc-1",
            rota: "/locacoes?locacao=loc-1",
            lida: false,
            lida_em: null,
            created_at: "2026-08-19T10:00:00Z",
          },
        ],
        error: null,
      });

      const result = await listMinhasNotificacoes();

      expect(rpc).toHaveBeenCalledWith("listar_minhas_notificacoes", { _somente_nao_lidas: false, _limite: 30 });
      expect(result).toEqual([
        {
          destinatarioId: "d1",
          notificacaoId: "n1",
          categoria: "operacional",
          tipo: "locacao_criada",
          titulo: "Nova locação criada",
          mensagem: "LOC-1 · Cliente X · 2 materiais",
          referenciaTipo: "locacao",
          referenciaId: "loc-1",
          rota: "/locacoes?locacao=loc-1",
          lida: false,
          lidaEm: null,
          createdAt: "2026-08-19T10:00:00Z",
        },
      ]);
    });

    it("passes somenteNaoLidas/limite through when given", async () => {
      rpc.mockResolvedValue({ data: [], error: null });
      await listMinhasNotificacoes({ somenteNaoLidas: true, limite: 5 });
      expect(rpc).toHaveBeenCalledWith("listar_minhas_notificacoes", { _somente_nao_lidas: true, _limite: 5 });
    });

    it("returns an empty list instead of null when the RPC returns no rows", async () => {
      rpc.mockResolvedValue({ data: null, error: null });
      expect(await listMinhasNotificacoes()).toEqual([]);
    });

    it("throws the RPC error message on failure", async () => {
      rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
      await expect(listMinhasNotificacoes()).rejects.toThrow("boom");
    });
  });

  describe("marcarNotificacaoLida / marcarTodasNotificacoesLidas / excluirMinhasNotificacoesLidas / setNotificacaoPreferencia", () => {
    it("marcarNotificacaoLida sends the destinatario id", async () => {
      rpc.mockResolvedValue({ error: null });
      await marcarNotificacaoLida("d1");
      expect(rpc).toHaveBeenCalledWith("marcar_notificacao_lida", { _destinatario_id: "d1" });
    });

    it("marcarNotificacaoLida throws on error", async () => {
      rpc.mockResolvedValue({ error: { message: "falhou" } });
      await expect(marcarNotificacaoLida("d1")).rejects.toThrow("falhou");
    });

    it("marcarTodasNotificacoesLidas calls the RPC with no args", async () => {
      rpc.mockResolvedValue({ error: null });
      await marcarTodasNotificacoesLidas();
      expect(rpc).toHaveBeenCalledWith("marcar_todas_notificacoes_lidas");
    });

    it("excluirMinhasNotificacoesLidas calls the RPC with no args", async () => {
      rpc.mockResolvedValue({ error: null });
      await excluirMinhasNotificacoesLidas();
      expect(rpc).toHaveBeenCalledWith("excluir_minhas_notificacoes_lidas");
    });

    it("excluirMinhasNotificacoesLidas throws on error", async () => {
      rpc.mockResolvedValue({ error: { message: "falhou" } });
      await expect(excluirMinhasNotificacoesLidas()).rejects.toThrow("falhou");
    });

    it("setNotificacaoPreferencia sends tipo and habilitada", async () => {
      rpc.mockResolvedValue({ error: null });
      await setNotificacaoPreferencia("locacao_atrasada", false);
      expect(rpc).toHaveBeenCalledWith("set_notificacao_preferencia", { _tipo: "locacao_atrasada", _habilitada: false });
    });
  });

  describe("getPushSubscriptionState", () => {
    it("returns 'unsupported' when the Push API is unavailable", async () => {
      expect(await getPushSubscriptionState()).toBe("unsupported");
    });

    it("returns 'denied' when Notification.permission is denied, without checking for a live subscription", async () => {
      const { pushManager } = definePushApis({ notificationPermission: "denied" });
      expect(await getPushSubscriptionState()).toBe("denied");
      expect(pushManager.getSubscription).not.toHaveBeenCalled();
    });

    it("returns 'subscribed' when a PushSubscription already exists", async () => {
      definePushApis({
        notificationPermission: "granted",
        getSubscription: vi.fn().mockResolvedValue({ endpoint: "https://push.example/1" }),
      });
      expect(await getPushSubscriptionState()).toBe("subscribed");
    });

    it("returns 'not-subscribed' when permission is granted but there is no active subscription", async () => {
      definePushApis({ notificationPermission: "granted", getSubscription: vi.fn().mockResolvedValue(null) });
      expect(await getPushSubscriptionState()).toBe("not-subscribed");
    });
  });

  describe("subscribeToPush", () => {
    it("throws when the browser does not support push", async () => {
      await expect(subscribeToPush("empresa-1")).rejects.toThrow("Este navegador não suporta notificações push.");
    });

    it("throws when VITE_VAPID_PUBLIC_KEY is not configured", async () => {
      definePushApis();
      vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "");
      await expect(subscribeToPush("empresa-1")).rejects.toThrow("Notificações push não configuradas neste ambiente.");
    });

    it("throws when the user denies the permission prompt", async () => {
      definePushApis({ requestPermission: vi.fn().mockResolvedValue("denied") });
      vi.stubEnv("VITE_VAPID_PUBLIC_KEY", VALID_VAPID_KEY);
      await expect(subscribeToPush("empresa-1")).rejects.toThrow("Permissão de notificações negada.");
    });

    it("subscribes and registers the endpoint/keys with the backend", async () => {
      const subscription = {
        toJSON: () => ({ endpoint: "https://push.example/1", keys: { p256dh: "p256dh-key", auth: "auth-key" } }),
      };
      const { pushManager } = definePushApis({
        getSubscription: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockResolvedValue(subscription),
      });
      vi.stubEnv("VITE_VAPID_PUBLIC_KEY", VALID_VAPID_KEY);
      rpc.mockResolvedValue({ error: null });

      await subscribeToPush("empresa-1");

      expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
      expect(rpc).toHaveBeenCalledWith("registrar_push_subscription", {
        _empresa_id: "empresa-1",
        _endpoint: "https://push.example/1",
        _p256dh: "p256dh-key",
        _auth: "auth-key",
        _user_agent: expect.any(String),
      });
    });

    it("reuses an existing browser subscription instead of creating a new one", async () => {
      const subscription = {
        toJSON: () => ({ endpoint: "https://push.example/existing", keys: { p256dh: "p", auth: "a" } }),
      };
      const { pushManager } = definePushApis({ getSubscription: vi.fn().mockResolvedValue(subscription) });
      vi.stubEnv("VITE_VAPID_PUBLIC_KEY", VALID_VAPID_KEY);
      rpc.mockResolvedValue({ error: null });

      await subscribeToPush("empresa-1");

      expect(pushManager.subscribe).not.toHaveBeenCalled();
      expect(rpc).toHaveBeenCalledWith(
        "registrar_push_subscription",
        expect.objectContaining({ _endpoint: "https://push.example/existing" }),
      );
    });

    it("throws when the resulting subscription is missing endpoint/keys", async () => {
      const subscription = { toJSON: () => ({ endpoint: "https://push.example/1", keys: {} }) };
      definePushApis({ subscribe: vi.fn().mockResolvedValue(subscription) });
      vi.stubEnv("VITE_VAPID_PUBLIC_KEY", VALID_VAPID_KEY);

      await expect(subscribeToPush("empresa-1")).rejects.toThrow("Inscrição de push inválida.");
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribeFromPush", () => {
    it("does nothing when there is no active subscription", async () => {
      definePushApis({ getSubscription: vi.fn().mockResolvedValue(null) });
      await unsubscribeFromPush();
      expect(rpc).not.toHaveBeenCalled();
    });

    it("deactivates server-side and unsubscribes the browser subscription", async () => {
      const unsubscribe = vi.fn().mockResolvedValue(true);
      const subscription = { endpoint: "https://push.example/1", unsubscribe };
      definePushApis({ getSubscription: vi.fn().mockResolvedValue(subscription) });
      rpc.mockResolvedValue({ error: null });

      await unsubscribeFromPush();

      expect(rpc).toHaveBeenCalledWith("remover_push_subscription", { _endpoint: "https://push.example/1" });
      expect(unsubscribe).toHaveBeenCalled();
    });

    it("still unsubscribes the browser subscription even if the backend call fails", async () => {
      const unsubscribe = vi.fn().mockResolvedValue(true);
      const subscription = { endpoint: "https://push.example/1", unsubscribe };
      definePushApis({ getSubscription: vi.fn().mockResolvedValue(subscription) });
      rpc.mockResolvedValue({ error: { message: "falhou" } });

      await unsubscribeFromPush();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });
});
