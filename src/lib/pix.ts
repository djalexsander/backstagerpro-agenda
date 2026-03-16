// PIX Payload Generator (BR Code / EMV standard)

function padTLV(id: string, value: string): string {
  const len = value.length.toString().padStart(2, "0");
  return `${id}${len}${value}`;
}

function computeCRC16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

interface PixParams {
  chave: string;
  nomeRecebedor: string;
  cidade: string;
  valor: number;
  descricao?: string;
}

export function generatePixPayload(params: PixParams): string {
  const { chave, nomeRecebedor, cidade, valor, descricao } = params;

  // Merchant Account Info (ID 26)
  const gui = padTLV("00", "br.gov.bcb.pix");
  const key = padTLV("01", chave);
  const desc = descricao ? padTLV("02", descricao.substring(0, 25)) : "";
  const merchantAccountInfo = padTLV("26", gui + key + desc);

  let payload = "";
  payload += padTLV("00", "01"); // Payload Format Indicator
  payload += merchantAccountInfo;
  payload += padTLV("52", "0000"); // Merchant Category Code
  payload += padTLV("53", "986"); // Transaction Currency (BRL)
  payload += padTLV("54", valor.toFixed(2)); // Transaction Amount
  payload += padTLV("58", "BR"); // Country Code
  payload += padTLV("59", nomeRecebedor.substring(0, 25)); // Merchant Name
  payload += padTLV("60", cidade.substring(0, 15)); // Merchant City
  payload += padTLV("62", padTLV("05", "***")); // Additional Data Field

  // CRC placeholder
  payload += "6304";
  const crc = computeCRC16(payload);
  payload += crc;

  return payload;
}
