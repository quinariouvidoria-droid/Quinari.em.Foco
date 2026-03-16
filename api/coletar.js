// api/coletar.js
// Coleta dados públicos de 2020 até o ano atual
// Fontes: Siconfi/STN, Portal da Transparência, TSE

export const config = { runtime: 'edge', maxDuration: 60 };

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_KEY;
const TRANSP_KEY        = process.env.TRANSPARENCIA_API_KEY || '';
const IBGE_COD          = '1200435'; // Senador Guiomard - AC
const ANO_INICIO        = 2020;
const ANO_HOJE          = new Date().getFullYear();
const MES_ATUAL         = new Date().getMonth() + 1;
// Siconfi publica com ~2 meses de atraso — até junho usa ano anterior
const ANO_SICONFI_MAX   = MES_ATUAL <= 6 ? ANO_HOJE - 1 : ANO_HOJE;
const ANOS              = Array.from(
  { length: ANO_SICONFI_MAX - ANO_INICIO + 1 },
  (_, i) => ANO_INICIO + i
); // [2020, 2021, 2022, 2023, 2024, ...]

// ── Helpers Supabase ────────────────────────────────────────
async function sbInsert(tabela, dados) {
  if (!dados || dados.length === 0) return true;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(dados)
  });
  return res.ok;
}

async function sbDelete(tabela, filtro) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${filtro}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  return res.ok;
}

async function sbPatch(tabela, filtro, dados) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${filtro}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify(dados)
  });
  return res.ok;
}

async function log(fonte, status, registros, mensagem) {
  await sbInsert('log_coleta', [{
    fonte, status,
    registros_inseridos: registros,
    mensagem,
    executado_em: new Date().toISOString()
  }]);
}

// ── Fetch com timeout ───────────────────────────────────────
async function fetchJSON(url, headers = {}, timeoutMs = 20000) {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', ...headers },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return { erro: res.status, dados: null };
    const dados = await res.json();
    return { erro: null, dados };
  } catch (err) {
    return { erro: err.message, dados: null };
  }
}

// ── MAPA DE FUNÇÕES DE DESPESA ──────────────────────────────
const FUNC_MAP = {
  '01': 'Legislativo', '02': 'Judiciário', '03': 'Essencial à Justiça',
  '04': 'Administração', '05': 'Defesa Nacional', '06': 'Segurança Pública',
  '07': 'Relações Exteriores', '08': 'Assistência Social', '09': 'Previdência Social',
  '10': 'Saúde', '11': 'Trabalho', '12': 'Educação', '13': 'Cultura',
  '14': 'Direitos da Cidadania', '15': 'Urbanismo', '16': 'Habitação',
  '17': 'Saneamento', '18': 'Gestão Ambiental', '19': 'Ciência e Tecnologia',
  '20': 'Agricultura', '21': 'Organização Agrária', '22': 'Indústria',
  '23': 'Comércio e Serviços', '24': 'Comunicações', '25': 'Energia',
  '26': 'Transporte', '27': 'Desporto e Lazer', '28': 'Encargos Especiais'
};

