// api/coletar.js — Quinari em Foco v6 DEFINITIVO
// Estratégia: DELETE por ano antes de INSERT — sem conflitos de unique key
// IBGE: 1200450

const IBGE         = '1200450';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TRANSP_KEY   = process.env.TRANSPARENCIA_API_KEY;

const headers = {
  'Content-Type': 'application/json',
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`
};

// ─── Deleta registros de um ano antes de reinserir ────────────────────────────
async function deletarAno(tabela, ano, campoAno = 'ano') {
  await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${campoAno}=eq.${ano}`, {
    method: 'DELETE', headers
  });
}

// ─── Insere registros sem se preocupar com conflito ───────────────────────────
async function inserir(tabela, registros) {
  if (!registros || registros.length === 0) return 0;
  // Insere em lotes de 100 para não estourar o limite do Supabase
  let total = 0;
  for (let i = 0; i < registros.length; i += 100) {
    const lote = registros.slice(i, i + 100);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify(lote)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase(${tabela}) lote ${i}: ${res.status} — ${err.substring(0, 200)}`);
    }
    total += lote.length;
  }
  return total;
}

async function log(fonte, status, total, erro = null) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/log_coleta`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ fonte, status, total_registros: total, erro, executado_em: new Date().toISOString() })
    });
  } catch(e) {}
}

// ─── Busca RREO de um anexo (tenta todos os bimestres) ────────────────────────
async function buscarRREO(ano, numeroAnexo) {
  for (let bim = 6; bim >= 1; bim--) {
    try {
      const anexoStr = String(numeroAnexo).padStart(2, '0');
      const url = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?an_exercicio=${ano}&nr_periodo=${bim}&co_tipo_demonstrativo=RREO&no_anexo=RREO-Anexo%20${anexoStr}&id_ente=${IBGE}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const json = await res.json();
      const itens = json.items || [];
      if (itens.length > 0) return { itens, bimestre: bim };
    } catch(e) { /* tenta próximo bimestre */ }
  }
  return { itens: [], bimestre: 0 };
}

// ─── 1. SICONFI ───────────────────────────────────────────────────────────────
async function coletarSiconfi(ano) {
  const result = { receitas: 0, despesas: 0, indicadores: 0 };

  // ── Receitas (Anexo 01) ───────────────────────────────────────────────────
  const { itens: itensR, bimestre: bimR } = await buscarRREO(ano, 1);
  if (itensR.length > 0) {
    // Agrupa itens por cod_conta (cada conta tem várias linhas: previsão, realizado...)
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
      const col = (item.coluna || item.rotulo || '').toUpperCase();
      const val = parseFloat(item.valor) || 0;
      if (col.includes('INICIAL'))                                  mapa[chave].orcado     = val;
      if (col.includes('ATUALIZADA') && mapa[chave].orcado === 0)  mapa[chave].orcado     = val;
      if (col.includes('REALIZADO') || col.includes('ARRECADADO')) mapa[chave].arrecadado = val;
    }
    const registros = Object.values(mapa).filter(r => r.orcado > 0 || r.arrecadado > 0);
    if (registros.length > 0) {
      await deletarAno('receitas', ano);
      result.receitas = await inserir('receitas', registros);
      await log(`Siconfi/Receitas bim${bimR}`, 'ok', result.receitas);
    }
  }

  // ── Despesas (Anexo 02) ───────────────────────────────────────────────────
  const { itens: itensD, bimestre: bimD } = await buscarRREO(ano, 2);
  if (itensD.length > 0) {
    const mapa = {};
    for (const item of itensD) {
      const chave = (item.cod_conta || item.conta || '').substring(0, 100);
      if (!chave) continue;
      if (!mapa[chave]) mapa[chave] = {
        ano: parseInt(ano),
        funcao: (item.conta || 'N/I').substring(0, 200),
        categoria: chave,
        dotacao_inicial: 0, dotacao_atualizada: 0,
        empenhado: 0, liquidado: 0, pago: 0,
        atualizado_em: new Date().toISOString()
      };
      const col = (item.coluna || item.rotulo || '').toUpperCase();
      const val = parseFloat(item.valor) || 0;
      if (col.includes('DOTAÇÃO INICIAL')    || col.includes('DOTACAO INICIAL'))    mapa[chave].dotacao_inicial    = val;
      if (col.includes('DOTAÇÃO ATUALIZADA') || col.includes('DOTACAO ATUALIZADA')) mapa[chave].dotacao_atualizada = val;
      if (col.includes('EMPENHADO'))                                                 mapa[chave].empenhado          = val;
      if (col.includes('LIQUIDADO'))                                                 mapa[chave].liquidado          = val;
      if (col.includes('PAGO') || col.includes('REALIZADO'))                        mapa[chave].pago               = val;
    }
    const despesas = Object.values(mapa).filter(r => r.dotacao_inicial > 0 || r.empenhado > 0);
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
      if (itens.length === 0) continue;

      const mapa = {};
      for (const item of itens) {
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
        .map(r => ({ ...r, percentual_limite: r.limite > 0 ? +((r.valor/r.limite)*100).toFixed(2) : null }));

      if (indicadores.length > 0) {
        await deletarAno('indicadores', ano);
        result.indicadores = await inserir('indicadores', indicadores);
        await log(`Siconfi/RGF quad${quad}`, 'ok', result.indicadores);
        break;
      }
    } catch(e) { /* tenta próximo quadrimestre */ }
  }

  return result;
}

