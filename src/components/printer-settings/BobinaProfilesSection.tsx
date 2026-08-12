import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Edit, Loader2, Plus, Star, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { deleteBobinaProfile, duplicateBobinaProfile, listBobinaProfiles, setDefaultBobinaProfile } from "@/lib/bobina-profile-service";
import type { BobinaProfile } from "@/lib/bobina-profile-types";
import { BobinaPreview } from "./BobinaPreview";
import { BobinaProfileDialog } from "./BobinaProfileDialog";

export function BobinaProfilesSection({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BobinaProfile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BobinaProfile | null>(null);

  const profilesQuery = useQuery({
    queryKey: ["bobina-profiles", companyId],
    queryFn: () => listBobinaProfiles(companyId),
    enabled: Boolean(companyId),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["bobina-profiles", companyId] });

  const duplicateMutation = useMutation({
    mutationFn: (target: BobinaProfile) => duplicateBobinaProfile(companyId, target.id),
    onSuccess: async () => { await invalidate(); toast({ title: "Perfil duplicado" }); },
    onError: (error: Error) => toast({ title: "Não foi possível duplicar", description: error.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBobinaProfile(companyId, id),
    onSuccess: async () => { await invalidate(); toast({ title: "Perfil excluído" }); },
    onError: (error: Error) => toast({ title: "Não foi possível excluir", description: error.message, variant: "destructive" }),
  });
  const defaultMutation = useMutation({
    mutationFn: (id: string) => setDefaultBobinaProfile(companyId, id),
    onSuccess: async () => { await invalidate(); toast({ title: "Perfil definido como padrão" }); },
    onError: (error: Error) => toast({ title: "Não foi possível definir o padrão", description: error.message, variant: "destructive" }),
  });

  const profiles = profilesQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          Perfis de bobina
          {canManage && (
            <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" />Novo perfil
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          Configuração de mídia (tamanho da etiqueta, colunas por linha, espaçamentos, margens e DPI), reutilizável por qualquer
          impressora Windows configurada. A mesma impressora pode trocar de perfil quando a bobina física é trocada.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {profilesQuery.isLoading ? (
          <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : !profiles.length ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhum perfil de bobina cadastrado. Sem um perfil selecionado, a impressão usa o tamanho do modelo de etiqueta, em 1 coluna.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {profiles.map((bobinaProfile) => (
              <div key={bobinaProfile.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{bobinaProfile.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {Number(bobinaProfile.largura_etiqueta_mm)} × {Number(bobinaProfile.altura_etiqueta_mm)} mm ·{" "}
                      {bobinaProfile.colunas} coluna{bobinaProfile.colunas > 1 ? "s" : ""}
                    </p>
                  </div>
                  {bobinaProfile.padrao && <Badge>Padrão</Badge>}
                </div>
                <BobinaPreview profile={bobinaProfile} rows={2} />
                {canManage && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Button size="sm" variant="outline" onClick={() => { setEditing(bobinaProfile); setDialogOpen(true); }}>
                      <Edit className="mr-1 h-3.5 w-3.5" />Editar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => duplicateMutation.mutate(bobinaProfile)} disabled={duplicateMutation.isPending}>
                      <Copy className="mr-1 h-3.5 w-3.5" />Duplicar
                    </Button>
                    {!bobinaProfile.padrao && (
                      <Button size="sm" variant="outline" onClick={() => defaultMutation.mutate(bobinaProfile.id)} disabled={defaultMutation.isPending}>
                        <Star className="mr-1 h-3.5 w-3.5" />Tornar padrão
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(bobinaProfile)}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" />Excluir
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <BobinaProfileDialog
        open={dialogOpen} onOpenChange={setDialogOpen} companyId={companyId} profile={editing}
        onSaved={async () => { await invalidate(); }}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir perfil de bobina?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.nome}" deixará de aparecer na lista. Impressoras configuradas com este perfil voltam a imprimir com o
              tamanho do modelo de etiqueta (1 coluna) até que outro perfil seja selecionado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteTarget) { deleteMutation.mutate(deleteTarget.id); setDeleteTarget(null); } }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
