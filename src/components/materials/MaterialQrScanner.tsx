import { useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, Flashlight, FlashlightOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import type QrScannerType from "qr-scanner";

type CameraStatus = "starting" | "scanning" | "error";

// Camera lifecycle/UI only - this component never talks to Supabase, never
// knows about empresa/locação/check-in/check-out, and never validates
// anything about the material. It hands back whatever text the QR decoded
// to, verbatim, via onDetected - the caller feeds that into the exact same
// identification flow already used by manual typing and USB/Bluetooth
// scanners (see CheckinCheckout.tsx's executeSearch).
export interface MaterialQrScannerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (code: string) => void;
}

function mapCameraError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Permissão de câmera negada. Permita o acesso à câmera nas configurações do navegador e tente novamente.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Nenhuma câmera foi encontrada neste dispositivo.";
    case "NotReadableError":
    case "TrackStartError":
      return "A câmera está em uso por outro aplicativo ou não está disponível agora.";
    default:
      return "Não foi possível iniciar a câmera. Tente novamente.";
  }
}

export function MaterialQrScanner({ open, onOpenChange, onDetected }: MaterialQrScannerProps) {
  const isMobile = useIsMobile();
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScannerType | null>(null);
  const detectedRef = useRef(false);
  const [status, setStatus] = useState<CameraStatus>("starting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasFlash, setHasFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);

  // Read through refs inside the effect instead of depending on
  // onDetected/onOpenChange directly - both are typically fresh inline
  // closures from the parent on every render, and this effect must only
  // restart the camera when `open` actually changes, never on unrelated
  // re-renders of the caller while the scanner is already running.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return undefined;

    detectedRef.current = false;
    setStatus("starting");
    setErrorMessage(null);
    setHasFlash(false);
    setFlashOn(false);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setErrorMessage("Este navegador não tem suporte à leitura de QR Code pela câmera.");
      return undefined;
    }

    let cancelled = false;
    let instance: QrScannerType | null = null;

    void (async () => {
      try {
        const { default: QrScanner } = await import("qr-scanner");
        if (cancelled || !videoRef.current) return;

        instance = new QrScanner(
          videoRef.current,
          (result) => {
            // First valid read wins - ignore every callback after it,
            // including ones already in flight for frames decoded before
            // destroy() below takes effect.
            if (detectedRef.current) return;
            const code = result.data.trim();
            if (!code) return;
            detectedRef.current = true;
            instance?.destroy();
            scannerRef.current = null;
            onOpenChangeRef.current(false);
            onDetectedRef.current(code);
          },
          {
            preferredCamera: "environment",
            // Our own frame below is the visual scan-area indicator - the
            // library's built-in overlays are redundant on top of it.
            highlightScanRegion: false,
            highlightCodeOutline: false,
            onDecodeError: () => {
              // Fires continuously while no QR is in frame - expected noise, not a real error.
            },
          },
        );
        scannerRef.current = instance;

        await instance.start();
        if (cancelled) {
          instance.destroy();
          return;
        }
        setStatus("scanning");

        try {
          const flashSupported = await instance.hasFlash();
          if (!cancelled) setHasFlash(flashSupported);
        } catch {
          // Flash support probing failing must not affect scanning.
        }
      } catch (error) {
        instance?.destroy();
        scannerRef.current = null;
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(mapCameraError(error));
      }
    })();

    return () => {
      cancelled = true;
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, [open]);

  const toggleFlash = async () => {
    if (!scannerRef.current) return;
    try {
      await scannerRef.current.toggleFlash();
      setFlashOn(scannerRef.current.isFlashOn());
    } catch {
      // Torch control failing must not interrupt scanning.
    }
  };

  const body = (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-lg bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {status === "scanning" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-10">
            <div className="h-full w-full rounded-lg border-4 border-white/80" />
          </div>
        )}
        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
            <Loader2 className="h-8 w-8 animate-spin" data-testid="qr-scanner-loading" />
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-4 text-center text-sm text-white">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <p role="alert">{errorMessage}</p>
          </div>
        )}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Posicione o QR Code da etiqueta dentro da área marcada.
      </p>
      {hasFlash && status === "scanning" && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" onClick={toggleFlash}>
            {flashOn ? <FlashlightOff className="mr-2 h-4 w-4" /> : <Flashlight className="mr-2 h-4 w-4" />}
            {flashOn ? "Desligar lanterna" : "Ligar lanterna"}
          </Button>
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2"><Camera className="h-4 w-4" /> Ler QR Code</DrawerTitle>
            <DrawerDescription>Aponte a câmera para o QR Code da etiqueta do material.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-2">{body}</div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button type="button" variant="secondary" className="h-12 w-full">Fechar</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Camera className="h-4 w-4" /> Ler QR Code</DialogTitle>
          <DialogDescription>Aponte a câmera para o QR Code da etiqueta do material.</DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
