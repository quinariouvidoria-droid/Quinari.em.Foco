// api/coletar.js — Quinari em Foco v8 FINAL
// Despesas: chave correta é 'conta' (42 únicos), não 'cod_conta' (1 único)
// IBGE: 1200450

const IBGE         = '1200450';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TRANSP_KEY   = process.env.TRANSPARENCIA_API_KEY;

const hSupa = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`
};

async function deletarAno(tabela, ano) {
  await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?ano=eq.${ano}`, { method: 'DELETE', headers: hSupa });
}

async function inserir(tabela, registros) {
  if (!registros || registros.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < registros.length; i += 100) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}`, {
      method: 'POST',
      headers: { ...hSupa, 'Prefer': 'return=minimal' },
      body: JSON.stringify(registros.slice(i, i + 100))
    });
    if (!res.ok) throw new Error(`Supabase(${tabela}) ${res.status}: ${(await res.text()).substring(0, 200)}`);
    total += Math.min(100, registros.length - i);
  }
  return total;
}

async function log(fonte, status, total, erro = null) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/log_coleta`, {
      method: 'POST',
      headers: { ...hSupa, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ fonte, status, total_registros: total, erro, executado_em: new Date().toISOString() })
    });
  } catch(e) {}
}

async function buscarRREO(ano, numeroAnexo) {
  const anexoStr = String(numeroAnexo).padStart(2, '0');
  for (let bim = 6; bim >= 1; bim--) {
    try {
      const url = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?an_exercicio=${ano}&nr_periodo=${bim}&co_tipo_demonstrativo=RREO&no_anexo=RREO-Anexo%20${anexoStr}&id_ente=${IBGE}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const json = await res.json();
      if ((json.items || []).length > 0) return { itens: json.items, bimestre: bim };
    } catch(e) {}
  }
  return { itens: [], bimestre: 0 };
}

