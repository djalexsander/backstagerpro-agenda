import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2";
import { authorizeInternalRequest } from "../_shared/internal-request.ts";

const responseHeaders = { "Content-Type": "application/json" };

type SupabaseAdmin = ReturnType<typeof createClient>;
type ScanResult = { empresa: string; dias: number; tipo: string };

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

async function fetchClienteNames(
  supabase: SupabaseAdmin,
  clienteIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [...new Set(clienteIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("clientes").select("id, nome").in("id", ids);
  if (error) {
    console.error("Error fetching cliente names:", error);
    return new Map();
  }
  return new Map((data ?? []).map((c: { id: string; nome: string }) => [c.id, c.nome]));
}

// Push item 5 ("devolucao/check-in pendente"): aviso ANTES do prazo vencer -
// locacoes com devolucao prevista nas proximas 24h. Distinto do item 7
// (locacao_atrasada, abaixo), que so dispara depois que o prazo ja passou -
// as duas janelas nunca se sobrepoem (uma e now()..+24h, a outra e <now()).
async function checkPendingRentalReturns(
  supabase: SupabaseAdmin,
  today: string,
  results: ScanResult[],
): Promise<void> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const { data: rentals, error } = await supabase
    .from("material_locacoes")
    .select("id, empresa_id, numero, cliente_id, devolucao_prevista_em")
    .in("status", ["em_andamento", "parcialmente_devolvida"])
    .gte("devolucao_prevista_em", now.toISOString())
    .lte("devolucao_prevista_em", windowEnd.toISOString());
  if (error) {
    console.error("Error checking pending rental returns:", error);
    return;
  }
  if (!rentals?.length) return;

  const clientes = await fetchClienteNames(supabase, rentals.map((r: any) => r.cliente_id));
  for (const rental of rentals as any[]) {
    const { error: rpcError } = await supabase.rpc("criar_notificacao", {
      _empresa_id: rental.empresa_id,
      _categoria: "operacional",
      _tipo: "locacao_devolucao_pendente",
      _titulo: "Devolução prevista para hoje",
      _mensagem: `${rental.numero} · Cliente ${clientes.get(rental.cliente_id) ?? "—"}`,
      _feature_key: "locacao_materiais",
      _referencia_tipo: "locacao",
      _referencia_id: rental.id,
      _rota: `/locacoes?locacao=${rental.id}`,
      _dedupe_key: `locacao_pendente:${rental.id}:${today}`,
    });
    if (rpcError) console.error(`Error notifying pending return ${rental.id}:`, rpcError);
    else results.push({ empresa: rental.empresa_id, dias: 0, tipo: "locacao_devolucao_pendente" });
  }
}

// Push item 7 ("locacao atrasada"): devolucao prevista ja passou.
async function checkOverdueRentals(
  supabase: SupabaseAdmin,
  today: string,
  results: ScanResult[],
): Promise<void> {
  const now = new Date();
  const { data: rentals, error } = await supabase
    .from("material_locacoes")
    .select("id, empresa_id, numero, cliente_id, devolucao_prevista_em")
    .in("status", ["em_andamento", "parcialmente_devolvida"])
    .lt("devolucao_prevista_em", now.toISOString());
  if (error) {
    console.error("Error checking overdue rentals:", error);
    return;
  }
  if (!rentals?.length) return;

  const clientes = await fetchClienteNames(supabase, rentals.map((r: any) => r.cliente_id));
  for (const rental of rentals as any[]) {
    const dias = Math.max(
      1,
      Math.ceil((now.getTime() - new Date(rental.devolucao_prevista_em).getTime()) / 86400000),
    );
    const { error: rpcError } = await supabase.rpc("criar_notificacao", {
      _empresa_id: rental.empresa_id,
      _categoria: "operacional",
      _tipo: "locacao_atrasada",
      _titulo: "Locação atrasada",
      _mensagem: `${rental.numero} · Cliente ${clientes.get(rental.cliente_id) ?? "—"} · atrasada há ${dias} dia(s)`,
      _feature_key: "locacao_materiais",
      _referencia_tipo: "locacao",
      _referencia_id: rental.id,
      _rota: `/locacoes?locacao=${rental.id}`,
      _dedupe_key: `locacao_atrasada:${rental.id}:${today}`,
    });
    if (rpcError) console.error(`Error notifying overdue rental ${rental.id}:`, rpcError);
    else results.push({ empresa: rental.empresa_id, dias, tipo: "locacao_atrasada" });
  }
}

// Push item 8 ("material nao devolvido"): mesma ideia do item 7, mas para
// custodia SEM locacao vinculada (checkin/checkout puro) - custodias com
// referencia_tipo='locacao_item' ja sao cobertas pelo item 7 via a propria
// locacao, entao ficariam duplicadas aqui se nao fossem excluidas. O filtro
// usa .or(is.null / neq) em vez de so .neq porque referencia_tipo NULL
// (custodia solta, o caso mais comum) faz `<> 'locacao_item'` avaliar para
// NULL em SQL - um .neq sozinho excluiria essas linhas por engano.
async function checkOverdueCustody(
  supabase: SupabaseAdmin,
  today: string,
  results: ScanResult[],
): Promise<void> {
  const now = new Date();
  const { data: custodias, error } = await supabase
    .from("material_custodias")
    .select("id, empresa_id, material_id, responsavel_nome, previsao_retorno")
    .in("status", ["aberta", "parcial"])
    .not("previsao_retorno", "is", null)
    .lt("previsao_retorno", now.toISOString())
    .or("referencia_tipo.is.null,referencia_tipo.neq.locacao_item");
  if (error) {
    console.error("Error checking overdue custody:", error);
    return;
  }
  if (!custodias?.length) return;

  const materialIds = [...new Set((custodias as any[]).map((c) => c.material_id))];
  const { data: materiais, error: materiaisError } = await supabase
    .from("materiais")
    .select("id, nome")
    .in("id", materialIds);
  if (materiaisError) console.error("Error fetching material names:", materiaisError);
  const materiaisMap = new Map((materiais ?? []).map((m: any) => [m.id, m.nome]));

  for (const custodia of custodias as any[]) {
    const dias = Math.max(
      1,
      Math.ceil((now.getTime() - new Date(custodia.previsao_retorno).getTime()) / 86400000),
    );
    const { error: rpcError } = await supabase.rpc("criar_notificacao", {
      _empresa_id: custodia.empresa_id,
      _categoria: "operacional",
      _tipo: "material_nao_devolvido",
      _titulo: "Material não devolvido",
      _mensagem: `${materiaisMap.get(custodia.material_id) ?? "Material"} · ${custodia.responsavel_nome} · atrasado há ${dias} dia(s)`,
      _feature_key: "checkin_checkout",
      _referencia_tipo: "custodia",
      _referencia_id: custodia.id,
      _rota: "/checkin-checkout",
      _dedupe_key: `custodia_atrasada:${custodia.id}:${today}`,
    });
    if (rpcError) console.error(`Error notifying overdue custody ${custodia.id}:`, rpcError);
    else results.push({ empresa: custodia.empresa_id, dias, tipo: "material_nao_devolvido" });
  }
}

// Push item 12 ("recebivel vencido/inadimplente"): financeiro_lancamentos
// avista e financeiro_parcelas sao dois lugares distintos onde um vencimento
// mora (ver 20260806090000) - ambos sao varridos.
async function checkOverdueReceivables(
  supabase: SupabaseAdmin,
  today: string,
  results: ScanResult[],
): Promise<void> {
  const { data: avista, error: avistaError } = await supabase
    .from("financeiro_lancamentos")
    .select("id, empresa_id, cliente_id, valor_original, valor_recebido, vencimento")
    .eq("forma_cobranca", "avista")
    .in("status", ["pendente", "parcial"])
    .not("vencimento", "is", null)
    .lt("vencimento", today);
  if (avistaError) console.error("Error checking overdue lancamentos:", avistaError);

  const { data: parcelas, error: parcelasError } = await supabase
    .from("financeiro_parcelas")
    .select("id, empresa_id, lancamento_id, valor, valor_recebido, vencimento")
    .in("status", ["pendente", "parcial"])
    .lt("vencimento", today);
  if (parcelasError) console.error("Error checking overdue parcelas:", parcelasError);

  const parcelaLancamentoIds = [...new Set((parcelas ?? []).map((p: any) => p.lancamento_id))];
  const { data: lancamentosForParcelas } = parcelaLancamentoIds.length
    ? await supabase.from("financeiro_lancamentos").select("id, cliente_id").in("id", parcelaLancamentoIds)
    : { data: [] as { id: string; cliente_id: string | null }[] };
  const lancamentoClienteMap = new Map(
    (lancamentosForParcelas ?? []).map((l: any) => [l.id, l.cliente_id]),
  );

  const clienteIds = [
    ...(avista ?? []).map((l: any) => l.cliente_id),
    ...[...lancamentoClienteMap.values()],
  ];
  const clientes = await fetchClienteNames(supabase, clienteIds);
  const now = Date.now();

  for (const lancamento of (avista ?? []) as any[]) {
    const pendente = Number(lancamento.valor_original) - Number(lancamento.valor_recebido);
    const dias = Math.max(1, Math.ceil((now - new Date(lancamento.vencimento).getTime()) / 86400000));
    const { error: rpcError } = await supabase.rpc("criar_notificacao", {
      _empresa_id: lancamento.empresa_id,
      _categoria: "financeiro",
      _tipo: "recebivel_vencido",
      _titulo: "Recebível vencido",
      _mensagem: `Cliente ${clientes.get(lancamento.cliente_id) ?? "—"} · R$ ${pendente.toFixed(2)} · vencido há ${dias} dia(s)`,
      _referencia_tipo: "financeiro_lancamento",
      _referencia_id: lancamento.id,
      _rota: "/financeiro",
      _dedupe_key: `recebivel_vencido:lancamento:${lancamento.id}:${today}`,
    });
    if (rpcError) console.error(`Error notifying overdue lancamento ${lancamento.id}:`, rpcError);
    else results.push({ empresa: lancamento.empresa_id, dias, tipo: "recebivel_vencido" });
  }

  for (const parcela of (parcelas ?? []) as any[]) {
    const pendente = Number(parcela.valor) - Number(parcela.valor_recebido);
    const dias = Math.max(1, Math.ceil((now - new Date(parcela.vencimento).getTime()) / 86400000));
    const clienteId = lancamentoClienteMap.get(parcela.lancamento_id);
    const { error: rpcError } = await supabase.rpc("criar_notificacao", {
      _empresa_id: parcela.empresa_id,
      _categoria: "financeiro",
      _tipo: "recebivel_vencido",
      _titulo: "Recebível vencido",
      _mensagem: `Cliente ${clientes.get(clienteId ?? "") ?? "—"} · R$ ${pendente.toFixed(2)} · vencido há ${dias} dia(s)`,
      _referencia_tipo: "financeiro_parcela",
      _referencia_id: parcela.id,
      _rota: "/financeiro",
      _dedupe_key: `recebivel_vencido:parcela:${parcela.id}:${today}`,
    });
    if (rpcError) console.error(`Error notifying overdue parcela ${parcela.id}:`, rpcError);
    else results.push({ empresa: parcela.empresa_id, dias, tipo: "recebivel_vencido" });
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authorization = authorizeInternalRequest(
    Deno.env.get("CHECK_VENCIMENTOS_SECRET"),
    req.headers.get("x-internal-secret"),
  );
  if (authorization === "misconfigured") {
    console.error(
      "CHECK_VENCIMENTOS_SECRET is missing or shorter than 32 characters",
    );
    return jsonResponse({ error: "Scheduled task unavailable" }, 503);
  }
  if (authorization === "unauthorized") {
    console.error("Unauthorized check-vencimentos invocation rejected");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      console.error("Supabase service configuration is missing");
      return jsonResponse({ error: "Scheduled task unavailable" }, 503);
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    const today = now.toISOString().split("T")[0];

    // Fetch companies with vencimento in the next 7 days (not blocked, not vitalicio)
    const { data: empresas, error: empError } = await supabase
      .from("empresas")
      .select("id, nome_empresa, email, vencimento, plano, plano_id, plano_bloqueado, status_pagamento")
      .eq("plano_bloqueado", false)
      .not("vencimento", "is", null);

    if (empError) {
      console.error("Error fetching empresas:", empError);
      return jsonResponse({ error: "Unable to check company expirations" }, 500);
    }

    // Also check plans to exclude vitalicio
    const { data: planos } = await supabase
      .from("planos")
      .select("id, periodicidade");

    const vitalicioIds = new Set(
      (planos || [])
        .filter((plan) => plan.periodicidade === "vitalicio")
        .map((plan) => plan.id)
    );

    const results: ScanResult[] = [];

    for (const empresa of empresas || []) {
      // Skip vitalicio plans
      if (empresa.plano_id && vitalicioIds.has(empresa.plano_id)) continue;
      // Skip already paid
      if (empresa.status_pagamento === "pago") continue;

      const vencimento = new Date(empresa.vencimento);
      const diffMs = vencimento.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      // Notify at 7, 5, 3, 1, 0 days before, and when overdue
      if (diffDays > 7) continue;

      let tipo = "";
      let mensagemMaster = "";
      let mensagemEmpresa = "";

      if (diffDays < 0) {
        tipo = "vencimento_expirado";
        mensagemMaster = `⚠️ Empresa "${empresa.nome_empresa}" está com o plano VENCIDO há ${Math.abs(diffDays)} dia(s).`;
        mensagemEmpresa = `Seu plano está vencido há ${Math.abs(diffDays)} dia(s). Regularize para evitar o bloqueio.`;
      } else if (diffDays === 0) {
        tipo = "vencimento_hoje";
        mensagemMaster = `🔔 Empresa "${empresa.nome_empresa}" vence HOJE.`;
        mensagemEmpresa = `Seu plano vence HOJE! Realize o pagamento para evitar bloqueio.`;
      } else {
        tipo = "vencimento_proximo";
        mensagemMaster = `📅 Empresa "${empresa.nome_empresa}" vence em ${diffDays} dia(s).`;
        mensagemEmpresa = `Seu plano vence em ${diffDays} dia(s). Realize o pagamento para manter o acesso.`;
      }

      // Check if we already notified today for this company
      const notifKey = `venc-${empresa.id}-${today}`;
      const { data: existing } = await supabase
        .from("notificacoes_master")
        .select("id")
        .eq("empresa_id", empresa.id)
        .eq("tipo", tipo)
        .gte("created_at", `${today}T00:00:00`)
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`Already notified ${empresa.nome_empresa} today for ${tipo}`);
        continue;
      }

      // Create master notification
      const { error: notifError } = await supabase
        .from("notificacoes_master")
        .insert({
          empresa_id: empresa.id,
          tipo,
          mensagem: mensagemMaster,
          dados: {
            dias_restantes: diffDays,
            vencimento: empresa.vencimento,
            plano: empresa.plano,
            email_empresa: empresa.email,
          },
        });

      if (notifError) {
        console.error(`Error creating notification for ${empresa.nome_empresa}:`, notifError);
      } else {
        results.push({
          empresa: empresa.nome_empresa,
          dias: diffDays,
          tipo,
        });
        console.log(`Notification created for ${empresa.nome_empresa} - ${tipo} (${diffDays} days)`);
      }
    }

    // Also check trial expiration for companies WITHOUT a plan
    const { data: trialEmpresas } = await supabase
      .from("empresas")
      .select("id, nome_empresa, email, trial_expires_at, plano_id, plano_bloqueado")
      .eq("plano_bloqueado", false)
      .is("plano_id", null)
      .not("trial_expires_at", "is", null);

    for (const empresa of trialEmpresas || []) {
      const trialEnd = new Date(empresa.trial_expires_at);
      const diffMs = trialEnd.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays > 5) continue;

      // When trial has expired, deactivate trial-granted modules
      if (diffDays < 0) {
        const { error: deactError } = await supabase.rpc("deactivate_trial_modules", {
          _empresa_id: empresa.id,
        });
        if (deactError) {
          console.error(`Error deactivating trial modules for ${empresa.nome_empresa}:`, deactError);
        } else {
          console.log(`Trial modules deactivated for ${empresa.nome_empresa}`);
        }
      }

      const tipo = diffDays < 0 ? "trial_expirado" : "trial_expirando";
      const mensagem = diffDays < 0
        ? `⚠️ Trial da empresa "${empresa.nome_empresa}" expirou há ${Math.abs(diffDays)} dia(s).`
        : `📅 Trial da empresa "${empresa.nome_empresa}" expira em ${diffDays} dia(s).`;

      const { data: existing } = await supabase
        .from("notificacoes_master")
        .select("id")
        .eq("empresa_id", empresa.id)
        .eq("tipo", tipo)
        .gte("created_at", `${today}T00:00:00`)
        .limit(1);

      if (existing && existing.length > 0) continue;

      await supabase.from("notificacoes_master").insert({
        empresa_id: empresa.id,
        tipo,
        mensagem,
        dados: {
          dias_restantes: diffDays,
          trial_expires_at: empresa.trial_expires_at,
          email_empresa: empresa.email,
        },
      });

      results.push({ empresa: empresa.nome_empresa, dias: diffDays, tipo });
    }

    // Push Notifications Fase 1, itens 5/7/8/12: alertas baseados em tempo
    // (nada "acontece" no banco no instante do vencimento, entao nao ha
    // gatilho possivel - so varredura). Cada funcao chama criar_notificacao
    // diretamente, que ja faz o dedupe (empresa_id+dedupe_key) e o fan-out
    // por papel/permissao - nao duplica a logica de "ja notifiquei hoje" que
    // o bloco de vencimento de plano acima faz manualmente.
    await checkPendingRentalReturns(supabase, today, results);
    await checkOverdueRentals(supabase, today, results);
    await checkOverdueCustody(supabase, today, results);
    await checkOverdueReceivables(supabase, today, results);

    console.log(`Check completed. ${results.length} notifications created.`);

    return jsonResponse({
      success: true,
      notificacoes_criadas: results.length,
      detalhes: results,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
