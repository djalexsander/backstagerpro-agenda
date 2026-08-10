export type FinancialLedgerStatus =
  | "pendente"
  | "parcial"
  | "recebido"
  | "cancelado"
  | "cancelado_pendente_regularizacao"
  | "estornado";

export type PaymentBillingMode = "avista" | "parcelado";

export type ReceiptKind = "recebimento" | "estorno";

export interface ReceivableEntry {
  id: string;
  empresa_id: string;
  origem_tipo: string;
  origem_id: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  cliente_nome_fantasia: string | null;
  tipo: "receita" | "despesa";
  descricao: string | null;
  forma_cobranca: PaymentBillingMode;
  valor_original: number;
  valor_recebido: number;
  valor_estornado: number;
  status: FinancialLedgerStatus;
  vencimento: string | null;
  forma_pagamento: string | null;
  observacoes: string | null;
  vencido: boolean;
  requer_revisao_vencimento: boolean;
  created_at: string;
}

export interface ClientReceivableSummary {
  cliente_id: string;
  cliente_nome: string;
  cliente_nome_fantasia: string | null;
  quantidade_titulos: number;
  total_devido: number;
  total_vencido: number;
  total_pendente_regularizacao: number;
  proximo_vencimento: string | null;
}

export interface RentalReceipt {
  id: string;
  lancamento_id: string;
  parcela_id: string | null;
  tipo: ReceiptKind;
  recebimento_estornado_id: string | null;
  valor: number;
  forma_pagamento: string | null;
  data_recebimento: string;
  observacao: string | null;
}

export interface RentalInstallment {
  id: string;
  lancamento_id: string;
  numero: number;
  valor: number;
  valor_recebido: number;
  valor_estornado: number;
  vencimento: string;
  status: FinancialLedgerStatus;
  recebimentos: RentalReceipt[];
}

export interface RentalFinancialSummary {
  id: string;
  origem_tipo: string;
  origem_id: string;
  cliente_id: string | null;
  forma_cobranca: PaymentBillingMode;
  valor_original: number;
  valor_recebido: number;
  valor_estornado: number;
  status: FinancialLedgerStatus;
  vencimento: string | null;
  forma_pagamento: string | null;
  requer_revisao_vencimento: boolean;
  recebimentos: RentalReceipt[];
  parcelas: RentalInstallment[];
}

export interface InstallmentInput {
  numero: number;
  valor: number;
  vencimento: string;
}

export type PaymentCondition =
  | { formaCobranca: "avista"; vencimento: string }
  | { formaCobranca: "parcelado"; parcelas: InstallmentInput[] };

export interface RentalsFinancialSummary {
  valorContratado: number;
  valorRecebido: number;
  valorAReceber: number;
  valorVencido: number;
  valorPendenteRegularizacao: number;
}

// Manutenção has no client/billing - the entry is already-settled internal
// cost (labor + parts + other), so it carries none of the receivable-only
// fields (vencido, forma_cobranca, cliente...) that ReceivableEntry has.
export interface MaintenanceExpenseEntry {
  id: string;
  empresa_id: string;
  origem_id: string;
  ordem_numero: string;
  material_id: string;
  material_nome: string;
  material_codigo: string;
  descricao: string | null;
  valor_original: number;
  status: FinancialLedgerStatus;
  concluida_em: string;
}

export interface MaintenanceExpensesSummary {
  valorTotal: number;
  quantidadeOrdens: number;
}
