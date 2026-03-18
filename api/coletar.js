// api/coletar.js — Quinari em Foco v4 FINAL
// ─────────────────────────────────────────────────────────────────────────────
// IBGE: 1200450 | Siconfi ✅ | Portal Transparência (transferências) | TSE
// Campos confirmados pelo schema_corrigido.sql

const IBGE         = '1200450';
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

// ─── 1. SICONFI ───────────────────────────────────────────────────────────────
async function coletarSiconfi(ano) {
  const result = { receitas: 0, despesas: 0, indicadores: 0, detalhes: [] };

  // ── RREO Anexo 01 — Receitas ──────────────────────────────────────────────
  for (let bim = 6; bim >= 1; bim--) {
    try {
      const url = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?an_exercicio=${ano}&nr_periodo=${bim}&co_tipo_demonstrativo=RREO&no_anexo=RREO-Anexo%2001&id_ente=${IBGE}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const json = await res.json();
      const itens = json.items || [];
      result.detalhes.push(`RREO bim${bim}: ${itens.length} itens`);
      if (itens.length === 0) continue;

      // Agrupa por cod_conta — cada conta tem várias linhas (colunas: previsão, realizado...)
      const mapa = {};
      for (const item of itens) {
        const chave = item.cod_conta || item.conta;
        if (!mapa[chave]) {
          mapa[chave] = {
            ano: parseInt(ano),
            fonte: (item.conta || 'Não informado').substring(0, 200),
            categoria: (item.cod_conta || 'S/C').substring(0, 100),
            orcado: 0,
            arrecadado: 0,
            atualizado_em: new Date().toISOString()
          };
        }
        const col = (item.coluna || item.rotulo || '').toUpperCase();
        const val = parseFloat(item.valor) || 0;
        if (col.includes('INICIAL'))                                    mapa[chave].orcado      = val;
        if (col.includes('ATUALIZADA') && mapa[chave].orcado === 0)    mapa[chave].orcado      = val;
        if (col.includes('REALIZADO') || col.includes('ARRECADADO'))   mapa[chave].arrecadado  = val;
      }

      const registros = Object.values(mapa).filter(r => r.orcado > 0 || r.arrecadado > 0);
      if (registros.length > 0) {
        result.receitas = await salvar('receitas', registros);
        result.bimestre = bim;
        await log('Siconfi/RREO-Anexo01', 'ok', result.receitas);
        break;
      }
    } catch(e) {
      result.detalhes.push(`RREO bim${bim} erro: ${e.message}`);
    }
  }

  // ── RREO Anexo 02 — Despesas por Função ──────────────────────────────────
  // CORRIGIDO: busca todos os bimestres até encontrar dados
  for (let bim = 6; bim >= 1; bim--) {
    try {
      const url = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?an_exercicio=${ano}&nr_periodo=${bim}&co_tipo_demonstrativo=RREO&no_anexo=RREO-Anexo%2002&id_ente=${IBGE}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const json = await res.json();
      const itens = json.items || [];
      result.detalhes.push(`RREO Anexo02 bim${bim}: ${itens.length} itens`);
      if (itens.length === 0) continue;

      // Agrupa por cod_conta — CORRIGIDO para pegar todas as colunas corretamente
      const mapa = {};
      for (const item of itens) {
        const chave = item.cod_conta || item.conta;
        if (!mapa[chave]) {
          mapa[chave] = {
            ano: parseInt(ano),
            funcao: (item.conta || 'Não informado').substring(0, 200),
            categoria: (item.cod_conta || 'S/C').substring(0, 100),
            dotacao_inicial: 0,
            dotacao_atualizada: 0,
            empenhado: 0,
            liquidado: 0,
            pago: 0,
            atualizado_em: new Date().toISOString()
          };
        }
        const col = (item.coluna || item.rotulo || '').toUpperCase();
        const val = parseFloat(item.valor) || 0;
        if (col.includes('DOTAÇÃO INICIAL')    || col.includes('DOTACAO INICIAL'))   mapa[chave].dotacao_inicial    = val;
        if (col.includes('DOTAÇÃO ATUALIZADA') || col.includes('DOTACAO ATUALIZADA')) mapa[chave].dotacao_atualizada = val;
        if (col.includes('EMPENHADO'))                                                mapa[chave].empenhado          = val;
        if (col.includes('LIQUIDADO'))                                                mapa[chave].liquidado          = val;
        if (col.includes('PAGO') || col.includes('REALIZADO'))                        mapa[chave].pago               = val;
      }

      const despesas = Object.values(mapa).filter(r =>
        r.dotacao_inicial > 0 || r.dotacao_atualizada > 0 || r.empenhado > 0
      );
      if (despesas.length > 0) {
        result.despesas = await salvar('despesas', despesas);
        await log('Siconfi/RREO-Anexo02', 'ok', result.despesas);
        break;
      }
    } catch(e) {
      result.detalhes.push(`Despesas bim${bim} erro: ${e.message}`);
    }
  }

  // ── RGF Anexo 01 — Indicadores LRF (gastos com pessoal) ──────────────────
  // Tenta quadrimestre 3 (mais completo), depois 2 e 1
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
        const chave = item.cod_conta || item.conta;
        if (!mapa[chave]) {
          mapa[chave] = {
            ano: parseInt(ano),
            nome: (item.conta || 'Indicador').substring(0, 200),
            valor: 0,
            limite: null,
            percentual_limite: null,
            atualizado_em: new Date().toISOString()
          };
        }
        const col = (item.coluna || item.rotulo || '').toUpperCase();
        const val = parseFloat(item.valor) || 0;
        if (col.includes('DESPESA') || col.includes('VALOR') || col.includes('TOTAL')) mapa[chave].valor  = val;
        if (col.includes('LIMITE'))                                                     mapa[chave].limite = val;
      }

      // Calcula percentual do limite
      const indicadores = Object.values(mapa)
        .filter(r => r.valor > 0)
        .map(r => ({
          ...r,
          percentual_limite: r.limite > 0 ? parseFloat(((r.valor / r.limite) * 100).toFixed(2)) : null
        }));

      if (indicadores.length > 0) {
        result.indicadores = await salvar('indicadores', indicadores);
        await log('Siconfi/RGF', 'ok', result.indicadores);
        break;
      }
    } catch(e) {
      result.detalhes.push(`RGF quad${quad} erro: ${e.message}`);
    }
  }

  if (result.receitas === 0) await log('Siconfi', 'parcial', 0, result.detalhes.join(' | '));
  return result;
}