// ─── 1. SICONFI ───────────────────────────────────────────────────────────────
async function coletarSiconfi(ano) {
  const result = { receitas: 0, despesas: 0, indicadores: 0, detalhes: [] };

  // ── Receitas (Anexo 01) ───────────────────────────────────────────────────
  // Estrutura: cod_conta tem valores únicos por categoria → agrupa por cod_conta
  const { itens: itensR, bimestre: bimR } = await buscarRREO(ano, 1);
  result.detalhes.push(`Anexo01: ${itensR.length} itens bim${bimR}`);

  if (itensR.length > 0) {
    const mapa = {};
    for (const item of itensR) {
      const chave = (item.cod_conta || item.conta || '').substring(0, 100);
      if (!chave) continue;
      if (!mapa[chave]) mapa[chave] = {
        ano: parseInt(ano),
        fonte: (item.conta || 'N/I').substring(0, 200),
        categoria: chave,
        orcado: 0, arrecadado: 0,
        atualizado_em: new Date().toISOString()
      };
      const col = (item.coluna || '').toUpperCase();
      const val = parseFloat(item.valor) || 0;
      if (col.includes('INICIAL'))                                  mapa[chave].orcado     = val;
      if (col.includes('ATUALIZADA') && mapa[chave].orcado === 0)  mapa[chave].orcado     = val;
      if (col.includes('REALIZADO') || col.includes('ARRECADADO')) mapa[chave].arrecadado = val;
    }
    const registros = Object.values(mapa).filter(r => r.orcado > 0 || r.arrecadado > 0);
    result.detalhes.push(`Receitas após agrupamento: ${registros.length}`);
    if (registros.length > 0) {
      await deletarAno('receitas', ano);
      result.receitas = await inserir('receitas', registros);
      await log(`Siconfi/Receitas bim${bimR}`, 'ok', result.receitas);
    }
  }

  // ── Despesas (Anexo 02) — CORRIGIDO ──────────────────────────────────────
  // DIAGNÓSTICO REVELOU:
  //   cod_conta → 1 valor único ("RREO2TotalDespesas") — NÃO USAR
  //   conta     → 42 valores únicos (funções: Saúde, Educação, etc.) ✅ USAR
  //   coluna    → 11 valores (Dotação Inicial, Empenhado, Liquidado...) ✅ USAR
  // Chave correta: campo 'conta' (identifica a função de despesa)
  const { itens: itensD, bimestre: bimD } = await buscarRREO(ano, 2);
  result.detalhes.push(`Anexo02: ${itensD.length} itens bim${bimD}`);

  if (itensD.length > 0) {
    // Agrupa por 'conta' (ex: "Saúde", "Educação", "Administração Geral"...)
    const mapa = {};
    for (const item of itensD) {
      const chave = (item.conta || 'N/I').trim().substring(0, 200);
      if (!mapa[chave]) mapa[chave] = {
        ano: parseInt(ano),
        funcao: chave,
        categoria: chave, // sem cod_conta útil — usa conta como categoria também
        dotacao_inicial: 0, dotacao_atualizada: 0,
        empenhado: 0, liquidado: 0, pago: 0,
        atualizado_em: new Date().toISOString()
      };
      const col = (item.coluna || '').toUpperCase();
      const val = parseFloat(item.valor) || 0;
      // Colunas confirmadas pelo diagnóstico:
      // "DOTAÇÃO INICIAL", "DOTAÇÃO ATUALIZADA (a)", "DESPESAS EMPENHADAS NO BIMESTRE",
      // "DESPESAS EMPENHADAS ATÉ O BIMESTRE (b)", "DESPESAS LIQUIDADAS NO BIMESTRE",
      // "DESPESAS LIQUIDADAS ATÉ O BIMESTRE (d)", "SALDO (c = a-b)", "SALDO (e = a-d)",
      // "% (b/total b)", "% (d/total d)", "INSCRITAS EM RESTOS A PAGAR NÃO PROCESSADOS (f)"
      if (col.includes('DOTAÇÃO INICIAL') || col === 'DOTAÇÃO INICIAL')             mapa[chave].dotacao_inicial    = val;
      if (col.includes('ATUALIZADA'))                                                mapa[chave].dotacao_atualizada = val;
      if (col.includes('EMPENHADAS ATÉ') || col.includes('EMPENHADAS ATE'))         mapa[chave].empenhado          = val;
      if (col.includes('LIQUIDADAS ATÉ') || col.includes('LIQUIDADAS ATE'))         mapa[chave].liquidado          = val;
      if (col.includes('INSCRITAS EM RESTOS') || col.includes('PROCESSADOS'))       mapa[chave].pago               = val;
    }

    const despesas = Object.values(mapa).filter(r => r.dotacao_inicial > 0 || r.empenhado > 0);
    result.detalhes.push(`Despesas após agrupamento: ${despesas.length}`);

    if (despesas.length > 0) {
      await deletarAno('despesas', ano);
      result.despesas = await inserir('despesas', despesas);
      await log(`Siconfi/Despesas bim${bimD}`, 'ok', result.despesas);
    }
  }

  // ── Indicadores LRF (RGF Anexo 01) ───────────────────────────────────────
  for (let quad = 3; quad >= 1; quad--) {
    try {
      const url = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rgf?an_exercicio=${ano}&nr_periodo=${quad}&co_tipo_demonstrativo=RGF&no_anexo=RGF-Anexo%2001&id_ente=${IBGE}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const json = await res.json();
      const itens = json.items || [];
      result.detalhes.push(`RGF quad${quad}: ${itens.length} itens`);
      if (itens.length === 0) continue;

      const mapa = {};
      for (const item of itens) {
        // RGF Anexo 01: cod_conta pode ter valores únicos (diferente do Anexo 02)
        const chave = (item.cod_conta || item.conta || '').substring(0, 100);
        if (!chave) continue;
        if (!mapa[chave]) mapa[chave] = {
          ano: parseInt(ano),
          nome: (item.conta || 'Indicador').substring(0, 200),
          valor: 0, limite: null, percentual_limite: null,
          atualizado_em: new Date().toISOString()
        };
        const col = (item.coluna || item.rotulo || '').toUpperCase();
        const val = parseFloat(item.valor) || 0;
        if (col.includes('DESPESA') || col.includes('TOTAL') || col.includes('VALOR')) mapa[chave].valor  = val;
        if (col.includes('LIMITE'))                                                     mapa[chave].limite = val;
      }
      const indicadores = Object.values(mapa)
        .filter(r => r.valor > 0)
        .map(r => ({ ...r, percentual_limite: r.limite > 0 ? +((r.valor / r.limite) * 100).toFixed(2) : null }));

      if (indicadores.length > 0) {
        await deletarAno('indicadores', ano);
        result.indicadores = await inserir('indicadores', indicadores);
        await log(`Siconfi/RGF quad${quad}`, 'ok', result.indicadores);
        break;
      }
    } catch(e) { result.detalhes.push(`RGF quad${quad} erro: ${e.message}`); }
  }

  return result;
}