// ══════════════════════════════════════════════════════════════
// 1. SICONFI — Receitas e Despesas por ano (2020 → atual)
// ══════════════════════════════════════════════════════════════
async function coletarSiconfiAno(ano) {
  const resultado = { receitas: 0, despesas: 0, orcamento: 0 };

  // Tenta do bimestre 6 ao 1 — pega o mais recente publicado
  let rreoData = null;
  let bimestre = 0;

  for (let bim = 6; bim >= 1; bim--) {
    const url = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?` +
      `an_exercicio=${ano}&nr_periodo=${bim}&co_tipo_demonstrativo=RREO&co_municipio=${IBGE_COD}`;
    const { dados } = await fetchJSON(url);
    if (dados?.items?.length > 0) {
      rreoData = dados.items;
      bimestre = bim;
      break;
    }
    // Pequeno delay para não sobrecarregar a API
    await new Promise(r => setTimeout(r, 300));
  }

  if (!rreoData) {
    await log(`Siconfi/${ano}`, 'parcial', 0, `Nenhum dado RREO para ${ano}`);
    return resultado;
  }

  // ── Processa receitas ──
  const recMap = {};
  const despMap = {};
  let recTotal = 0, recPrev = 0, despTotal = 0, despAut = 0;

  for (const item of rreoData) {
    const conta = (item.no_conta || '').toUpperCase();
    const tipo  = (item.co_tipo_valor || '').toUpperCase();
    const valor = parseFloat(item.vl_valor || 0);
    if (isNaN(valor) || valor === 0) continue;

    // ── Classifica receitas ──
    let nomeRec = null, catRec = null;
    if (conta.includes('FPM') || (conta.includes('PARTICIP') && conta.includes('MUNIC'))) {
      nomeRec = 'FPM — Fundo de Participação dos Municípios'; catRec = 'constitucional';
    } else if (conta.includes('FUNDEB')) {
      nomeRec = 'FUNDEB'; catRec = 'educacao';
    } else if (conta.includes('SUS') || (conta.includes('SAÚDE') && conta.includes('TRANSFER'))) {
      nomeRec = 'SUS — Repasses do Ministério da Saúde'; catRec = 'saude';
    } else if (conta.includes('ICMS') && conta.includes('COTA')) {
      nomeRec = 'ICMS — Cota-Parte (Estado)'; catRec = 'constitucional';
    } else if (conta.includes('IPVA') && conta.includes('COTA')) {
      nomeRec = 'IPVA — Cota-Parte (Estado)'; catRec = 'constitucional';
    } else if (conta.includes('ITR') && conta.includes('COTA')) {
      nomeRec = 'ITR — Cota-Parte'; catRec = 'constitucional';
    } else if (conta.includes('FNDE') || conta.includes('PNAE') || conta.includes('PNATE') || conta.includes('PDDE')) {
      nomeRec = 'FNDE — Educação (PNAE/PNATE/PDDE)'; catRec = 'educacao';
    } else if (conta.includes('FNAS') || conta.includes('ASSIST') && conta.includes('SOCIAL')) {
      nomeRec = 'FNAS — Assistência Social'; catRec = 'convenio';
    } else if (conta.includes('EMENDA') || conta.includes('CONVENIO') || conta.includes('CONVÊNIO')) {
      nomeRec = 'Convênios e Emendas Federais'; catRec = 'convenio';
    } else if (conta.includes('ISS') || conta.includes('IMPOSTO SOBRE SERV')) {
      nomeRec = 'ISS — Imposto Sobre Serviços'; catRec = 'propria';
    } else if (conta.includes('IPTU')) {
      nomeRec = 'IPTU'; catRec = 'propria';
    }

    if (nomeRec) {
      if (!recMap[nomeRec]) recMap[nomeRec] = { cat: catRec, prev: 0, arr: 0 };
      if (tipo.includes('PREV') || tipo.includes('INICIAL')) recMap[nomeRec].prev += valor;
      if (tipo.includes('ARREC') || tipo.includes('REALIZ')) recMap[nomeRec].arr += valor;
    }

    if (tipo.includes('ARREC') || tipo.includes('REALIZ')) recTotal += valor;
    if (tipo.includes('PREV') || tipo.includes('INICIAL')) recPrev += valor;

    // ── Classifica despesas ──
    if (item.co_funcao) {
      const func = FUNC_MAP[item.co_funcao] || `Função ${item.co_funcao}`;
      if (!despMap[func]) despMap[func] = { dot: 0, emp: 0, liq: 0, pago: 0 };
      if (tipo.includes('INICIAL') || tipo.includes('DOTAÇÃO')) { despMap[func].dot += valor; despAut += valor; }
      if (tipo.includes('EMPENH')) { despMap[func].emp += valor; despTotal += valor; }
      if (tipo.includes('LIQUID')) despMap[func].liq += valor;
      if (tipo === 'PAGO' || tipo.includes('PAGAMENT')) despMap[func].pago += valor;
    }
  }

  // ── Salva receitas ──
  await sbDelete('receitas', `ano=eq.${ano}&periodo=eq.${bimestre}`);
  const recRows = Object.entries(recMap)
    .filter(([, d]) => d.arr > 0 || d.prev > 0)
    .map(([nome, d]) => ({
      ano, periodo: bimestre, nome,
      categoria: d.cat,
      previsto: d.prev || d.arr * 1.05,
      arrecadado: d.arr,
      fonte: 'Siconfi/STN',
      atualizado_em: new Date().toISOString()
    }));
  if (recRows.length > 0) { await sbInsert('receitas', recRows); resultado.receitas = recRows.length; }

  // ── Salva despesas ──
  await sbDelete('despesas', `ano=eq.${ano}&periodo=eq.${bimestre}`);
  const despRows = Object.entries(despMap)
    .filter(([, d]) => d.emp > 0 || d.pago > 0)
    .map(([funcao, d]) => ({
      ano, periodo: bimestre, funcao,
      dotacao: d.dot, empenhado: d.emp,
      liquidado: d.liq, pago: d.pago,
      fonte: 'Siconfi/STN',
      atualizado_em: new Date().toISOString()
    }));
  if (despRows.length > 0) { await sbInsert('despesas', despRows); resultado.despesas = despRows.length; }

  // ── Salva execução orçamentária ──
  const resultado_exec = despTotal > recTotal * 1.02 ? 'deficit'
    : despTotal < recTotal * 0.98 ? 'superavit' : 'equilibrado';
  await sbInsert('orcamento_bimestral', [{
    ano, bimestre,
    receita_prevista: recPrev,
    receita_realizada: recTotal,
    despesa_autorizada: despAut,
    despesa_executada: despTotal,
    resultado: resultado_exec,
    fonte: 'Siconfi/STN',
    atualizado_em: new Date().toISOString()
  }]);
  resultado.orcamento = 1;

  await log(`Siconfi/${ano}`, 'sucesso',
    resultado.receitas + resultado.despesas,
    `${ano} · Bim ${bimestre} · ${resultado.receitas} receitas · ${resultado.despesas} despesas`);

  return resultado;
}

// ══════════════════════════════════════════════════════════════
// 2. PORTAL DA TRANSPARÊNCIA — Fornecedores por ano
// ══════════════════════════════════════════════════════════════
async function coletarFornecedoresAno(ano) {
  if (!TRANSP_KEY) {
    await log(`Fornecedores/${ano}`, 'parcial', 0, 'TRANSPARENCIA_API_KEY não configurada');
    return 0;
  }

  const url = `https://api.portaldatransparencia.gov.br/api-de-dados/contratos?` +
    `municipioContratado=${IBGE_COD}&ano=${ano}&pagina=1&quantidade=50`;

  const { erro, dados } = await fetchJSON(url, { 'chave-api-dados': TRANSP_KEY });

  if (erro || !Array.isArray(dados) || dados.length === 0) {
    await log(`Fornecedores/${ano}`, 'parcial', 0, erro || 'Sem dados');
    return 0;
  }

  // Agrega por CNPJ
  const fornMap = {};
  for (const c of dados) {
    const cnpj  = c.fornecedor?.cnpjFormatado || c.fornecedor?.cpfFormatado || '—';
    const nome  = c.fornecedor?.nome || 'Não identificado';
    const valor = parseFloat(c.valorInicialCompra || 0);
    const serv  = (c.objetoContrato || 'Não especificado').substring(0, 200);
    if (!fornMap[cnpj]) fornMap[cnpj] = { nome, cnpj, servico: serv, total: 0 };
    fornMap[cnpj].total += valor;
  }

  await sbDelete('fornecedores', `ano=eq.${ano}`);
  const rows = Object.values(fornMap).map(f => ({
    ano, nome: f.nome, cnpj: f.cnpj,
    servico: f.servico, total_recebido: f.total,
    situacao_rf: 'Regular', alerta: false,
    fonte: 'Portal da Transparência',
    atualizado_em: new Date().toISOString()
  }));

  await sbInsert('fornecedores', rows);
  await log(`Fornecedores/${ano}`, 'sucesso', rows.length, `${rows.length} fornecedores`);
  return rows.length;
}

// ══════════════════════════════════════════════════════════════
// 3. PORTAL DA TRANSPARÊNCIA — Licitações por ano
// ══════════════════════════════════════════════════════════════
async function coletarLicitacoesAno(ano) {
  if (!TRANSP_KEY) {
    await log(`Licitações/${ano}`, 'parcial', 0, 'TRANSPARENCIA_API_KEY não configurada');
    return 0;
  }

  const url = `https://api.portaldatransparencia.gov.br/api-de-dados/licitacoes?` +
    `codigoMunicipioIbge=${IBGE_COD}&ano=${ano}&pagina=1&quantidade=50`;

  const { erro, dados } = await fetchJSON(url, { 'chave-api-dados': TRANSP_KEY });

  if (erro || !Array.isArray(dados) || dados.length === 0) {
    await log(`Licitações/${ano}`, 'parcial', 0, erro || 'Sem dados');
    return 0;
  }

  const hoje = new Date();
  const rows = dados.map(l => {
    const enc  = l.dataEncerramentoVigencia ? new Date(l.dataEncerramentoVigencia) : null;
    const dias = enc ? Math.ceil((enc - hoje) / 86400000) : null;
    const status = !enc ? 'aberto'
      : dias < 0 ? 'encerrado'
      : dias <= 60 ? 'vencendo' : 'ativo';

    return {
      numero: l.numero || l.codigoLicitacao || '—',
      modalidade: (l.modalidade?.descricao || 'Pregão').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace('pregao eletronico', 'pregao').replace('pregão', 'pregao'),
      objeto: (l.objeto || '—').substring(0, 300),
      empresa: l.fornecedor?.nome || l.vencedor?.nome || 'Em andamento',
      cnpj: l.fornecedor?.cnpjFormatado || '—',
      valor: parseFloat(l.valorInicial || l.valorHomologado || 0),
      data_abertura: l.dataAberturaLicitacao || null,
      data_encerramento: l.dataEncerramentoVigencia || null,
      status,
      link_edital: l.link || null,
      fonte: 'Portal da Transparência',
      atualizado_em: new Date().toISOString()
    };
  });

  // Deleta licitações antigas deste ano antes de reinserir
  await sbDelete('licitacoes', `data_abertura=gte.${ano}-01-01&data_abertura=lte.${ano}-12-31`);
  await sbInsert('licitacoes', rows);
  await log(`Licitações/${ano}`, 'sucesso', rows.length, `${rows.length} licitações`);
  return rows.length;
}

// ══════════════════════════════════════════════════════════════
// 4. TSE — Vereadores (coleta uma vez, dados de 2020 e 2024)
// ══════════════════════════════════════════════════════════════
async function coletarVereadores() {
  let total = 0;
  for (const anoEleicao of [2020, 2024]) {
    const url = `https://dadosabertos.tse.jus.br/api/3/action/datastore_search?` +
      `resource_id=consulta_cand_${anoEleicao}_AC` +
      `&filters={"NM_MUNICIPIO":"SENADOR GUIOMARD","DS_CARGO":"VEREADOR","DS_SIT_TOT_TURNO":"ELEITO"}` +
      `&limit=15`;

    const { dados } = await fetchJSON(url);
    const records = dados?.result?.records || [];

    if (records.length > 0) {
      const rows = records.map(v => ({
        nome: v.NM_CANDIDATO || v.NM_URNA_CANDIDATO || '—',
        partido: v.SG_PARTIDO || '—',
        numero_urna: parseInt(v.NR_CANDIDATO || 0),
        votos_recebidos: parseInt(v.QT_VOTOS_NOMINAIS || 0),
        escolaridade: v.DS_GRAU_INSTRUCAO || '—',
        data_nascimento: v.DT_NASCIMENTO
          ? new Date(v.DT_NASCIMENTO).toISOString().split('T')[0] : null,
        patrimonio_declarado: parseFloat(v.VR_BEM_CANDIDATO || 0),
        ano_declaracao: anoEleicao,
        fonte: `TSE ${anoEleicao}`,
        atualizado_em: new Date().toISOString()
      }));
      await sbInsert('vereadores', rows);
      total += rows.length;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  await log('TSE/Vereadores', total > 0 ? 'sucesso' : 'parcial', total,
    `${total} vereadores coletados`);
  return total;
}

// ══════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ══════════════════════════════════════════════════════════════
export default async function handler(req) {
  const authHeader  = req.headers.get('authorization');
  const isCron      = req.headers.get('x-vercel-cron') === '1';
  const isDevGet    = req.method === 'GET';
  const hasKey      = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCron && !isDevGet && !hasKey) {
    return new Response(JSON.stringify({ erro: 'Não autorizado' }), { status: 401 });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify({ erro: 'Variáveis de ambiente não configuradas' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Verifica se é coleta forçada de todos os anos ou só atualização diária
  const url    = new URL(req.url);
  const forcar = url.searchParams.get('forcar') === 'true';
  // Por padrão coleta só o ano mais recente para não exceder o tempo limite
  // Com ?forcar=true coleta todos os anos de 2020 até o atual
  const anosParaColetar = forcar ? ANOS : [ANOS[ANOS.length - 1]];

  console.log(`[Quinari Cron] Anos: ${anosParaColetar.join(', ')} · ${new Date().toISOString()}`);

  const inicio = Date.now();
  const resumo = {};

  // Coleta Siconfi ano a ano (sequencial para não sobrecarregar)
  for (const ano of anosParaColetar) {
    resumo[`siconfi_${ano}`] = await coletarSiconfiAno(ano);
    await new Promise(r => setTimeout(r, 500)); // Delay entre anos
  }

  // Coleta Portal da Transparência (paralela por ano)
  if (TRANSP_KEY) {
    const [forn, lic] = await Promise.allSettled(
      anosParaColetar.map(ano => coletarFornecedoresAno(ano)),
      anosParaColetar.map(ano => coletarLicitacoesAno(ano))
    );
    resumo.fornecedores = forn.value || 0;
    resumo.licitacoes   = lic.value || 0;
  }

  // Vereadores (coleta uma vez)
  if (forcar || !resumo.vereadores) {
    resumo.vereadores = await coletarVereadores();
  }

  // Atualiza timestamp
  await sbPatch('configuracoes', 'chave=eq.ultima_atualizacao',
    { valor: new Date().toISOString() });

  const duracao = ((Date.now() - inicio) / 1000).toFixed(1);

  return new Response(JSON.stringify({
    sucesso: true,
    modo: forcar ? 'historico_completo_2020_atual' : 'atualizacao_diaria',
    anos_coletados: anosParaColetar,
    duracao_segundos: duracao,
    executado_em: new Date().toISOString(),
    resumo
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