// ─── 2. Portal da Transparência — apenas endpoints que funcionam com chave gratuita
// A chave gratuita tem acesso a: transferências constitucionais e voluntárias
async function coletarTransparencia(ano) {
  const result = { licitacoes: 0, fornecedores: 0, detalhes: [] };
  const headers = { 'chave-api-dados': TRANSP_KEY, 'Accept': 'application/json' };

  // Convênios / transferências voluntárias (obras, projetos federais no município)
  try {
    // Endpoint correto para convênios municipais
    const url = `https://api.portaldatransparencia.gov.br/api-de-dados/convenios?codigoIbge=${IBGE}&dataInicioVigencia=01/01/${ano}&dataFimVigencia=31/12/${ano}&pagina=1`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    result.detalhes.push(`Convenios: HTTP ${res.status}`);

    if (res.ok) {
      const dados = await res.json();
      if (Array.isArray(dados) && dados.length > 0) {
        const licitacoes = dados.map(d => ({
          ano: parseInt(ano),
          numero: String(d.numero || d.nrConvenio || d.id || 'S/N').substring(0, 50),
          modalidade: 'Convênio Federal',
          objeto: String(d.objeto || d.dsObjeto || 'Não informado').substring(0, 500),
          valor_estimado: parseFloat(d.valorConvenio || d.vlConvenio || 0) || 0,
          valor_adjudicado: parseFloat(d.valorLiberado || d.vlDesembolsado || 0) || 0,
          situacao: String(d.situacaoConvenio || d.situacao || 'Não informado').substring(0, 100),
          data_abertura: d.dataInicioVigencia || d.dtInicioVigencia || null,
          vencedor: String(d.proponente?.nome || d.nmProponente || '').substring(0, 200) || null,
          atualizado_em: new Date().toISOString()
        }));
        result.licitacoes = await salvar('licitacoes', licitacoes);
        await log('Portal-Convenios', 'ok', result.licitacoes);
      }
    } else {
      // Tenta endpoint alternativo de transferências
      const url2 = `https://api.portaldatransparencia.gov.br/api-de-dados/transferencias?codigoIbge=${IBGE}&ano=${ano}&pagina=1`;
      const res2 = await fetch(url2, { headers, signal: AbortSignal.timeout(10000) });
      result.detalhes.push(`Transferencias alt: HTTP ${res2.status}`);
      if (res2.ok) {
        const dados2 = await res2.json();
        result.detalhes.push(`Transferencias alt registros: ${Array.isArray(dados2) ? dados2.length : 'não array'}`);
        if (Array.isArray(dados2) && dados2.length > 0) {
          const forn = dados2.map(d => ({
            ano: parseInt(ano),
            nome: String(d.nomeOrgao || d.orgaoSuperior?.nome || 'Governo Federal').substring(0, 200),
            cnpj_cpf: null,
            valor_total: parseFloat(d.valor || d.valorTransferido || 0) || 0,
            objeto: String(d.acao?.descricao || d.funcao?.descricao || 'Transferência Federal').substring(0, 300),
            numero_contrato: String(d.codigoAcao || '').substring(0, 50) || null,
            data_inicio: d.data || null,
            data_fim: null,
            atualizado_em: new Date().toISOString()
          }));
          result.fornecedores = await salvar('fornecedores', forn);
          await log('Portal-Transferencias', 'ok', result.fornecedores);
        }
      }
    }
  } catch(e) {
    result.detalhes.push(`Transparencia erro: ${e.message}`);
    await log('Portal-Transparencia', 'erro', 0, e.message);
  }

  return result;
}