// ─── 2. Portal da Transparência ───────────────────────────────────────────────
async function coletarTransparencia(ano) {
  const result = { licitacoes: 0, fornecedores: 0, detalhes: [] };
  const hdrs = { 'chave-api-dados': TRANSP_KEY, 'Accept': 'application/json' };

  const tentativas = [
    { url: `https://api.portaldatransparencia.gov.br/api-de-dados/transferencias-voluntarias?municipio=${IBGE}&ano=${ano}&pagina=1`, tipo: 'transferencias-voluntarias' },
    { url: `https://api.portaldatransparencia.gov.br/api-de-dados/licitacoes?codigoIbge=${IBGE}&dataInicial=01/01/${ano}&dataFinal=31/12/${ano}&pagina=1`, tipo: 'licitacoes' },
    { url: `https://api.portaldatransparencia.gov.br/api-de-dados/contratos?codigoIbge=${IBGE}&dataInicial=01/01/${ano}&dataFinal=31/12/${ano}&pagina=1`, tipo: 'contratos' },
  ];

  for (const { url, tipo } of tentativas) {
    try {
      const res = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(10000) });
      result.detalhes.push(`${tipo}: HTTP ${res.status}`);
      if (!res.ok) continue;
      const dados = await res.json();
      if (!Array.isArray(dados) || dados.length === 0) { result.detalhes.push(`${tipo}: sem dados`); continue; }
      result.detalhes.push(`${tipo}: ${dados.length} registros ✅`);

      if (tipo === 'transferencias-voluntarias' || tipo === 'licitacoes') {
        const lics = dados.map(d => ({
          ano: parseInt(ano),
          numero: String(d.numero || d.nrConvenio || d.id || 'S/N').substring(0, 50),
          modalidade: tipo === 'transferencias-voluntarias' ? 'Transferência Voluntária' : String(d.modalidade?.descricao || 'N/I').substring(0, 100),
          objeto: String(d.objeto || d.dsObjeto || d.acao?.descricao || 'N/I').substring(0, 500),
          valor_estimado: parseFloat(d.valorConvenio || d.vlConvenio || d.valorEstimado || d.valor || 0) || 0,
          valor_adjudicado: parseFloat(d.valorLiberado || d.valorAdjudicado || 0) || 0,
          situacao: String(d.situacaoConvenio || d.situacao?.descricao || d.situacao || 'N/I').substring(0, 100),
          data_abertura: d.dataInicioVigencia || d.dataAbertura || null,
          vencedor: String(d.proponente?.nome || d.fornecedorVencedor?.nome || d.nomeProponente || '').substring(0, 200) || null,
          atualizado_em: new Date().toISOString()
        }));
        if (result.licitacoes === 0) {
          await deletarAno('licitacoes', ano);
          result.licitacoes = await inserir('licitacoes', lics);
          await log(`Portal/${tipo}`, 'ok', result.licitacoes);
        }
      }

      if (tipo === 'contratos') {
        const forn = dados.map(d => ({
          ano: parseInt(ano),
          nome: String(d.fornecedor?.nome || 'N/I').substring(0, 200),
          cnpj_cpf: String(d.fornecedor?.cnpjCpf || '').substring(0, 20) || null,
          valor_total: parseFloat(d.valorInicialCompra || 0) || 0,
          objeto: String(d.objeto || 'N/I').substring(0, 300),
          numero_contrato: String(d.numero || '').substring(0, 50) || null,
          data_inicio: d.dataInicioVigencia || null,
          data_fim: d.dataFimVigencia || null,
          atualizado_em: new Date().toISOString()
        }));
        await deletarAno('fornecedores', ano);
        result.fornecedores = await inserir('fornecedores', forn);
        await log('Portal/contratos', 'ok', result.fornecedores);
      }
    } catch(e) { result.detalhes.push(`${tipo} erro: ${e.message}`); }
  }

  if (result.licitacoes === 0 && result.fornecedores === 0)
    await log('Portal-Transparencia', 'parcial', 0, result.detalhes.join(' | '));

  return result;
}

