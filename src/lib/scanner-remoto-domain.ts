import type { CustodyBalanceOption } from "./checkin-checkout-types";
import type { ScannerRemotoTipoOperacao } from "./scanner-remoto-types";

/**
 * Mesma decisão checkout-vs-checkin que registrar_leitura_scanner_remoto já
 * aplica no servidor para sessões 'misto' (20260818170000_scanner_remoto_
 * realtime.sql): checkout só quando o material não tem nenhuma custódia
 * aberta; sessões 'checkout'/'checkin' puras não dependem disso, o tipo já
 * está fixado na sessão. Usada só para decidir qual modal de confirmação
 * mostrar no cliente antes de registrar - o servidor continua sendo a
 * autoridade; se o estado mudar entre a identificação e a confirmação (outra
 * leitura fechou a custódia nesse meio-tempo), o RPC resolve pelo estado
 * real no momento do registro, não pelo que este cliente adivinhou aqui.
 */
export function detectScannerRemotoOperation(
  tipoOperacao: ScannerRemotoTipoOperacao,
  hasOpenCustody: boolean,
): "checkout" | "checkin" {
  if (tipoOperacao === "checkout") return "checkout";
  if (tipoOperacao === "checkin") return "checkin";
  return hasOpenCustody ? "checkin" : "checkout";
}

/**
 * Quantidade máxima para um check-out por Scanner Remoto: o saldo do
 * material na localização de origem fixada na sessão - mesma regra que
 * apply_stock_movement já valida no servidor ("Saldo insuficiente na
 * localização de origem"), só antecipada aqui para o modal de confirmação.
 */
export function maxScannerRemotoCheckoutQuantity(
  saldos: CustodyBalanceOption[],
  originLocationId: string | null,
): number {
  return saldos.find((saldo) => saldo.localizacao_id === originLocationId)?.quantidade ?? 0;
}
