import { useUpdate } from "./UpdateProvider";
import { Download, X, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

export const UpdateBanner = () => {
  const { updateAvailable, isUpdating, newVersion, installUpdate, dismissUpdate } = useUpdate();

  return (
    <AnimatePresence>
      {updateAvailable && (
        <motion.div
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed top-0 left-0 right-0 z-[9999]"
        >
          <div className="relative overflow-hidden bg-gradient-to-r from-[hsl(270,80%,20%)] via-[hsl(280,90%,15%)] to-[hsl(320,80%,18%)] border-b border-primary/30 shadow-[0_4px_30px_rgba(168,85,247,0.25)]">
            {/* Animated glow line */}
            <div className="absolute inset-x-0 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-primary to-transparent animate-pulse" />

            <div className="flex items-center justify-center gap-3 px-4 py-2.5 text-sm">
              <Sparkles className="h-4 w-4 text-primary animate-pulse shrink-0" />

              <span className="text-white/90 font-medium">
                Nova versão disponível
                {newVersion && (
                  <span className="ml-1.5 text-primary font-semibold">v{newVersion}</span>
                )}
              </span>

              <Button
                size="sm"
                onClick={installUpdate}
                disabled={isUpdating}
                className="ml-2 h-7 px-3 text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_rgba(168,85,247,0.4)] hover:shadow-[0_0_30px_rgba(168,85,247,0.6)] transition-all"
              >
                {isUpdating ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Atualizando...
                  </>
                ) : (
                  <>
                    <Download className="h-3 w-3 mr-1" />
                    Atualizar agora
                  </>
                )}
              </Button>

              {!isUpdating && (
                <button
                  onClick={dismissUpdate}
                  className="ml-1 p-1 rounded-full text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
                  aria-label="Dispensar"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
