import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CustomerCombobox } from "@/components/material-rentals/CustomerCombobox";
import { createMaterialRental, saveRentalCustomer } from "@/lib/material-rental-service";
import { toDatetimeLocalValue } from "@/lib/datetime";
import type { CustodyResponsibleOption } from "@/lib/checkin-checkout-types";
import type { CustomerOption } from "@/lib/material-rental-types";

// Delegates the local-time conversion to the shared, tested helper instead
// of reimplementing the same getTimezoneOffset subtraction independently
// (was previously duplicated here, byte-for-byte the same math as
// toDatetimeLocalValue - see src/lib/datetime.ts).
function localDateTime(hoursAhead: number) {
  return toDatetimeLocalValue(new Date(Date.now() + hoursAhead * 60 * 60 * 1000));
}

export function NewRentalDialog({
  open,
  onOpenChange,
  companyId,
  customers,
  responsibles,
  onCreated,
  onCustomerCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  customers: CustomerOption[];
  responsibles: CustodyResponsibleOption[];
  onCreated: (rentalId: string) => Promise<void> | void;
  onCustomerCreated: () => Promise<void> | void;
}) {
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const customerId = customer?.id ?? "";
  const [withdrawalAt, setWithdrawalAt] = useState(() => localDateTime(24));
  const [returnAt, setReturnAt] = useState(() => localDateTime(72));
  const [responsible, setResponsible] = useState("");
  const [notes, setNotes] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const createRequestId = useRef(crypto.randomUUID());
  const customerNameInputRef = useRef<HTMLInputElement>(null);

  const defaultResponsible = useMemo(
    () => responsibles.find((item) => item.tipo === "usuario") ?? responsibles[0],
    [responsibles],
  );
  useEffect(() => {
    if (open && !responsible && defaultResponsible) {
      setResponsible(`${defaultResponsible.tipo}:${defaultResponsible.id}`);
    }
  }, [defaultResponsible, open, responsible]);

  const addCustomer = async () => {
    if (!customerName.trim()) return;
    setCreatingCustomer(true);
    try {
      const created = await saveRentalCustomer(companyId, {
        personType: "pessoa_fisica",
        name: customerName.trim(),
      });
      await onCustomerCreated();
      // Usa o registro recém-criado diretamente, sem depender de ele já
      // estar na lista `customers` recarregada - evita um cliente
      // "sumido" no combobox caso a empresa tenha mais clientes do que o
      // topo carregado por padrão.
      setCustomer(created);
      setCustomerName("");
      toast.success("Cliente cadastrado no cadastro canônico.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao cadastrar cliente.");
    } finally {
      setCreatingCustomer(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const [responsibleType, responsibleId] = responsible.split(":");
    if (!customerId || !responsibleId || !withdrawalAt || !returnAt) {
      toast.error("Preencha cliente, período e responsável.");
      return;
    }
    if (new Date(returnAt) <= new Date(withdrawalAt)) {
      toast.error("A devolução deve ocorrer depois da retirada.");
      return;
    }
    setSubmitting(true);
    try {
      const rental = await createMaterialRental(companyId, {
        customerId,
        withdrawalAt,
        returnAt,
        responsibleType: responsibleType as "usuario" | "funcionario",
        responsibleId,
        notes,
        clientUuid: createRequestId.current,
      });
      toast.success(`${rental.numero} criada em rascunho.`);
      createRequestId.current = crypto.randomUUID();
      onOpenChange(false);
      await onCreated(rental.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar locação.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova locação</DialogTitle>
          <DialogDescription>Crie o cabeçalho comercial; os materiais serão adicionados no próximo passo.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label>Cliente</Label>
            <CustomerCombobox
              companyId={companyId}
              customers={customers}
              selected={customer}
              onSelect={setCustomer}
              onCreateNew={(typedText) => {
                setCustomerName(typedText);
                customerNameInputRef.current?.focus();
              }}
            />
            <div className="flex gap-2">
              <Input
                ref={customerNameInputRef}
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="Ou cadastre rapidamente um novo cliente"
              />
              <Button
                type="button"
                variant="outline"
                aria-label="Cadastrar cliente"
                onClick={addCustomer}
                disabled={creatingCustomer || !customerName.trim()}
              >
                {creatingCustomer ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Retirada prevista</Label><Input type="datetime-local" value={withdrawalAt} onChange={(event) => setWithdrawalAt(event.target.value)} /></div>
            <div className="space-y-2"><Label>Devolução prevista</Label><Input type="datetime-local" value={returnAt} onChange={(event) => setReturnAt(event.target.value)} /></div>
          </div>
          <div className="space-y-2">
            <Label>Responsável interno</Label>
            <Select value={responsible} onValueChange={setResponsible}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{responsibles.map((item) => <SelectItem key={`${item.tipo}:${item.id}`} value={`${item.tipo}:${item.id}`}>{item.nome} · {item.detalhe}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Observações</Label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Condições comerciais ou operacionais" /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button disabled={submitting} type="submit">{submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Criar e adicionar materiais</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
