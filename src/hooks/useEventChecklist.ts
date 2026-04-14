import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const CHECKLIST_CATEGORIES = [
  { value: "som", label: "Som" },
  { value: "iluminacao", label: "Iluminação" },
  { value: "palco", label: "Palco" },
  { value: "rider_tecnico", label: "Rider Técnico" },
  { value: "equipe", label: "Equipe" },
  { value: "transporte", label: "Transporte" },
  { value: "observacoes_gerais", label: "Observações Gerais" },
] as const;

export type ChecklistCategory = (typeof CHECKLIST_CATEGORIES)[number]["value"];

export interface ChecklistItem {
  id: string;
  event_id: string;
  empresa_id: string;
  categoria: string;
  descricao: string;
  concluido: boolean;
  observacao: string | null;
  ordem: number;
  created_at: string;
  updated_at: string;
}

export function useEventChecklist(eventId: string | undefined) {
  const { empresaId } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["event-checklist", eventId];

  const { data: items = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!eventId) return [];
      const { data, error } = await supabase
        .from("event_checklist_items")
        .select("*")
        .eq("event_id", eventId)
        .order("categoria")
        .order("ordem");
      if (error) throw error;
      return data as ChecklistItem[];
    },
    enabled: !!eventId,
  });

  const addItem = useMutation({
    mutationFn: async (input: { descricao: string; categoria: string; observacao?: string }) => {
      if (!eventId || !empresaId) throw new Error("Missing context");
      const maxOrdem = items.filter(i => i.categoria === input.categoria).reduce((max, i) => Math.max(max, i.ordem), -1);
      const { error } = await supabase.from("event_checklist_items").insert({
        event_id: eventId,
        empresa_id: empresaId,
        categoria: input.categoria,
        descricao: input.descricao,
        observacao: input.observacao || null,
        ordem: maxOrdem + 1,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const toggleItem = useMutation({
    mutationFn: async ({ id, concluido }: { id: string; concluido: boolean }) => {
      const { error } = await supabase
        .from("event_checklist_items")
        .update({ concluido } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; descricao?: string; observacao?: string; categoria?: string }) => {
      const { error } = await supabase
        .from("event_checklist_items")
        .update(updates as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("event_checklist_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const batchAddItems = async (batchItems: { descricao: string; categoria: string }[]) => {
    if (!eventId || !empresaId) throw new Error("Missing context");
    const rows = batchItems.map((item, i) => ({
      event_id: eventId,
      empresa_id: empresaId,
      categoria: item.categoria,
      descricao: item.descricao,
      ordem: i,
    }));
    const { error } = await supabase.from("event_checklist_items").insert(rows as any);
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey });
  };

  const total = items.length;
  const concluidos = items.filter(i => i.concluido).length;
  const progress = total > 0 ? Math.round((concluidos / total) * 100) : 0;

  const byCategory = CHECKLIST_CATEGORIES.map(cat => ({
    ...cat,
    items: items.filter(i => i.categoria === cat.value),
    total: items.filter(i => i.categoria === cat.value).length,
    concluidos: items.filter(i => i.categoria === cat.value && i.concluido).length,
  })).filter(c => c.total > 0);

  return { items, isLoading, addItem, toggleItem, updateItem, deleteItem, batchAddItems, total, concluidos, progress, byCategory };
}
