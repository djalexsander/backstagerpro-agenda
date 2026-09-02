import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import type { ScannerRemotoSessao } from "@/lib/scanner-remoto-types";

// "Finalizar sessão" - ação compartilhada entre a lista "Sessões abertas" da
// tela ScannerRemoto.tsx (celular/PWA) e o RemoteScannerSessionsPanel.tsx
// (desktop), para as duas usarem exatamente o mesmo fluxo de confirmação e
// encerramento sem duplicar a lógica.
//
// Encerrar NÃO apaga nada: `endSession` chama a RPC já existente
// encerrar_sessao_scanner_remoto, que só troca o status da sessão para
// 'encerrada'. As leituras (scanner_remoto_leituras), as movimentações e
// custódias já registradas (via registrar_checkout_material/
// registrar_checkin_material) e a rastreabilidade continuam intactas - a
// sessão apenas deixa de estar aberta.
export function FinalizeScannerSessionButton({
  session,
  endSession,
  onFinalized,
  variant = "ghost",
  size = "sm",
}: {
  session: ScannerRemotoSessao;
  /** O `endSession` do useScannerRemoto - já invalida as queries de sessões/leituras. */
  endSession: (sessionId: string) => Promise<unknown>;
  /** Chamado só após o encerramento dar certo (ex.: limpar a seleção local). */
  onFinalized?: (sessionId: string) => void;
  variant?: "ghost" | "outline";
  size?: "sm" | "default";
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const finalize = async () => {
    setPending(true);
    try {
      await endSession(session.id);
      setOpen(false);
      onFinalized?.(session.id);
      toast({ title: "Sessão finalizada" });
    } catch (error) {
      // Falha no encerramento não muda nada no servidor: a sessão continua
      // aberta na lista. Mantém o diálogo aberto para uma nova tentativa.
      toast({
        title: "Não foi possível finalizar a sessão",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className="shrink-0"
        onClick={() => setOpen(true)}
      >
        <LogOut className="mr-1 h-3.5 w-3.5" /> Finalizar
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalizar sessão</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja finalizar esta sessão? As leituras e movimentações já
              realizadas serão preservadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                // Sem o preventDefault o Radix fecha o diálogo no clique, antes
                // de sabermos se o encerramento deu certo - aqui só fechamos no
                // sucesso (ver finalize()).
                event.preventDefault();
                void finalize();
              }}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Finalizar sessão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
