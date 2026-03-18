export const statusColors: Record<string, string> = {
  confirmado: "bg-accent text-accent-foreground",
  pendente: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
  cancelado: "bg-destructive text-destructive-foreground",
  em_negociacao: "bg-secondary text-secondary-foreground",
  finalizado: "bg-primary text-primary-foreground",
};

export const statusLabels: Record<string, string> = {
  confirmado: "Confirmado",
  pendente: "Pendente",
  cancelado: "Cancelado",
  em_negociacao: "Em Negociação",
  finalizado: "Finalizado",
};
