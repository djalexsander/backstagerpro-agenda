import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface CompanyContextOption {
  id: string;
  nome_empresa: string;
  status: string | null;
}

export function CompanyContextSelector({
  companies,
  value,
  onValueChange,
  disabled = false,
}: {
  companies: CompanyContextOption[];
  value: string;
  onValueChange: (companyId: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Empresa</label>
      <Select
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder="Selecione uma empresa" />
        </SelectTrigger>
        <SelectContent>
          {companies.map((company) => (
            <SelectItem key={company.id} value={company.id}>
              {company.nome_empresa}
              {company.status === "inativo" ? " (inativa)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
