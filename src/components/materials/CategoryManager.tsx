import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { MaterialCategory } from "@/lib/material-types";
import {
  deleteUnusedMaterialCategory,
  saveMaterialCategory,
  setMaterialCategoryActive,
} from "@/lib/material-service";

export function CategoryManager({
  open,
  onOpenChange,
  empresaId,
  categories,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaId: string;
  categories: MaterialCategory[];
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<MaterialCategory | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setEditing(null);
    setName("");
    setDescription("");
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error("O nome da categoria é obrigatório.");
      return saveMaterialCategory({
        empresaId,
        id: editing?.id,
        nome: name,
        descricao: description,
      });
    },
    onSuccess: async () => {
      await onChanged();
      toast({ title: editing ? "Categoria atualizada" : "Categoria criada" });
      reset();
    },
    onError: (error: Error) =>
      toast({
        title: "Não foi possível salvar a categoria",
        description: error.message,
        variant: "destructive",
      }),
  });

  const activeMutation = useMutation({
    mutationFn: (category: MaterialCategory) =>
      setMaterialCategoryActive({
        empresaId,
        id: category.id,
        active: !category.ativo,
      }),
    onSuccess: onChanged,
    onError: (error: Error) =>
      toast({
        title: "Não foi possível alterar a categoria",
        description: error.message,
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (category: MaterialCategory) =>
      deleteUnusedMaterialCategory({ empresaId, id: category.id }),
    onSuccess: async () => {
      await onChanged();
      toast({ title: "Categoria excluída" });
    },
    onError: (error: Error) =>
      toast({
        title: "Categoria não pode ser excluída",
        description: error.message.includes("Categoria em uso")
          ? "A categoria possui materiais vinculados. Inative-a."
          : error.message,
        variant: "destructive",
      }),
  });

  const startEdit = (category: MaterialCategory) => {
    setEditing(category);
    setName(category.nome);
    setDescription(category.descricao ?? "");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Categorias de materiais</DialogTitle>
        </DialogHeader>

        <form
          className="rounded-lg border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!saveMutation.isPending) saveMutation.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="material-category-name">Nome *</Label>
              <Input
                id="material-category-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Áudio"
              />
            </div>
            <div className="flex items-end gap-2">
              {editing && (
                <Button type="button" variant="outline" onClick={reset}>
                  Cancelar
                </Button>
              )}
              <Button
                type="submit"
                disabled={saveMutation.isPending || !name.trim()}
              >
                {editing ? (
                  <Pencil className="mr-2 h-4 w-4" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {saveMutation.isPending
                  ? "Salvando..."
                  : editing
                    ? "Atualizar"
                    : "Adicionar"}
              </Button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <Label htmlFor="material-category-description">Descrição</Label>
            <Textarea
              id="material-category-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
            />
          </div>
        </form>

        <div className="space-y-2">
          {categories.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma categoria cadastrada.
            </p>
          ) : (
            categories.map((category) => (
              <div
                key={category.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{category.nome}</p>
                    <Badge variant={category.ativo ? "default" : "secondary"}>
                      {category.ativo ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                  {category.descricao && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {category.descricao}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit(category)}
                    title="Editar"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => activeMutation.mutate(category)}
                    title={category.ativo ? "Inativar" : "Reativar"}
                  >
                    <Power className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => deleteMutation.mutate(category)}
                    title="Excluir se não utilizada"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
