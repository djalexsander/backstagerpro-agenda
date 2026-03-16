import { payload } from "pix-payload";

interface PixParams {
  chave: string;
  nomeRecebedor: string;
  cidade: string;
  valor: number;
  descricao?: string;
}

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function generatePixPayload(params: PixParams): string {
  const { chave, nomeRecebedor, cidade, valor } = params;

  // Format phone keys: ensure +55 prefix
  let formattedKey = chave;
  const digits = chave.replace(/\D/g, "");
  if (/^\d{10,11}$/.test(digits)) {
    formattedKey = "+55" + digits;
  } else if (/^55\d{10,11}$/.test(digits)) {
    formattedKey = "+" + digits;
  }

  const pixPayload = payload({
    key: formattedKey,
    name: removeAccents(nomeRecebedor).substring(0, 25),
    city: removeAccents(cidade).substring(0, 15),
    amount: valor,
    transactionId: "***",
  });

  return pixPayload;
}
