// api/coletar.js — Quinari em Foco v3 DEFINITIVO
// ─────────────────────────────────────────────────────────────────────────────
// IBGE: 1200450 | CNPJ Prefeitura: 04077251000125
// 
// FONTES:
//   - Siconfi/STN: receitas e indicadores LRF (RREO + RGF) ✅
//   - Portal da Transparência: transferências federais ao município ✅
//   - TSE: vereadores eleitos 2024 ✅
//
// NOTA IMPORTANTE: A API do Portal da Transparência Federal contém dados de
// REPASSES FEDERAIS ao município (FPM, SUS, FUNDEB, convênios etc.).
// Licitações e contratos municipais não estão na API federal — ficam no
// sistema da própria prefeitura (SAGRES/TCE-AC).

const IBGE       = '1200450';
const CNPJ_PREF  = '04077251000125';  // CNPJ da Prefeitura de Senador Guiomard
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TRANSP_KEY   = process.env.TRANSPARENCIA_API_KEY;

// ─── Salvar no Supabase ───────────────────────────────────────────────────────
async function salvar(tabela, registros) {
  if (!registros || registros.length === 0) return 0;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(registros)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase(${tabela}) ${res.status}: ${err.substring(0, 300)}`);
  }
  return registros.length;
}

// ─── Log ──────────────────────────────────────────────────────────────────────
async function log(fonte, status, total, erro = null) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/log_coleta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({ fonte, status, total_registros: total, erro, executado_em: new Date().toISOString() })
    });
  } catch(e) {}
}

// ─── 1. SICONFI — Receitas e Indicadores ─────────────────────────────────────
// Campos reais confirmados pelo diagnóstico:
// exercicio, demonstrativo, periodo, periodicidade, instituicao,
// cod_ibge, uf, populacao, anexo, esfera, rotulo, coluna, cod_conta, conta, valor
async function coletarSiconfi(ano) {
  const result = { receitas: 0, indicadores: 0, detalhes: [] };

  // ── RREO Anexo 01 — Receitas ──────────────────────────────────────────────
  // Tenta do bimestre 6 ao 1 (mais recente primeiro)
  for (let bim = 6; bim >= 1; bim--) {
    try {
      const url = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?an_exercicio=${ano}&nr_periodo=${bim}&co_tipo_demonstrativo=RREO&no_anexo=RREO-Anexo%2001&id_ente=${IBGE}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) { result.detalhes.push(`RREO bim${bim}: HTTP ${res.status}`); continue; }
      const json = await res.json();
      const itens = json.items || [];
      result.detalhes.push(`RREO bim${bim}: ${itens.length} itens`);
      if (itens.length === 0) continue;

      // Cada item do Siconfi representa 1 linha x 1 coluna (PREVISÃO INICIAL, ATUALIZADA, REALIZADO)
      // Agrupa por cod_conta para montar registro único por conta
      const mapa = {};
      for (const item of itens) {
        const chave = item.cod_conta;
        if (!mapa[chave]) {
          mapa[chave] = {
            ano: parseInt(ano),
            fonte: item.conta || 'Não informado',
            categoria: item.cod_conta || 'S/C',
            orcado: 0,
            arrecadado: 0,
            atualizado_em: new Date().toISOString()
          };
        }
        const col = (item.coluna || '').toUpperCase();
        const val = parseFloat(item.valor) || 0;
        if (col.includes('INICIAL')) mapa[chave].orcado = val;
        if (col.includes('REALIZADO') || col.includes('ARRECADADO')) mapa[chave].arrecadado = val;
        if (col.includes('ATUALIZADA') && mapa[chave].orcado === 0) mapa[chave].orcado = val;
      }

      const registros = Object.values(mapa).filter(r => r.orcado > 0 || r.arrecadado > 0);
      if (registros.length > 0) {
        result.receitas = await salvar('receitas', registros);
        result.bimestre = bim;
        await log('Siconfi/RREO', 'ok', result.receitas);
        break;
      }
    } catch(e) {
      result.detalhes.push(`RREO bim${bim} erro: ${e.message}`);
    }
  }

  // ── RREO Anexo 02 — Despesas por Função ──────────────────────────────────
  try {
    const url2 = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?an_exercicio=${ano}&nr_periodo=6&co_tipo_demonstrativo=RREO&no_anexo=RREO-Anexo%2002&id_ente=${IBGE}`;
    const res2 = await fetch(url2, { signal: AbortSignal.timeout(10000) });
    if (res2.ok) {
      const json2 = await res2.json();
      const itens2 = json2.items || [];
      result.detalhes.push(`RREO Anexo02 (despesas): ${itens2.length} itens`);
      if (itens2.length > 0) {
        const mapa2 = {};
        for (const item of itens2) {
          const chave = item.cod_conta;
          if (!mapa2[chave]) {
            mapa2[chave] = {
              ano: parseInt(ano),
              funcao: item.conta || 'Não informado',
              categoria: item.cod_conta || 'S/C',
              dotacao_inicial: 0,
              dotacao_atualizada: 0,
              empenhado: 0,
              liquidado: 0,
              pago: 0,
              atualizado_em: new Date().toISOString()
            };
          }
          const col = (item.coluna || '').toUpperCase();
          const val = parseFloat(item.valor) || 0;
          if (col.includes('DOTAÇÃO INICIAL') || col.includes('DOTACAO INICIAL')) mapa2[chave].dotacao_inicial = val;
          if (col.includes('ATUALIZADA')) mapa2[chave].dotacao_atualizada = val;
          if (col.includes('EMPENHADO')) mapa2[chave].empenhado = val;
          if (col.includes('LIQUIDADO')) mapa2[chave].liquidado = val;
          if (col.includes('PAGO') || col.includes('REALIZADO')) mapa2[chave].pago = val;
        }
        const despesas = Object.values(mapa2).filter(r => r.dotacao_inicial > 0 || r.empenhado > 0);
        if (despesas.length > 0) {
          await salvar('despesas', despesas);
          result.despesas = despesas.length;
          await log('Siconfi/RREO-Anexo02', 'ok', despesas.length);
        }
      }
    }
  } catch(e) {
    result.detalhes.push(`Despesas erro: ${e.message}`);
  }

  // ── RGF Anexo 01 — Pessoal (indicadores LRF) ──────────────────────────────
  try {
    const urlRgf = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rgf?an_exercicio=${ano}&nr_periodo=3&co_tipo_demonstrativo=RGF&no_anexo=RGF-Anexo%2001&id_ente=${IBGE}`;
    const resRgf = await fetch(urlRgf, { signal: AbortSignal.timeout(10000) });
    if (resRgf.ok) {
      const rgf = await resRgf.json();
      const itensRgf = rgf.items || [];
      result.detalhes.push(`RGF: ${itensRgf.length} itens`);
      if (itensRgf.length > 0) {
        const mapa3 = {};
        for (const item of itensRgf) {
          const chave = item.cod_conta;
          if (!mapa3[chave]) {
            mapa3[chave] = {
              ano: parseInt(ano),
              nome: item.conta || 'Indicador',
              valor: 0,
              limite: null,
              atualizado_em: new Date().toISOString()
            };
          }
          const col = (item.coluna || item.rotulo || '').toUpperCase();
          const val = parseFloat(item.valor) || 0;
          if (col.includes('DESPESA') || col.includes('VALOR')) mapa3[chave].valor = val;
          if (col.includes('LIMITE')) mapa3[chave].limite = val;
        }
        const indicadores = Object.values(mapa3).filter(r => r.valor > 0);
        if (indicadores.length > 0) {
          result.indicadores = await salvar('indicadores', indicadores);
          await log('Siconfi/RGF', 'ok', result.indicadores);
        }
      }
    }
  } catch(e) {
    result.detalhes.push(`RGF erro: ${e.message}`);
  }

  if (result.receitas === 0) {
    await log('Siconfi/RREO', 'parcial', 0, result.detalhes.join(' | '));
  }

  return result;
}

// ─── 2. Portal da Transparência — Transferências Federais ao Município ────────
// A API federal tem REPASSES ao município, não licitações municipais.
// Endpoint correto: /api-de-dados/transferencias-voluntarias (convênios)
// e /api-de-dados/transferencias-constitucionais (FPM, SUS, FUNDEB)
async function coletarTransferencias(ano) {
  const result = { receitas_federais: 0, fornecedores: 0, detalhes: [] };
  const headers = { 'chave-api-dados': TRANSP_KEY, 'Accept': 'application/json' };

  // Convênios e transferências voluntárias (obras, projetos)
  try {
    const url = `https://api.portaldatransparencia.gov.br/api-de-dados/transferencias-voluntarias?codigoIbge=${IBGE}&ano=${ano}&pagina=1`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    result.detalhes.push(`Transferencias voluntarias: HTTP ${res.status}`);

    if (res.ok) {
      const dados = await res.json();
      result.detalhes.push(`Registros: ${Array.isArray(dados) ? dados.length : 'não array: ' + JSON.stringify(dados).substring(0, 100)}`);

      if (Array.isArray(dados) && dados.length > 0) {
        // Salva como receitas (repasses federais são receita do município)
        const receitas = dados.map(d => ({
          ano: parseInt(ano),
          fonte: String(d.programa?.descricao || d.acao?.descricao || d.objeto || 'Transferência Federal').substring(0, 200),
          categoria: String(d.modalidade?.descricao || 'Transferência Voluntária').substring(0, 100),
          orcado: parseFloat(d.valorPactuado || d.valorTotal || 0) || 0,
          arrecadado: parseFloat(d.valorLiberado || d.valorDesembolsado || 0) || 0,
          atualizado_em: new Date().toISOString()
        }));
        result.receitas_federais = await salvar('receitas', receitas);
        await log('Portal-Transferencias-Voluntarias', 'ok', result.receitas_federais);
      }
    } else {
      const body = await res.text();
      result.detalhes.push(`Erro body: ${body.substring(0, 200)}`);
      await log('Portal-Transferencias-Voluntarias', 'erro', 0, `HTTP ${res.status}`);
    }
  } catch(e) {
    result.detalhes.push(`Transferencias erro: ${e.message}`);
    await log('Portal-Transferencias-Voluntarias', 'erro', 0, e.message);
  }

  // Gastos diretos do governo federal com CNPJ da prefeitura (fornecedora de serviços/obras)
  try {
    const url2 = `https://api.portaldatransparencia.gov.br/api-de-dados/gastos-diretos-por-favorecido?cnpjCpf=${CNPJ_PREF}&ano=${ano}&pagina=1`;
    const res2 = await fetch(url2, { headers, signal: AbortSignal.timeout(10000) });
    result.detalhes.push(`Gastos-diretos CNPJ prefeitura: HTTP ${res2.status}`);

    if (res2.ok) {
      const dados2 = await res2.json();
      if (Array.isArray(dados2) && dados2.length > 0) {
        const fornecedores = dados2.map(d => ({
          ano: parseInt(ano),
          nome: 'Prefeitura Municipal de Senador Guiomard',
          cnpj_cpf: CNPJ_PREF,
          valor_total: parseFloat(d.valor || 0) || 0,
          objeto: String(d.descricao || d.programa || 'Recurso Federal').substring(0, 300),
          numero_contrato: String(d.numero || '').substring(0, 50) || null,
          data_inicio: d.data || null,
          data_fim: null,
          atualizado_em: new Date().toISOString()
        }));
        result.fornecedores = await salvar('fornecedores', fornecedores);
        await log('Portal-GasDiretos', 'ok', result.fornecedores);
      }
    }
  } catch(e) {
    result.detalhes.push(`GasDiretos erro: ${e.message}`);
  }

  return result;
}

