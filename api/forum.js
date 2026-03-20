// api/forum.js — Fórum Municipal de Senador Guiomard
// GET /api/forum              → lista tópicos recentes com contagem de respostas
// GET /api/forum?topico_id=X  → tópico + todas as respostas
// POST /api/forum → { acao:'criar', topico:{titulo,cat,desc,autor,email} }
// POST /api/forum → { acao:'responder', topico_id, texto, autor, email }
// POST /api/forum → { acao:'curtir', topico_id } (incrementa curtidas)
//
// Tabelas Supabase (executar no SQL Editor):
// CREATE TABLE IF NOT EXISTS forum_topicos (
//   id bigserial primary key,
//   titulo text not null,
//   cat text not null default 'geral',
//   descricao text,
//   autor text not null,
//   email text,
//   curtidas int not null default 0,
//   fixado boolean not null default false,
//   criado_em timestamptz default now()
// );
// CREATE TABLE IF NOT EXISTS forum_respostas (
//   id bigserial primary key,
//   topico_id bigint not null references forum_topicos(id) on delete cascade,
//   texto text not null,
//   autor text not null,
//   email text,
//   curtidas int not null default 0,
//   criado_em timestamptz default now()
// );
// ALTER TABLE forum_topicos ENABLE ROW LEVEL SECURITY;
// ALTER TABLE forum_respostas ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "leitura_publica_top" ON forum_topicos FOR SELECT USING (true);
// CREATE POLICY "insercao_publica_top" ON forum_topicos FOR INSERT WITH CHECK (true);
// CREATE POLICY "update_publica_top" ON forum_topicos FOR UPDATE USING (true);
// CREATE POLICY "leitura_publica_res" ON forum_respostas FOR SELECT USING (true);
// CREATE POLICY "insercao_publica_res" ON forum_respostas FOR INSERT WITH CHECK (true);
// CREATE POLICY "update_publica_res" ON forum_respostas FOR UPDATE USING (true);

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
  'Prefer': 'return=representation'
};
const hPatch = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Prefer': 'return=minimal'
};

const CATS_VALIDAS = ['infraestrutura','saude','educacao','seguranca','meio_ambiente','transporte','cultura','administracao','denuncia','geral'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, s-maxage=30');
    const { topico_id } = req.query;
    try {
      if (topico_id) {
        // detalhe do tópico + respostas
        const [rTop, rRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/forum_topicos?id=eq.${encodeURIComponent(topico_id)}&select=*`, { headers: hGet }),
          fetch(`${SUPABASE_URL}/rest/v1/forum_respostas?topico_id=eq.${encodeURIComponent(topico_id)}&select=*&order=criado_em.asc&limit=200`, { headers: hGet })
        ]);
        if (!rTop.ok) return res.status(500).json({ erro: `Supabase ${rTop.status}` });
        const [topico] = await rTop.json();
        const respostas = rRes.ok ? await rRes.json() : [];
        return res.status(200).json({ topico, respostas });
      } else {
        // lista de tópicos com contagem de respostas
        const [rTop, rRes] = await Promise.all([
          fetch(`${SUPABASE_URL}/rest/v1/forum_topicos?select=*&order=fixado.desc,criado_em.desc&limit=100`, { headers: hGet }),
          fetch(`${SUPABASE_URL}/rest/v1/forum_respostas?select=topico_id&limit=5000`, { headers: hGet })
        ]);
        if (!rTop.ok) {
          const err = await rTop.text();
          if (err.includes('does not exist') || err.includes('relation') || rTop.status === 404) {
            return res.status(200).json({ topicos: [], aviso: 'Tabelas ainda não criadas' });
          }
          return res.status(500).json({ erro: `Supabase ${rTop.status}` });
        }
        const topicos = await rTop.json();
        const resAll  = rRes.ok ? await rRes.json() : [];
        const contagem = {};
        for (const r of resAll) {
          contagem[r.topico_id] = (contagem[r.topico_id] || 0) + 1;
        }
        const resultado = topicos.map(t => ({ ...t, total_respostas: contagem[t.id] || 0 }));
        return res.status(200).json({ topicos: resultado });
      }
    } catch (e) {
      return res.status(500).json({ erro: e.message });
    }
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (_) {}
    const { acao } = body;

    if (acao === 'criar') {
      const { topico: t } = body;
      if (!t?.titulo || !t?.autor) return res.status(400).json({ erro: 'Campos: titulo, autor' });
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/forum_topicos`, {
          method: 'POST', headers: hPost,
          body: JSON.stringify({
            titulo:    t.titulo.substring(0, 300),
            cat:       CATS_VALIDAS.includes(t.cat) ? t.cat : 'geral',
            descricao: (t.descricao || '').substring(0, 5000),
            autor:     t.autor.substring(0, 100),
            email:     (t.email || '').substring(0, 200)
          })
        });
        if (!r.ok) return res.status(500).json({ erro: `Supabase ${r.status}` });
        const [novo] = await r.json();
        return res.status(201).json({ ok: true, id: novo?.id });
      } catch (e) { return res.status(500).json({ erro: e.message }); }
    }

    if (acao === 'responder') {
      const { topico_id, texto, autor, email } = body;
      if (!topico_id || !texto || !autor) return res.status(400).json({ erro: 'Campos: topico_id, texto, autor' });
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/forum_respostas`, {
          method: 'POST', headers: { ...hPost, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            topico_id,
            texto: texto.substring(0, 5000),
            autor: autor.substring(0, 100),
            email: (email || '').substring(0, 200)
          })
        });
        if (!r.ok) return res.status(500).json({ erro: `Supabase ${r.status}` });
        return res.status(201).json({ ok: true });
      } catch (e) { return res.status(500).json({ erro: e.message }); }
    }

    if (acao === 'curtir') {
      const { topico_id } = body;
      if (!topico_id) return res.status(400).json({ erro: 'Campo: topico_id' });
      try {
        // busca curtidas atuais e incrementa
        const rGet = await fetch(`${SUPABASE_URL}/rest/v1/forum_topicos?id=eq.${topico_id}&select=curtidas`, { headers: hGet });
        if (!rGet.ok) return res.status(500).json({ erro: `Supabase ${rGet.status}` });
        const [row] = await rGet.json();
        const novas = (row?.curtidas || 0) + 1;
        const rPatch = await fetch(`${SUPABASE_URL}/rest/v1/forum_topicos?id=eq.${topico_id}`, {
          method: 'PATCH', headers: hPatch,
          body: JSON.stringify({ curtidas: novas })
        });
        if (!rPatch.ok) return res.status(500).json({ erro: `Supabase ${rPatch.status}` });
        return res.status(200).json({ ok: true, curtidas: novas });
      } catch (e) { return res.status(500).json({ erro: e.message }); }
    }

    return res.status(400).json({ erro: 'Ação inválida. Use: criar, responder, curtir' });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
