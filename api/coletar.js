// api/coletar.js — Node.js runtime (Vercel Hobby: max 25s)

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;
const TRANSP_KEY      = process.env.TRANSPARENCIA_API_KEY || '';
const IBGE_COD        = '1200435';
const ANO_HOJE        = new Date().getFullYear();
const MES_ATUAL       = new Date().getMonth() + 1;
const ANO_SICONFI_MAX = MES_ATUAL <= 6 ? ANO_HOJE - 1 : ANO_HOJE;

const FUNC_MAP = {
  '01':'Legislativo','04':'Administração','08':'Assistência Social',
  '10':'Saúde','12':'Educação','15':'Urbanismo / Obras',
  '17':'Saneamento','18':'Gestão Ambiental','20':'Agricultura',
  '26':'Transporte','27':'Desporto e Lazer'
};

// ── Helpers ──────────────────────────────────────────────────
async function sb(tabela, method, body, filtro) {
  const url = `${SUPABASE_URL}/rest/v1/${tabela}${filtro ? '?' + filtro : ''}`;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
  };
  if (method === 'POST') headers['Prefer'] = 'resolution=merge-duplicates,return=minimal';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return res.ok;
}

async function log(fonte, status, n, msg) {
  try {
    await sb('log_coleta', 'POST', [{ fonte, status, registros_inseridos: n, mensagem: msg, executado_em: new Date().toISOString() }]);
  } catch(_) {}
}

async function get(url, headers = {}) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 18000);
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', ...headers },
      signal: controller.signal
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, status: res.status, data: null };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e.message };
  }
}

// ── Siconfi ───────────────────────────────────────────────────
async function coletarSiconfi(ano) {
  let items = null, bim = 0;
  for (let b = 6; b >= 1; b--) {
    const r = await get(
      `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?an_exercicio=${ano}&nr_periodo=${b}&co_tipo_demonstrativo=RREO&co_municipio=${IBGE_COD}`
    );
    if (r.ok && r.data?.items?.length > 0) { items = r.data.items; bim = b; break; }
    await new Promise(r => setTimeout(r, 200));
  }
  if (!items) { await log(`Siconfi/${ano}`, 'parcial', 0, 'Sem dados RREO'); return {receitas:0,despesas:0}; }

  const recMap = {}, despMap = {};
  for (const item of items) {
    const conta = (item.no_conta || '').toUpperCase();
    const tipo  = (item.co_tipo_valor || '').toUpperCase();
    const val   = parseFloat(item.vl_valor || 0);
    if (!val) continue;

    let nome = null, cat = null;
    if (conta.includes('FPM'))                         { nome = 'FPM'; cat = 'constitucional'; }
    else if (conta.includes('FUNDEB'))                 { nome = 'FUNDEB'; cat = 'educacao'; }
    else if (conta.includes('SUS'))                    { nome = 'SUS — Repasses Saúde'; cat = 'saude'; }
    else if (conta.includes('ICMS') && conta.includes('COTA')) { nome = 'ICMS-Cota Parte'; cat = 'constitucional'; }
    else if (conta.includes('IPVA') && conta.includes('COTA')) { nome = 'IPVA-Cota Parte'; cat = 'constitucional'; }
    else if (conta.includes('FNDE') || conta.includes('PNAE') || conta.includes('PNATE')) { nome = 'FNDE/Educação'; cat = 'educacao'; }
    else if (conta.includes('ISS'))                    { nome = 'ISS'; cat = 'propria'; }
    else if (conta.includes('IPTU'))                   { nome = 'IPTU'; cat = 'propria'; }
    else if (conta.includes('EMENDA') || conta.includes('CONV')) { nome = 'Convênios/Emendas'; cat = 'convenio'; }

    if (nome) {
      if (!recMap[nome]) recMap[nome] = { cat, prev: 0, arr: 0 };
      if (tipo.includes('PREV') || tipo.includes('INICIAL')) recMap[nome].prev += val;
      if (tipo.includes('ARREC') || tipo.includes('REALIZ'))  recMap[nome].arr  += val;
    }

    if (item.co_funcao) {
      const f = FUNC_MAP[item.co_funcao] || `Função ${item.co_funcao}`;
      if (!despMap[f]) despMap[f] = { dot:0, emp:0, liq:0, pago:0 };
      if (tipo.includes('INICIAL') || tipo.includes('DOTAÇÃO')) despMap[f].dot  += val;
      if (tipo.includes('EMPENH'))                              despMap[f].emp  += val;
      if (tipo.includes('LIQUID'))                              despMap[f].liq  += val;
      if (tipo === 'PAGO' || tipo.includes('PAGAMENT'))         despMap[f].pago += val;
    }
  }

  // Salva
  await sb('receitas', 'DELETE', null, `ano=eq.${ano}&periodo=eq.${bim}`);
  const rRows = Object.entries(recMap).filter(([,d])=>d.arr>0||d.prev>0).map(([nome,d])=>({
    ano, periodo:bim, nome, categoria:d.cat,
    previsto: d.prev||d.arr*1.05, arrecadado:d.arr,
    fonte:'Siconfi/STN', atualizado_em:new Date().toISOString()
  }));
  if (rRows.length) await sb('receitas', 'POST', rRows);

  await sb('despesas', 'DELETE', null, `ano=eq.${ano}&periodo=eq.${bim}`);
  const dRows = Object.entries(despMap).filter(([,d])=>d.emp>0||d.pago>0).map(([funcao,d])=>({
    ano, periodo:bim, funcao,
    dotacao:d.dot, empenhado:d.emp, liquidado:d.liq, pago:d.pago,
    fonte:'Siconfi/STN', atualizado_em:new Date().toISOString()
  }));
  if (dRows.length) await sb('despesas', 'POST', dRows);

  const recT = rRows.reduce((s,r)=>s+r.arrecadado,0);
  const despT = dRows.reduce((s,d)=>s+d.pago,0);
  await sb('orcamento_bimestral', 'POST', [{
    ano, bimestre:bim,
    receita_prevista: rRows.reduce((s,r)=>s+r.previsto,0),
    receita_realizada: recT,
    despesa_autorizada: dRows.reduce((s,d)=>s+d.dotacao,0),
    despesa_executada: despT,
    resultado: despT>recT*1.02?'deficit':despT<recT*0.98?'superavit':'equilibrado',
    fonte:'Siconfi/STN', atualizado_em:new Date().toISOString()
  }]);

  await log(`Siconfi/${ano}`, 'sucesso', rRows.length+dRows.length,
    `Bim${bim} · ${rRows.length} receitas · ${dRows.length} despesas`);
  return { receitas: rRows.length, despesas: dRows.length };
}

