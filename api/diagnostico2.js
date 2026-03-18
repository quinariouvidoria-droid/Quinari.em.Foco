// api/diagnostico2.js — descobre schema Supabase e codigoOrgao correto
// Acesse: https://quinari-em-foco.vercel.app/api/diagnostico2

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TRANSP_KEY   = process.env.TRANSPARENCIA_API_KEY;
const IBGE = '1200450';

// Descobre colunas tentando inserir um registro inválido e lendo o erro
async function descobrirColunas(tabela) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ __teste__: true }) // campo que não existe — vai gerar erro com lista de colunas
  });
  const txt = await res.text();
  return { status: res.status, resposta: txt.substring(0, 600) };
}

// Busca codigoOrgao correto para municípios no Portal da Transparência
// O endpoint correto para gastos municipais é diferente
async function buscarOrgaoMunicipio() {
  const headers = { 'chave-api-dados': TRANSP_KEY, 'Accept': 'application/json' };
  const resultados = {};

  // Tenta despesas diretamente sem codigoOrgao (alguns endpoints aceitam só IBGE)
  const url1 = `https://api.portaldatransparencia.gov.br/api-de-dados/despesas/por-funcao?codigoIbge=${IBGE}&ano=2024&pagina=1`;
  const r1 = await fetch(url1, { headers, signal: AbortSignal.timeout(8000) });
  resultados.despesas_por_funcao = { status: r1.status, body: (await r1.text()).substring(0, 400) };

  // Tenta endpoint de municípios
  const url2 = `https://api.portaldatransparencia.gov.br/api-de-dados/municipios/${IBGE}`;
  const r2 = await fetch(url2, { headers, signal: AbortSignal.timeout(8000) });
  resultados.municipio_info = { status: r2.status, body: (await r2.text()).substring(0, 400) };

  // Tenta licitações sem codigoOrgao — só com IBGE e datas
  const url3 = `https://api.portaldatransparencia.gov.br/api-de-dados/licitacoes?codigoIbge=${IBGE}&dataInicial=01/01/2024&dataFinal=31/12/2024&pagina=1`;
  const r3 = await fetch(url3, { headers, signal: AbortSignal.timeout(8000) });
  resultados.licitacoes_sem_orgao = { status: r3.status, body: (await r3.text()).substring(0, 400) };

  // Tenta contratos sem codigoOrgao
  const url4 = `https://api.portaldatransparencia.gov.br/api-de-dados/contratos?codigoIbge=${IBGE}&dataInicial=01/01/2024&dataFinal=31/12/2024&pagina=1`;
  const r4 = await fetch(url4, { headers, signal: AbortSignal.timeout(8000) });
  resultados.contratos_sem_orgao = { status: r4.status, body: (await r4.text()).substring(0, 400) };

  return resultados;
}

export default async function handler(req, res) {
  const tabelas = ['receitas', 'despesas', 'licitacoes', 'fornecedores', 'vereadores', 'indicadores'];
  const schemas = {};
  for (const t of tabelas) {
    schemas[t] = await descobrirColunas(t);
  }

  const orgao = await buscarOrgaoMunicipio();

  return res.status(200).json({ schemas, orgao });
}
