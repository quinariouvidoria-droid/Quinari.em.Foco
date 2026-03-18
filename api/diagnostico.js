// api/diagnostico.js — Quinari em Foco
// Rota temporária para inspecionar o schema real do Supabase
// Acesse: https://quinari-em-foco.vercel.app/api/diagnostico

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TRANSP_KEY   = process.env.TRANSPARENCIA_API_KEY;
const IBGE = '1200450';

async function inspecionarTabela(tabela) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?limit=1`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  const texto = await res.text();
  let dados = null;
  try { dados = JSON.parse(texto); } catch(e) { dados = texto; }
  return { status: res.status, dados };
}

async function buscarCodigoOrgao() {
  // O Portal da Transparência exige codigoOrgao — precisamos descobrir o código da prefeitura
  // Endpoint de órgãos municipais
  const res = await fetch(
    `https://api.portaldatransparencia.gov.br/api-de-dados/orgaos-siafi?codigoIbge=${IBGE}&pagina=1`,
    {
      headers: { 'chave-api-dados': TRANSP_KEY, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    }
  );
  const texto = await res.text();
  return { status: res.status, body: texto.substring(0, 500) };
}

async function buscarSiconfiAmostra() {
  // Pega 2 itens do Siconfi para ver os campos reais
  const url = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?an_exercicio=2024&nr_periodo=6&co_tipo_demonstrativo=RREO&no_anexo=RREO-Anexo%2001&id_ente=${IBGE}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return { status: res.status };
  const json = await res.json();
  return {
    status: res.status,
    total_itens: json.items?.length,
    // Mostra os primeiros 2 itens completos para ver todos os campos
    amostra: json.items?.slice(0, 2),
    campos: json.items?.[0] ? Object.keys(json.items[0]) : []
  };
}

export default async function handler(req, res) {
  const tabelas = ['receitas', 'despesas', 'licitacoes', 'fornecedores', 'vereadores', 'indicadores'];
  const schemas = {};
  for (const t of tabelas) {
    schemas[t] = await inspecionarTabela(t);
  }

  const [orgao, siconfi] = await Promise.allSettled([
    buscarCodigoOrgao(),
    buscarSiconfiAmostra()
  ]);

  return res.status(200).json({
    schemas_supabase: schemas,
    portal_transparencia_orgaos: orgao.status === 'fulfilled' ? orgao.value : orgao.reason?.message,
    siconfi_amostra: siconfi.status === 'fulfilled' ? siconfi.value : siconfi.reason?.message
  });
}
