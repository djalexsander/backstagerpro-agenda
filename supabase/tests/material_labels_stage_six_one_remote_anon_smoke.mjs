import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Supabase public environment is unavailable.");

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const fakeCompany = "00000000-0000-4000-8000-000000000061";
const fakeRequest = "00000000-0000-4000-8000-000000000062";

const tableRead = await client.from("etiqueta_solicitacoes").select("id").limit(1);
if (!tableRead.error) throw new Error("anon unexpectedly read immutable batch history");

const publicWrite = await client.rpc("registrar_solicitacao_impressao_lote_etiquetas", {
  _modelo_id: fakeRequest,
  _itens: [{ material_id: fakeRequest, quantidade: 1 }],
  _client_uuid: fakeRequest,
  _empresa_id: fakeCompany,
});
if (!publicWrite.error) throw new Error("anon unexpectedly executed the authenticated batch RPC");

const helperCall = await client.rpc("assert_material_label_batch_completeness", {
  _company_id: fakeCompany,
  _request_id: fakeRequest,
});
if (!helperCall.error) throw new Error("anon unexpectedly executed an internal helper");

console.log(JSON.stringify({
  anon_table_read: "blocked",
  anon_batch_rpc: "blocked",
  anon_internal_helper: "blocked",
}));
