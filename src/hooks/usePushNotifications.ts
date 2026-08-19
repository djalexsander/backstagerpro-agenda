import { useCallback, useEffect, useState } from "react";
import {
  getPushSubscriptionState,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  type PushSupportState,
} from "@/lib/push-notifications-service";

/**
 * Estado local de inscrição de push para o dispositivo atual + ações de
 * ativar/desativar. Nunca pede permissão sozinho no mount (subscribe() deve
 * ser chamado a partir de um clique do usuário) - só reflete o estado atual
 * do navegador/registro.
 */
export function usePushNotifications(empresaId: string | null) {
  const [state, setState] = useState<PushSupportState>("unsupported");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isPushSupported()) {
      setState("unsupported");
      return;
    }
    setState(await getPushSubscriptionState());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const subscribe = useCallback(async () => {
    if (!empresaId) return;
    setIsLoading(true);
    setError(null);
    try {
      await subscribeToPush(empresaId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao ativar notificações.");
    } finally {
      setIsLoading(false);
    }
  }, [empresaId, refresh]);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await unsubscribeFromPush();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao desativar notificações.");
    } finally {
      setIsLoading(false);
    }
  }, [refresh]);

  return { state, isLoading, error, subscribe, unsubscribe };
}
