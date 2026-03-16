// api/dados.js — Node.js runtime

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PERMITIDAS   = ['receitas','despesas','licitacoes','fornecedores',
  'diario_oficial','orcamento_bimestral','indicadores','vereadores','configuracoes','log_coleta'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=300');

  const { tabela, ano, limite = '100', ordem, filtros } = req.query || {};

  if (!tabela || !PERMITIDAS.includes(tabela)) {
    return res.status(400).json({ erro: 'Tabela não permitida', permitidas: PERMITIDAS });
  }

  let q = `${SUPABASE_URL}/rest/v1/${tabela}?select=*&limit=${Math.min(parseInt(limite),500)}`;
  if (ano)    q += `&ano=eq.${ano}`;
  if (ordem)  q += `&order=${ordem}`;
  if (filtros) {
    try { for (const [k,v] of Object.entries(JSON.parse(filtros))) q += `&${k}=eq.${v}`; } catch(_) {}
  }

  try {
    const r = await fetch(q, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Accept': 'application/json' }
    });
    if (!r.ok) return res.status(500).json({ erro: `Supabase ${r.status}` });
    const dados = await r.json();
    return res.status(200).json({ tabela, total: dados.length, dados });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
};
