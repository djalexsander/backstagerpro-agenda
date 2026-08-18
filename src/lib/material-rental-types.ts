export type RentalStatus =
  | "rascunho"
  | "reservada"
  | "pronta_retirada"
  | "em_andamento"
  | "parcialmente_devolvida"
  | "concluida"
  | "cancelada";

export type RentalBillingMode = "fixo" | "diaria" | "periodo" | "unidade";

export interface CustomerOption {
  id: string;
  tipo_pessoa: "pessoa_fisica" | "pessoa_juridica";
  nome: string;
  nome_fantasia: string | null;
  cpf_cnpj: string | null;
  email: string | null;
  telefone: string | null;
  observacoes: string | null;
  ativo: boolean;
}

export interface RentalMaterialOption {
  id: string;
  codigo_interno: string;
  identificador_unico: string;
  codigo_barras: string | null;
  nome: string;
  descricao: string | null;
  numero_serie: string | null;
  numero_patrimonio: string | null;
  tipo_controle: "individual" | "quantidade";
  unidade_medida: string;
  valor_locacao_padrao: number | null;
  foto_path: string | null;
  estoque_fisico: number;
  reservado: number;
  disponivel: number;
}

export interface RentalListItem {
  id: string;
  empresa_id: string;
  cliente_id: string;
  numero: string;
  status: RentalStatus;
  retirada_prevista_em: string;
  devolucao_prevista_em: string;
  responsavel_nome: string;
  valor_total: number;
  cliente_nome: string;
  cliente_nome_fantasia: string | null;
  quantidade_itens: number;
  quantidade_retirada: number;
  quantidade_devolvida: number;
  quantidade_com_cliente: number;
  atrasada: boolean;
}

export interface RentalItemView {
  id: string;
  material_id: string;
  quantidade_contratada: number;
  modalidade_cobranca: RentalBillingMode;
  unidades_cobranca: number;
  valor_unitario: number;
  desconto: number;
  subtotal: number;
  observacoes: string | null;
  quantidade_retirada: number;
  quantidade_devolvida: number;
  quantidade_com_cliente: number;
  quantidade_pendente_retirada: number;
  material: {
    id: string;
    nome: string;
    codigo_interno: string;
    tipo_controle: "individual" | "quantidade";
    unidade_medida: string;
    numero_serie: string | null;
    numero_patrimonio: string | null;
    codigo_barras: string | null;
    identificador_unico: string;
  };
}

export interface RentalCustodyView {
  id: string;
  referencia_id: string;
  material_id: string;
  status: "aberta" | "parcial" | "concluida" | "cancelada";
  quantidade_retirada: number;
  quantidade_devolvida: number;
  quantidade_baixada: number;
  quantidade_pendente: number;
  retirada_em: string;
  previsao_retorno: string | null;
}

export interface RentalHistoryEvent {
  id: string;
  tipo: string;
  descricao: string;
  dados: Record<string, unknown>;
  data_efetiva: string;
  executor_nome: string;
}

export interface RentalDetail extends RentalListItem {
  observacoes: string | null;
  valor_bruto: number;
  desconto: number;
  cliente: CustomerOption;
  evento: { id: string; name: string; date: string } | null;
  itens: RentalItemView[];
  custodias: RentalCustodyView[];
  historico: RentalHistoryEvent[];
}

export interface RentalFilters {
  search: string;
  status: RentalStatus | "todos";
  customerId: string;
  dateFrom: string;
  dateTo: string;
  overdueOnly: boolean;
  responsible: string;
}

export interface RentalIndicators {
  em_andamento: number;
  retiradas_hoje: number;
  devolucoes_hoje: number;
  atrasadas: number;
}

export interface CreateRentalInput {
  customerId: string;
  withdrawalAt: string;
  returnAt: string;
  responsibleType: "usuario" | "funcionario";
  responsibleId: string;
  eventId?: string;
  notes?: string;
  clientUuid: string;
}

export interface SaveRentalItemInput {
  rentalId: string;
  materialId: string;
  quantity: number;
  billingMode: RentalBillingMode;
  billingUnits: number;
  unitPrice: number;
  discount: number;
  notes?: string;
  itemId?: string;
  clientUuid: string;
}
