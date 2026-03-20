// api/calendario.js — Calendário Municipal de Senador Guiomard
// GET /api/calendario?mes=3&ano=2026 → eventos do mês
// GET /api/calendario?proximos=7   → próximos N dias
// POST /api/calendario → { acao:'adicionar', evento:{titulo,data,hora,cat,desc,local} }
//
// Tabela Supabase (executar no SQL Editor):
// CREATE TABLE IF NOT EXISTS calendario_eventos (
//   id bigserial primary key,
//   titulo text not null,
//   data date not null,
//   hora text,
//   cat text not null default 'outro',
//   descricao text,
//   local text,
//   criado_em timestamptz default now()
// );
// ALTER TABLE calendario_eventos ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "leitura_publica" ON calendario_eventos FOR SELECT USING (true);
// CREATE POLICY "insercao_publica" ON calendario_eventos FOR INSERT WITH CHECK (true);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6Z3p0dmlhanRjdGhxZ2VrdnJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2ODc2OTgsImV4cCI6MjA4OTI2MzY5OH0.RN3a0gfygXo9BsGZpwaVLIgbQv8AO0K6-dWF0SIazTw';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const hGet = {
  'apikey': SUPABASE_ANON,
  'Authorization': `Bearer ${SUPABASE_ANON}`,
  'Accept': 'application/json'
};
const hPost = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Prefer': 'return=minimal'
};

const CATS_VALIDAS = ['camara','prefeitura','saude','educacao','feriado','outro'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, s-maxage=120');
    try {
      const { mes, ano, proximos } = req.query;
      let url;
      if (proximos) {
        const hoje = new Date().toISOString().slice(0, 10);
        const fim = new Date(Date.now() + parseInt(proximos, 10) * 86400000).toISOString().slice(0, 10);
        url = `${SUPABASE_URL}/rest/v1/calendario_eventos?select=*&data=gte.${hoje}&data=lte.${fim}&order=data.asc,hora.asc&limit=50`;
      } else if (mes && ano) {
        const m = String(mes).padStart(2, '0');
        const dataIni = `${ano}-${m}-01`;
        const dataFim = new Date(parseInt(ano), parseInt(mes), 0).toISOString().slice(0, 10);
        url = `${SUPABASE_URL}/rest/v1/calendario_eventos?select=*&data=gte.${dataIni}&data=lte.${dataFim}&order=data.asc,hora.asc&limit=200`;
      } else {
        // mês atual
        const now = new Date();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const y = now.getFullYear();
        const dataIni = `${y}-${m}-01`;
        const dataFim = new Date(y, now.getMonth() + 1, 0).toISOString().slice(0, 10);
        url = `${SUPABASE_URL}/rest/v1/calendario_eventos?select=*&data=gte.${dataIni}&data=lte.${dataFim}&order=data.asc,hora.asc&limit=200`;
      }

      const r = await fetch(url, { headers: hGet });
      if (!r.ok) {
        const err = await r.text();
        if (err.includes('does not exist') || err.includes('relation') || r.status === 404) {
          return res.status(200).json({ eventos: [], aviso: 'Tabela ainda não criada' });
        }
        return res.status(500).json({ erro: `Supabase ${r.status}` });
      }
      const eventos = await r.json();
      return res.status(200).json({ eventos });
    } catch (e) {
      return res.status(500).json({ erro: e.message });
    }
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (_) {}
    const { acao, evento } = body;

    if (acao !== 'adicionar') return res.status(400).json({ erro: 'Ação inválida. Use: adicionar' });
    if (!evento?.titulo || !evento?.data || !evento?.cat) {
      return res.status(400).json({ erro: 'Campos obrigatórios: titulo, data, cat' });
    }
    if (!CATS_VALIDAS.includes(evento.cat)) {
      return res.status(400).json({ erro: `Categoria inválida. Use: ${CATS_VALIDAS.join(', ')}` });
    }

    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/calendario_eventos`, {
        method: 'POST', headers: hPost,
        body: JSON.stringify({
          titulo: evento.titulo.substring(0, 200),
          data: evento.data,
          hora: (evento.hora || '').substring(0, 5) || null,
          cat: evento.cat,
          descricao: (evento.descricao || '').substring(0, 1000),
          local: (evento.local || '').substring(0, 200)
        })
      });
      if (!r.ok) return res.status(500).json({ erro: `Supabase ${r.status}` });
      return res.status(201).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ erro: e.message });
    }
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
