import { normalizeCustodyScan } from "./checkin-checkout-domain";
import { MATERIAL_QR_PREFIX } from "./material-identification";
import type { CustodyOperationView } from "./checkin-checkout-types";

export interface EventCustodyMaterialSummary {
  materialId: string;
  materialNome: string;
  materialCodigo: string;
  quantidadeRetirada: number;
  quantidadeDevolvida: number;
  quantidadePendente: number;
  /**
   * As custódias individuais (não canceladas) deste material que ainda têm
   * saldo pendente, mais antiga primeiro. Um material pode ter mais de uma
   * (retiradas separadas para o mesmo evento) - o check-in sempre opera em
   * UMA custódia por vez (registrar_checkin_material recebe um único
   * _custodia_id), então a ação "Fazer check-in" resolve para a mais antiga
   * pendente, mesmo critério de desempate que o modo 'misto' do Scanner
   * Remoto já usa para a custódia aberta mais antiga de um material.
   */
  custodiasAbertas: CustodyOperationView[];
}

export interface EventCustodySummary {
  totalRetirado: number;
  totalDevolvido: number;
  totalPendente: number;
  materiaisPendentes: EventCustodyMaterialSummary[];
  materiaisDevolvidos: EventCustodyMaterialSummary[];
}

/**
 * Agregação puramente client-side sobre as linhas de custódia já devolvidas
 * por listar_custodias_materiais (filtradas por referencia_tipo/referencia_id
 * no servidor) - não existe, nem deveria existir, uma RPC dedicada só para
 * esta soma, mesmo raciocínio de computeRentalOperationalQueue
 * (rental-operations-domain.ts) para a fila de locações.
 *
 * Agrupa por material_id, somando quantidade_retirada/devolvida/pendente de
 * cada custódia. Custódias 'cancelada' são ignoradas (o checkout foi
 * estornado, nunca chegou a ficar "pendente de retorno") - mesmo filtro que
 * material_rental_item_operational_totals já aplica no SQL para o
 * equivalente de locação.
 */
export function summarizeEventCustody(
  operations: CustodyOperationView[],
): EventCustodySummary {
  const byMaterial = new Map<string, EventCustodyMaterialSummary>();

  for (const operation of operations) {
    if (operation.status === "cancelada") continue;
    const existing = byMaterial.get(operation.material_id) ?? {
      materialId: operation.material_id,
      materialNome: operation.material_nome,
      materialCodigo: operation.material_codigo,
      quantidadeRetirada: 0,
      quantidadeDevolvida: 0,
      quantidadePendente: 0,
      custodiasAbertas: [],
    };
    existing.quantidadeRetirada += operation.quantidade_retirada;
    existing.quantidadeDevolvida += operation.quantidade_devolvida;
    existing.quantidadePendente += operation.quantidade_pendente;
    if (operation.quantidade_pendente > 0) {
      existing.custodiasAbertas.push(operation);
    }
    byMaterial.set(operation.material_id, existing);
  }

  const materiais = Array.from(byMaterial.values());
  for (const item of materiais) {
    item.custodiasAbertas.sort(
      (a, b) => new Date(a.retirada_em).getTime() - new Date(b.retirada_em).getTime(),
    );
  }

  return {
    totalRetirado: materiais.reduce((sum, item) => sum + item.quantidadeRetirada, 0),
    totalDevolvido: materiais.reduce((sum, item) => sum + item.quantidadeDevolvida, 0),
    totalPendente: materiais.reduce((sum, item) => sum + item.quantidadePendente, 0),
    materiaisPendentes: materiais.filter((item) => item.quantidadePendente > 0),
    materiaisDevolvidos: materiais.filter((item) => item.quantidadePendente === 0),
  };
}

/**
 * Resolve a leitura de um código (digitado ou lido por um leitor USB/QR que
 * emula teclado) para o material pendente correspondente daquele evento.
 *
 * QR (BACKSTAGE-PRO:MATERIAL:<uuid>): o uuid é sempre identificador_unico -
 * coluna própria e imutável, garantida por CHECK (materiais_qr_content_shape)
 * e pelo trigger prepare_material_write no banco - nunca materialId (esse é
 * materiais.id, a FK de material_custodias; um uuid independente e sem
 * relação com identificador_unico). listar_custodias_materiais não expõe
 * identificador_unico como campo próprio (só via o fallback
 * material_identificador, que pode conter patrimônio/série/código de barras
 * em vez dele), então quem chama precisa resolver identificador_unico à
 * parte (ex.: SELECT id, identificador_unico FROM materiais) e passar aqui
 * como identificadorUnicoPorMaterial (materialId -> identificador_unico).
 * Sem essa comparação dedicada, um QR real nunca bateria com
 * material_identificador quando o material também tiver patrimônio/série/
 * código de barras cadastrado (o COALESCE prioriza esses antes do uuid).
 *
 * Qualquer outra entrada (código interno, patrimônio, série, código de
 * barras): compara com material_codigo e material_identificador, mesmo
 * comportamento de sempre - nenhuma RPC nova, nenhum campo novo.
 */
export function findPendingMaterialByCode(
  materiaisPendentes: EventCustodyMaterialSummary[],
  code: string,
  identificadorUnicoPorMaterial?: ReadonlyMap<string, string>,
): EventCustodyMaterialSummary | undefined {
  const normalized = normalizeCustodyScan(code).toLocaleLowerCase("pt-BR");
  if (!normalized) return undefined;

  const prefix = MATERIAL_QR_PREFIX.toLocaleLowerCase("pt-BR");
  if (normalized.startsWith(prefix)) {
    const qrUuid = normalized.slice(prefix.length);
    return materiaisPendentes.find(
      (item) => identificadorUnicoPorMaterial?.get(item.materialId)?.toLocaleLowerCase("pt-BR") === qrUuid,
    );
  }

  return materiaisPendentes.find((item) => {
    const candidates = [
      item.materialCodigo,
      ...item.custodiasAbertas.map((custodia) => custodia.material_identificador),
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLocaleLowerCase("pt-BR"));
    return candidates.includes(normalized);
  });
}
