import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  saveStockLocation,
  setStockLocationActive,
} from "@/lib/stock-service";
import { STOCK_LOCATION_TYPE_LABELS } from "@/lib/stock-domain";
import type { StockLocation } from "@/lib/stock-types";

export function StockLocationManager({
  open,
  onOpenChange,
  companyId,
  locations,
  canWrite,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  locations: StockLocation[];
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<StockLocation | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<StockLocation["tipo"]>("deposito");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!formOpen) return;
    setCode(editing?.codigo ?? "");
    setName(editing?.nome ?? "");
    setType(editing?.tipo ?? "deposito");
    setParentId(editing?.localizacao_pai_id ?? "");
    setDescription(editing?.descricao ?? "");
  }, [editing, formOpen]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!code.trim() || !name.trim()) {
        throw new Error("Informe o código e o nome.");
      }
      return saveStockLocation({
        companyId,
        id: editing?.id,
        code,
        name,
        type,
        parentId: parentId || null,
        description,
      });
    },
    onSuccess: async () => {
      await onChanged();
      setFormOpen(false);
      setEditing(null);
      toast({ title: editing ? "Localização atualizada" : "Localização criada" });
    },
    onError: (error: Error) =>
      toast({
        title: "Não foi possível salvar a localização",
        description: error.message,
        variant: "destructive",
      }),
  });

  const changeMutation = useMutation({
    mutationFn: async ({
      location,
    }: {
      location: StockLocation;
    }) => {
      return setStockLocationActive(companyId, location.id, !location.ativa);
    },
    onSuccess: async () => {
      await onChanged();
      toast({ title: "Localização atualizada" });
    },
    onError: (error: Error) =>
      toast({
        title: "Não foi possível alterar a localização",
        description: error.message,
        variant: "destructive",
      }),
  });

  const fullPath = (location: StockLocation) => {
    const parts = [location.nome];
    let parent = locations.find(
      (candidate) => candidate.id === location.localizacao_pai_id,
    );
    const visited = new Set([location.id]);
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      parts.unshift(parent.nome);
      parent = locations.find(
        (candidate) => candidate.id === parent?.localizacao_pai_id,
      );
    }
    return parts.join(" → ");
  };
  const unavailableParentIds = new Set<string>();
  if (editing) {
    unavailableParentIds.add(editing.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const location of locations) {
        if (
          location.localizacao_pai_id &&
          unavailableParentIds.has(location.localizacao_pai_id) &&
          !unavailableParentIds.has(location.id)
        ) {
          unavailableParentIds.add(location.id);
          changed = true;
        }
      }
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Localizações de estoque</DialogTitle>
            <DialogDescription>
              Estrutura hierárquica oficial para saldos e movimentações.
            </DialogDescription>
          </DialogHeader>
          {canWrite && (
            <div>
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Nova localização
              </Button>
            </div>
          )}
          <div className="space-y-2">
            {locations.length === 0 && (
              <p className="rounded-md border border-dashed p-6 text-center text-muted-foreground">
                Nenhuma localização cadastrada.
              </p>
            )}
            {locations.map((location) => (
              <div
                key={location.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{location.codigo}</span>
                    <span className="font-medium">{location.nome}</span>
                    <Badge variant={location.ativa ? "default" : "secondary"}>
                      {location.ativa ? "Ativa" : "Inativa"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {STOCK_LOCATION_TYPE_LABELS[location.tipo]} ·{" "}
                    {fullPath(location)}
                  </p>
                </div>
                {canWrite && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Editar"
                      onClick={() => {
                        setEditing(location);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={location.ativa ? "Inativar" : "Reativar"}
                      onClick={() =>
                        changeMutation.mutate({ location })
                      }
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar localização" : "Nova localização"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Código *</Label>
              <Input value={code} onChange={(event) => setCode(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={type}
                onValueChange={(value) => setType(value as StockLocation["tipo"])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STOCK_LOCATION_TYPE_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Localização superior</Label>
              <Select value={parentId || "root"} onValueChange={(value) => setParentId(value === "root" ? "" : value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Sem localização superior</SelectItem>
                  {locations
                    .filter(
                      (location) => !unavailableParentIds.has(location.id),
                    )
                    .map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.codigo} · {fullPath(location)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-full space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