// ─── 3. TSE ───────────────────────────────────────────────────────────────────
async function coletarTSE() {
  for (const url of [
    'https://resultados.tse.jus.br/oficial/ele2024/407/dados/ac/ac01392-c0013-e000407-u.json',
    'https://resultados.tse.jus.br/oficial/ele2024/407/dados-simplificados/ac/ac01392-c0013-e000407-u.json',
  ]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const dados = await res.json();
      const eleitos = (dados.cands || []).filter(c =>
        (c.st || '').toLowerCase().match(/eleito|média|media|qp/)
      );
      if (eleitos.length > 0) {
        const vereadores = eleitos.map(c => ({
          nome: (c.nm || c.nmc || 'N/I').substring(0, 200),
          partido: (c.sg || 'N/A').substring(0, 20),
          votos: parseInt(c.vap || c.tv || 0),
          situacao: (c.st || 'Eleito').substring(0, 50),
          municipio: 'Senador Guiomard', uf: 'AC', cargo: 'Vereador',
          atualizado_em: new Date().toISOString()
        }));
        await fetch(`${SUPABASE_URL}/rest/v1/vereadores`, { method: 'DELETE', headers: hSupa });
        const total = await inserir('vereadores', vereadores);
        await log('TSE', 'ok', total);
        return { vereadores: total };
      }
    } catch(e) {}
  }
  await log('TSE', 'parcial', 0, 'API TSE bloqueada para servidores — cadastre manualmente');
  return { vereadores: 0, aviso: 'Cadastre os 9 vereadores manualmente: Supabase > Table Editor > vereadores' };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido' });
  const ano   = req.query.ano || String(new Date().getFullYear());
  const debug = req.query.debug === 'true';
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ erro: 'Variáveis Supabase não configuradas' });
  if (!TRANSP_KEY)                    return res.status(500).json({ erro: 'TRANSPARENCIA_API_KEY não configurada' });

  const t0 = Date.now();
  const [siconfi, transparencia, tse] = await Promise.allSettled([
    coletarSiconfi(ano),
    coletarTransparencia(ano),
    coletarTSE()
  ]);

  const resumo = {
    ano, status: 'concluido', tempo_ms: Date.now() - t0,
    resultados: {
      siconfi:       siconfi.status       === 'fulfilled' ? { receitas: siconfi.value.receitas, despesas: siconfi.value.despesas, indicadores: siconfi.value.indicadores } : { erro: siconfi.reason?.message },
      transparencia: transparencia.status === 'fulfilled' ? { licitacoes: transparencia.value.licitacoes, fornecedores: transparencia.value.fornecedores, detalhes: transparencia.value.detalhes } : { erro: transparencia.reason?.message },
      tse:           tse.status           === 'fulfilled' ? tse.value : { erro: tse.reason?.message }
    }
  };

  if (debug) resumo.debug = {
    siconfi:       siconfi.value       || siconfi.reason?.message,
    transparencia: transparencia.value || transparencia.reason?.message,
    tse:           tse.value           || tse.reason?.message
  };

  return res.status(200).json(resumo);
}
