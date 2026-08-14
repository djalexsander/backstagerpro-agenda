import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, Radio, RefreshCw, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { normalizeEpc } from "@/lib/rfid-domain";
import { deactivateTag, linkOrReplaceTag, listMaterialTags } from "@/lib/rfid-service";
import { RFID_TAG_STATUS_LABELS, type RfidTagStatus } from "@/lib/rfid-types";
import type { MaterialWithRelations } from "@/lib/material-types";

const DEACTIVATE_REASONS: Exclude<RfidTagStatus, "ativa">[] = ["inativa", "danificada", "perdida"];

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function tagStatusBadgeVariant(status: RfidTagStatus): "default" | "secondary" | "destructive" {
  if (status === "ativa") return "default";
  if (status === "danificada" || status === "perdida") return "destructive";
  return "secondary";
}

/**
 * Seção RFID do cadastro/detalhe de material - vincular/trocar/desativar
 * tag e consultar histórico. Nesta primeira etapa o EPC é digitado/colado
 * manualmente (sem reader físico ainda); a mesma RPC (rfid_link_or_replace_tag)
 * atenderá a captura automática de um reader real mais adiante sem mudar
 * este componente.
 */
export function MaterialRfidSection({
  material,
  companyId,
  canView,
  canManage,
}: {
  material: MaterialWithRelations;
  companyId: string | null;
  canView: boolean;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [epcInput, setEpcInput] = useState("");
  const [deactivateReason, setDeactivateReason] = useState<Exclude<RfidTagStatus, "ativa">>("inativa");
  const [deactivateNote, setDeactivateNote] = useState("");
  const canTag = material.tipo_controle === "individual";
  const enabled = Boolean(companyId && canView);

  const tagsQuery = useQuery({
    queryKey: ["rfid-material-tags", companyId, material.id],
    queryFn: () => listMaterialTags(material.id),
    enabled,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["rfid-material-tags", companyId, material.id] });

  const linkMutation = useMutation({
    mutationFn: (epc: string) => linkOrReplaceTag(material.id, epc),
    onSuccess: async () => {
      setEpcInput("");
      await invalidate();
      toast({ title: "Tag RFID vinculada" });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível vincular a tag", description: error.message, variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (tagId: string) => deactivateTag(tagId, deactivateReason, deactivateNote || undefined),
    onSuccess: async () => {
      setDeactivateNote("");
      await invalidate();
      toast({ title: "Vínculo de tag removido" });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível remover o vínculo", description: error.message, variant: "destructive" }),
  });

  if (!enabled) return null;

  const tags = tagsQuery.data ?? [];
  const activeTag = tags.find((tag) => tag.status === "ativa") ?? null;
  const history = tags.filter((tag) => tag.id !== activeTag?.id);
  const normalizedInput = normalizeEpc(epcInput);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="h-4 w-4 text-primary" />
            RFID UHF
          </CardTitle>
          <Badge variant={activeTag ? "default" : "outline"}>
            {activeTag ? "Tag vinculada" : "Sem tag"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canTag && (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Este material tem controle por quantidade - uma tag RFID identifica uma unidade física
            específica, então só materiais de controle individual podem receber vínculo.
          </p>
        )}

        {tagsQuery.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {activeTag && (
          <div>
            <p className="text-xs text-muted-foreground">EPC ativo</p>
            <code className="mt-1 block break-all rounded bg-muted px-2 py-1.5 text-xs">{activeTag.epc}</code>
            <p className="mt-1 text-xs text-muted-foreground">
              Vinculada em {formatDateTime(activeTag.vinculada_em)}
            </p>
          </div>
        )}

        {canManage && canTag && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {activeTag ? "Trocar tag (a atual será desativada e preservada no histórico)" : "Vincular tag"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                value={epcInput}
                onChange={(event) => setEpcInput(event.target.value)}
                placeholder="Digite ou cole o EPC"
                className="max-w-xs font-mono"
              />
              <Button
                type="button"
                disabled={!normalizedInput || linkMutation.isPending}
                onClick={() => normalizedInput && linkMutation.mutate(normalizedInput)}
              >
                {linkMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {activeTag ? "Trocar tag" : "Vincular tag"}
              </Button>
            </div>
            {epcInput && !normalizedInput && (
              <p className="text-xs text-destructive">EPC inválido - use de 8 a 64 caracteres hexadecimais.</p>
            )}
          </div>
        )}

        {canManage && activeTag && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-medium text-muted-foreground">Remover/desativar vínculo</p>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={deactivateReason} onValueChange={(value) => setDeactivateReason(value as typeof deactivateReason)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEACTIVATE_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {RFID_TAG_STATUS_LABELS[reason]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={deactivateNote}
                onChange={(event) => setDeactivateNote(event.target.value)}
                placeholder="Motivo (opcional)"
                className="max-w-xs"
              />
              <Button
                type="button"
                variant="outline"
                disabled={deactivateMutation.isPending}
                onClick={() => deactivateMutation.mutate(activeTag.id)}
              >
                {deactivateMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Unlink className="mr-2 h-4 w-4" />
                )}
                Remover vínculo
              </Button>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <History className="h-3.5 w-3.5" />
              Histórico
            </p>
            <div className="space-y-1.5">
              {history.map((tag) => (
                <div key={tag.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs">
                  <code className="break-all">{tag.epc}</code>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>
                      {formatDateTime(tag.vinculada_em)} → {formatDateTime(tag.desativada_em)}
                    </span>
                    <Badge variant={tagStatusBadgeVariant(tag.status)}>{RFID_TAG_STATUS_LABELS[tag.status]}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!activeTag && history.length === 0 && !tagsQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Nenhuma tag vinculada a este material ainda.</p>
        )}
      </CardContent>
    </Card>
  );
}