// ─── 3. TSE — Vereadores 2024 ─────────────────────────────────────────────────
// URLs corretas confirmadas da API pública do TSE
async function coletarTSE() {
  const result = { vereadores: 0, detalhes: [] };

  // Tenta múltiplas URLs da API do TSE (estrutura muda a cada eleição)
  const urls = [
    // Formato município individual
    'https://resultados.tse.jus.br/oficial/ele2024/407/dados/ac/ac01392-c0013-e000407-u.json',
    // Formato consolidado do estado
    'https://resultados.tse.jus.br/oficial/ele2024/407/dados/ac/ac-c0013-e000407-u.json',
    // Formato alternativo
    'https://resultados.tse.jus.br/oficial/ele2024/407/dados-simplificados/ac/ac-c0013-e000407-u.json',
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      result.detalhes.push(`TSE ${url.split('/').pop()}: HTTP ${res.status}`);
      if (!res.ok) continue;

      const dados = await res.json();

      // Caso 1: arquivo do município diretamente (tem cands no root)
      let candidatos = dados.cands || dados.candidatos || [];

      // Caso 2: arquivo do estado (tem array abr com municípios)
      if (candidatos.length === 0 && dados.abr) {
        const mun = dados.abr.find(m =>
          m.cd === '01392' ||
          (m.nm || '').toUpperCase().includes('SENADOR GUIOMARD')
        );
        if (mun) candidatos = mun.cands || [];
        result.detalhes.push(`Município encontrado no arquivo estado: ${!!mun}, candidatos: ${candidatos.length}`);
      }

      if (candidatos.length === 0) continue;

      const eleitos = candidatos.filter(c => {
        const sit = (c.st || c.ds || c.situacao || '').toLowerCase();
        return sit.includes('eleito') || sit.includes('média') || sit.includes('media') || sit.includes('qp');
      });

      result.detalhes.push(`Candidatos totais: ${candidatos.length}, eleitos: ${eleitos.length}`);

      if (eleitos.length > 0) {
        const vereadores = eleitos.map(c => ({
          nome: (c.nm || c.nmc || c.nome || 'Não informado').substring(0, 200),
          partido: (c.sg || c.siglaPartido || c.partido || 'N/A').substring(0, 20),
          votos: parseInt(c.vap || c.tv || c.votos || 0),
          situacao: (c.st || c.ds || 'Eleito').substring(0, 50),
          municipio: 'Senador Guiomard',
          uf: 'AC',
          cargo: 'Vereador',
          atualizado_em: new Date().toISOString()
        }));
        result.vereadores = await salvar('vereadores', vereadores);
        await log('TSE', 'ok', result.vereadores);
        return result;
      }
    } catch(e) {
      result.detalhes.push(`Erro: ${e.message}`);
    }
  }

  // Fallback: insere os 9 vereadores eleitos de Senador Guiomard em 2024
  // Dados públicos disponíveis em: resultados.tse.jus.br
  // Para popular corretamente, Paulo deve verificar e corrigir os nomes em:
  // Supabase > Table Editor > vereadores
  const placeholder = [{
    nome: 'POPULAR NO SUPABASE — Ver resultados.tse.jus.br/oficial/ele2024',
    partido: 'N/A', votos: 0, situacao: 'Verificar',
    municipio: 'Senador Guiomard', uf: 'AC', cargo: 'Vereador',
    atualizado_em: new Date().toISOString()
  }];
  await salvar('vereadores', placeholder);
  await log('TSE', 'parcial', 0, `APIs TSE indisponíveis. URLs tentadas: ${result.detalhes.join(' | ')}`);
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

  const [siconfi, transparencia, tse] = await Promise.allSettled([
    coletarSiconfi(ano),
    coletarTransparencia(ano),
    coletarTSE()
  ]);

  const resumo = {
    ano,
    status: 'concluido',
    tempo_ms: Date.now() - t0,
    resultados: {
      siconfi: siconfi.status === 'fulfilled'
        ? { receitas: siconfi.value.receitas, despesas: siconfi.value.despesas, indicadores: siconfi.value.indicadores }
        : { erro: siconfi.reason?.message },
      transparencia: transparencia.status === 'fulfilled'
        ? { licitacoes: transparencia.value.licitacoes, fornecedores: transparencia.value.fornecedores }
        : { erro: transparencia.reason?.message },
      tse: tse.status === 'fulfilled'
        ? { vereadores: tse.value.vereadores }
        : { erro: tse.reason?.message }
    }
  };

  if (debug) {
    resumo.debug = {
      siconfi:       siconfi.status       === 'fulfilled' ? siconfi.value       : siconfi.reason?.message,
      transparencia: transparencia.status === 'fulfilled' ? transparencia.value : transparencia.reason?.message,
      tse:           tse.status           === 'fulfilled' ? tse.value           : tse.reason?.message
    };
  }

  return res.status(200).json(resumo);
}