// ── Fornecedores ──────────────────────────────────────────────
async function coletarFornecedores(ano) {
  if (!TRANSP_KEY) return 0;
  const r = await get(
    `https://api.portaldatransparencia.gov.br/api-de-dados/contratos?municipioContratado=${IBGE_COD}&ano=${ano}&pagina=1&quantidade=50`,
    { 'chave-api-dados': TRANSP_KEY }
  );
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) {
    await log(`Fornecedores/${ano}`, 'parcial', 0, `status ${r.status}`); return 0;
  }
  const map = {};
  for (const c of r.data) {
    const cnpj = c.fornecedor?.cnpjFormatado || '—';
    const nome = c.fornecedor?.nome || '—';
    const val  = parseFloat(c.valorInicialCompra || 0);
    if (!map[cnpj]) map[cnpj] = { nome, cnpj, servico:(c.objetoContrato||'—').slice(0,200), total:0 };
    map[cnpj].total += val;
  }
  await sb('fornecedores', 'DELETE', null, `ano=eq.${ano}`);
  const rows = Object.values(map).map(f=>({...f, ano, situacao_rf:'Regular', alerta:false, fonte:'Portal da Transparência', atualizado_em:new Date().toISOString()}));
  await sb('fornecedores', 'POST', rows);
  await log(`Fornecedores/${ano}`, 'sucesso', rows.length, `${rows.length} fornecedores`);
  return rows.length;
}

// ── Licitações ────────────────────────────────────────────────
async function coletarLicitacoes(ano) {
  if (!TRANSP_KEY) return 0;
  const r = await get(
    `https://api.portaldatransparencia.gov.br/api-de-dados/licitacoes?codigoMunicipioIbge=${IBGE_COD}&ano=${ano}&pagina=1&quantidade=50`,
    { 'chave-api-dados': TRANSP_KEY }
  );
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) {
    await log(`Licitações/${ano}`, 'parcial', 0, `status ${r.status}`); return 0;
  }
  const hoje = new Date();
  const rows = r.data.map(l => {
    const enc  = l.dataEncerramentoVigencia ? new Date(l.dataEncerramentoVigencia) : null;
    const dias = enc ? Math.ceil((enc-hoje)/86400000) : null;
    return {
      numero: l.numero||'—',
      modalidade: (l.modalidade?.descricao||'pregao').toLowerCase().replace(/[^a-z]/g,'').replace('pregaoeletronico','pregao'),
      objeto: (l.objeto||'—').slice(0,300),
      empresa: l.fornecedor?.nome||'—', cnpj: l.fornecedor?.cnpjFormatado||'—',
      valor: parseFloat(l.valorInicial||0),
      data_abertura: l.dataAberturaLicitacao||null,
      data_encerramento: l.dataEncerramentoVigencia||null,
      status: !enc?'aberto':dias<0?'encerrado':dias<=60?'vencendo':'ativo',
      link_edital: l.link||null, fonte:'Portal da Transparência',
      atualizado_em: new Date().toISOString()
    };
  });
  await sb('licitacoes', 'POST', rows);
  await log(`Licitações/${ano}`, 'sucesso', rows.length, `${rows.length} licitações`);
  return rows.length;
}

// ── Handler ───────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ erro: 'Variáveis de ambiente não configuradas' });
  }

  const ano = parseInt(req.query?.ano) || ANO_SICONFI_MAX;
  const inicio = Date.now();
  const resumo = {};

  console.log(`[Quinari] Coletando ${ano}`);

  try { resumo.siconfi = await coletarSiconfi(ano); } catch(e) { resumo.siconfi_erro = e.message; }
  try { resumo.fornecedores = await coletarFornecedores(ano); } catch(_) { resumo.fornecedores = 0; }
  try { resumo.licitacoes = await coletarLicitacoes(ano); } catch(_) { resumo.licitacoes = 0; }

  // Atualiza timestamp
  try { await sb('configuracoes', 'PATCH', { valor: new Date().toISOString() }, 'chave=eq.ultima_atualizacao'); } catch(_) {}

  const duracao = ((Date.now()-inicio)/1000).toFixed(1);
  return res.status(200).json({ sucesso:true, ano, duracao_segundos:duracao, executado_em:new Date().toISOString(), resumo });
};