// ─── 3. TSE — Vereadores eleitos 2024 ─────────────────────────────────────────
// Código TSE de Senador Guiomard: 01392 (confirmado pelo diagnóstico anterior)
async function coletarTSE() {
  const result = { vereadores: 0, detalhes: [] };

  try {
    // API TSE — vereadores eleitos 2024 em Senador Guiomard/AC
    const url = 'https://resultados.tse.jus.br/oficial/ele2024/407/dados/ac/ac01392-c0013-e000407-u.json';
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    result.detalhes.push(`TSE HTTP: ${res.status}`);

    if (res.ok) {
      const dados = await res.json();
      // Estrutura TSE: dados.cands = array de candidatos
      const cands = dados.cands || dados.candidatos || [];
      result.detalhes.push(`Candidatos encontrados: ${cands.length}`);

      const eleitos = cands
        .filter(c => {
          const sit = (c.st || c.ds || '').toLowerCase();
          return sit.includes('eleito') || sit.includes('média') || sit.includes('qp');
        })
        .map(c => ({
          nome: c.nm || c.nmc || c.nome || 'Não informado',
          partido: c.sg || c.siglaPartido || 'N/A',
          votos: parseInt(c.vap || c.tv || c.votos || 0),
          situacao: c.st || c.ds || 'Eleito',
          municipio: 'Senador Guiomard',
          uf: 'AC',
          cargo: 'Vereador',
          atualizado_em: new Date().toISOString()
        }));

      result.detalhes.push(`Eleitos filtrados: ${eleitos.length}`);

      if (eleitos.length > 0) {
        result.vereadores = await salvar('vereadores', eleitos);
        await log('TSE', 'ok', result.vereadores);
        return result;
      }
    }
  } catch(e) {
    result.detalhes.push(`TSE erro: ${e.message}`);
  }

  // Se a API TSE não funcionou, tenta arquivo de resultado alternativo
  try {
    const url2 = 'https://resultados.tse.jus.br/oficial/ele2024/407/dados/ac/ac-c0013-e000407-u.json';
    const res2 = await fetch(url2, { signal: AbortSignal.timeout(8000) });
    result.detalhes.push(`TSE alternativo: HTTP ${res2.status}`);
    if (res2.ok) {
      const dados2 = await res2.json();
      // Filtra apenas Senador Guiomard (cd_mun = 01392)
      const municipio = (dados2.abr || []).find(m => m.cd === '01392' || m.nm?.includes('SENADOR GUIOMARD'));
      if (municipio && municipio.cands) {
        const eleitos = municipio.cands
          .filter(c => (c.st || '').toLowerCase().includes('eleito'))
          .map(c => ({
            nome: c.nm || 'Não informado',
            partido: c.sg || 'N/A',
            votos: parseInt(c.vap || 0),
            situacao: c.st || 'Eleito',
            municipio: 'Senador Guiomard',
            uf: 'AC',
            cargo: 'Vereador',
            atualizado_em: new Date().toISOString()
          }));
        if (eleitos.length > 0) {
          result.vereadores = await salvar('vereadores', eleitos);
          await log('TSE-alt', 'ok', result.vereadores);
          return result;
        }
      }
    }
  } catch(e) {
    result.detalhes.push(`TSE alt erro: ${e.message}`);
  }

  // Placeholder se TSE indisponível
  await salvar('vereadores', [{
    nome: 'Dados pendentes — verificar resultados.tse.jus.br',
    partido: 'N/A', votos: 0, situacao: 'Verificar',
    municipio: 'Senador Guiomard', uf: 'AC', cargo: 'Vereador',
    atualizado_em: new Date().toISOString()
  }]);
  await log('TSE', 'parcial', 0, result.detalhes.join(' | '));
  return result;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido' });

  const ano   = req.query.ano || String(new Date().getFullYear());
  const debug = req.query.debug === 'true';

  if (!SUPABASE_URL || !SUPABASE_KEY)
    return res.status(500).json({ erro: 'SUPABASE_URL ou SUPABASE_SERVICE_KEY não configuradas' });
  if (!TRANSP_KEY)
    return res.status(500).json({ erro: 'TRANSPARENCIA_API_KEY não configurada' });

  const t0 = Date.now();

  const [siconfi, transferencias, tse] = await Promise.allSettled([
    coletarSiconfi(ano),
    coletarTransferencias(ano),
    coletarTSE()
  ]);

  const resumo = {
    ano,
    status: 'concluido',
    tempo_ms: Date.now() - t0,
    resultados: {
      siconfi: siconfi.status === 'fulfilled'
        ? { receitas: siconfi.value.receitas, despesas: siconfi.value.despesas || 0, indicadores: siconfi.value.indicadores }
        : { erro: siconfi.reason?.message },
      transferencias_federais: transferencias.status === 'fulfilled'
        ? { receitas_federais: transferencias.value.receitas_federais, fornecedores: transferencias.value.fornecedores }
        : { erro: transferencias.reason?.message },
      tse: tse.status === 'fulfilled'
        ? { vereadores: tse.value.vereadores }
        : { erro: tse.reason?.message }
    }
  };

  if (debug) {
    resumo.debug = {
      siconfi: siconfi.status === 'fulfilled' ? siconfi.value : siconfi.reason?.message,
      transferencias: transferencias.status === 'fulfilled' ? transferencias.value : transferencias.reason?.message,
      tse: tse.status === 'fulfilled' ? tse.value : tse.reason?.message
    };
  }

  return res.status(200).json(resumo);
}