// ─── 2. Portal da Transparência ───────────────────────────────────────────────
async function coletarTransparencia(ano) {
  const result = { licitacoes: 0, fornecedores: 0, detalhes: [] };
  const hdrs = { 'chave-api-dados': TRANSP_KEY, 'Accept': 'application/json' };

  const endpoints = [
    { url: `https://api.portaldatransparencia.gov.br/api-de-dados/convenios?codigoIbge=${IBGE}&dataInicioVigencia=01/01/${ano}&dataFimVigencia=31/12/${ano}&pagina=1`, nome: 'convenios' },
    { url: `https://api.portaldatransparencia.gov.br/api-de-dados/licitacoes?codigoIbge=${IBGE}&dataInicial=01/01/${ano}&dataFinal=31/12/${ano}&pagina=1`, nome: 'licitacoes' },
    { url: `https://api.portaldatransparencia.gov.br/api-de-dados/contratos?codigoIbge=${IBGE}&dataInicial=01/01/${ano}&dataFinal=31/12/${ano}&pagina=1`, nome: 'contratos' },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, { headers: hdrs, signal: AbortSignal.timeout(10000) });
      result.detalhes.push(`${ep.nome}: HTTP ${res.status}`);
      if (!res.ok) continue;
      const dados = await res.json();
      if (!Array.isArray(dados) || dados.length === 0) continue;

      if (ep.nome === 'convenios' || ep.nome === 'licitacoes') {
        const lics = dados.map(d => ({
          ano: parseInt(ano),
          numero: String(d.numero || d.nrConvenio || d.id || 'S/N').substring(0, 50),
          modalidade: ep.nome === 'convenios' ? 'Convênio Federal' : String(d.modalidade?.descricao || 'N/I').substring(0, 100),
          objeto: String(d.objeto || d.dsObjeto || 'N/I').substring(0, 500),
          valor_estimado: parseFloat(d.valorConvenio || d.vlConvenio || d.valorEstimado || 0) || 0,
          valor_adjudicado: parseFloat(d.valorLiberado || d.valorAdjudicado || 0) || 0,
          situacao: String(d.situacaoConvenio || d.situacao?.descricao || 'N/I').substring(0, 100),
          data_abertura: d.dataInicioVigencia || d.dataAbertura || null,
          vencedor: String(d.proponente?.nome || d.fornecedorVencedor?.nome || '').substring(0, 200) || null,
          atualizado_em: new Date().toISOString()
        }));
        await deletarAno('licitacoes', ano);
        result.licitacoes = await inserir('licitacoes', lics);
        await log(`Portal/${ep.nome}`, 'ok', result.licitacoes);
        break; // encontrou dados, para
      }

      if (ep.nome === 'contratos') {
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
    } catch(e) {
      result.detalhes.push(`${ep.nome} erro: ${e.message}`);
    }
  }

  if (result.licitacoes === 0 && result.fornecedores === 0) {
    await log('Portal-Transparencia', 'parcial', 0, result.detalhes.join(' | '));
  }
  return result;
}

// ─── 3. TSE ───────────────────────────────────────────────────────────────────
async function coletarTSE() {
  const urlsTSE = [
    'https://resultados.tse.jus.br/oficial/ele2024/407/dados/ac/ac01392-c0013-e000407-u.json',
    'https://resultados.tse.jus.br/oficial/ele2024/407/dados-simplificados/ac/ac01392-c0013-e000407-u.json',
  ];

  for (const url of urlsTSE) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const dados = await res.json();
      const candidatos = dados.cands || dados.candidatos || [];
      const eleitos = candidatos.filter(c =>
        (c.st || '').toLowerCase().includes('eleito') ||
        (c.st || '').toLowerCase().includes('média') ||
        (c.st || '').toLowerCase().includes('qp')
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
        await fetch(`${SUPABASE_URL}/rest/v1/vereadores`, { method: 'DELETE', headers });
        const total = await inserir('vereadores', vereadores);
        await log('TSE', 'ok', total);
        return { vereadores: total };
      }
    } catch(e) {}
  }

  await log('TSE', 'parcial', 0, 'API TSE bloqueada para servidores. Cadastre vereadores manualmente no Supabase.');
  return { vereadores: 0, aviso: 'Cadastre os vereadores manualmente no Supabase > Table Editor > vereadores' };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido' });
  const ano   = req.query.ano || String(new Date().getFullYear());
  const debug = req.query.debug === 'true';
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ erro: 'SUPABASE_URL ou SUPABASE_SERVICE_KEY não configuradas' });
  if (!TRANSP_KEY) return res.status(500).json({ erro: 'TRANSPARENCIA_API_KEY não configurada' });

  const t0 = Date.now();
  const [siconfi, transparencia, tse] = await Promise.allSettled([
    coletarSiconfi(ano),
    coletarTransparencia(ano),
    coletarTSE()
  ]);

  const resumo = {
    ano, status: 'concluido', tempo_ms: Date.now() - t0,
    resultados: {
      siconfi: siconfi.status === 'fulfilled'
        ? { receitas: siconfi.value.receitas, despesas: siconfi.value.despesas, indicadores: siconfi.value.indicadores }
        : { erro: siconfi.reason?.message },
      transparencia: transparencia.status === 'fulfilled'
        ? { licitacoes: transparencia.value.licitacoes, fornecedores: transparencia.value.fornecedores, detalhes: transparencia.value.detalhes }
        : { erro: transparencia.reason?.message },
      tse: tse.status === 'fulfilled' ? tse.value : { erro: tse.reason?.message }
    }
  };

  if (debug) resumo.debug = {
    siconfi: siconfi.value || siconfi.reason?.message,
    transparencia: transparencia.value || transparencia.reason?.message,
    tse: tse.value || tse.reason?.message
  };

  return res.status(200).json(resumo);
}
