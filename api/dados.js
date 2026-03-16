// api/dados.js
// Endpoint que as páginas do portal usam para buscar dados reais do Supabase
// Exemplo: /api/dados?tabela=receitas&ano=2025

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Tabelas permitidas (segurança: apenas leitura de tabelas públicas)
const TABELAS_PERMITIDAS = [
  'receitas', 'despesas', 'licitacoes', 'fornecedores',
  'diario_oficial', 'orcamento_bimestral', 'indicadores',
  'vereadores', 'configuracoes', 'log_coleta'
];

export default async function handler(req) {
  const url = new URL(req.url);
  const tabela = url.searchParams.get('tabela');
  const ano    = url.searchParams.get('ano');
  const limite = Math.min(parseInt(url.searchParams.get('limite') || '100'), 500);
  const ordem  = url.searchParams.get('ordem');
  const filtros = url.searchParams.get('filtros'); // JSON: {"status":"ativo"}

  if (!tabela || !TABELAS_PERMITIDAS.includes(tabela)) {
    return new Response(JSON.stringify({
      erro: 'Tabela não permitida',
      permitidas: TABELAS_PERMITIDAS
    }), {
      status: 400,
      headers: corsHeaders()
    });
  }

  // Monta a query para o Supabase
  let supabaseQuery = `${SUPABASE_URL}/rest/v1/${tabela}?select=*&limit=${limite}`;

  if (ano) supabaseQuery += `&ano=eq.${ano}`;
  if (ordem) supabaseQuery += `&order=${ordem}`;

  // Filtros adicionais opcionais
  if (filtros) {
    try {
      const f = JSON.parse(filtros);
      for (const [chave, valor] of Object.entries(f)) {
        supabaseQuery += `&${chave}=eq.${encodeURIComponent(valor)}`;
      }
    } catch {}
  }

  try {
    const res = await fetch(supabaseQuery, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ erro: `Supabase retornou ${res.status}` }), {
        status: 500,
        headers: corsHeaders()
      });
    }

    const dados = await res.json();

    return new Response(JSON.stringify({
      tabela,
      total: dados.length,
      dados,
      atualizado_em: new Date().toISOString()
    }), {
      status: 200,
      headers: corsHeaders()
    });

  } catch (err) {
    return new Response(JSON.stringify({ erro: err.message }), {
      status: 500,
      headers: corsHeaders()
    });
  }
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, s-maxage=300' // Cache de 5 min no Vercel Edge
  };
}
