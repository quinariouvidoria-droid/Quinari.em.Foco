// api/votos.js — Termômetro Popular e Voz do Povo
// GET /api/votos?tipo=termometro → retorna contagens por politico_id
// POST /api/votos → { tipo:'termometro', politico_id:'lenon', voto:'a'|'d' }
//
// Tabela Supabase (executar uma vez no SQL Editor):
// CREATE TABLE IF NOT EXISTS votos_termometro (
//   id bigserial primary key,
//   politico_id text not null,
//   voto char(1) not null check (voto in ('a','d')),
//   criado_em timestamptz default now()
// );
// ALTER TABLE votos_termometro ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "leitura_publica" ON votos_termometro FOR SELECT USING (true);
// CREATE POLICY "insercao_publica" ON votos_termometro FOR INSERT WITH CHECK (true);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6Z3p0dmlhanRjdGhxZ2VrdnJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2ODc2OTgsImV4cCI6MjA4OTI2MzY5OH0.RN3a0gfygXo9BsGZpwaVLIgbQv8AO0K6-dWF0SIazTw';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const hAnon = { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}`, 'Accept': 'application/json' };
  const hService = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json', 'Accept': 'application/json', 'Prefer': 'return=minimal' };

  // ── GET: retornar contagens agregadas ─────────────────────────────────────
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, s-maxage=30'); // cache 30s
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/votos_termometro?select=politico_id,voto`,
        { headers: hAnon }
      );
      if (!r.ok) {
        const err = await r.text();
        // Se tabela não existe ainda, retornar dados zerados
        if (r.status === 404 || err.includes('does not exist') || err.includes('relation')) {
          return res.status(200).json({ dados: [], aviso: 'Tabela ainda não criada — use localStorage por enquanto' });
        }
        return res.status(500).json({ erro: `Supabase ${r.status}` });
      }
      const rows = await r.json();
      // Agregar: { politico_id: { a: N, d: N } }
      const agg = {};
      for (const row of rows) {
        if (!agg[row.politico_id]) agg[row.politico_id] = { a: 0, d: 0 };
        agg[row.politico_id][row.voto] = (agg[row.politico_id][row.voto] || 0) + 1;
      }
      return res.status(200).json({ dados: agg });
    } catch (e) {
      return res.status(500).json({ erro: e.message });
    }
  }

  // ── POST: registrar voto ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch (_) {}

    const { politico_id, voto } = body;
    if (!politico_id || !['a','d'].includes(voto)) {
      return res.status(400).json({ erro: 'Parâmetros: politico_id e voto ("a" ou "d")' });
    }

    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/votos_termometro`, {
        method: 'POST',
        headers: hService,
        body: JSON.stringify({ politico_id, voto, criado_em: new Date().toISOString() })
      });
      if (!r.ok) {
        const err = await r.text();
        if (err.includes('does not exist') || err.includes('relation')) {
          return res.status(503).json({ erro: 'Tabela votos_termometro ainda não criada no Supabase' });
        }
        return res.status(500).json({ erro: `Supabase ${r.status}: ${err.substring(0,200)}` });
      }
      return res.status(201).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ erro: e.message });
    }
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
