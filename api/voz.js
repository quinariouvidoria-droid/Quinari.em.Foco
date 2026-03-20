// api/voz.js — Voz do Povo: ideias e assinaturas
// GET /api/voz?acao=listar → retorna todas as ideias com assinaturas
// POST /api/voz → { acao:'publicar', ideia:{cat,titulo,desc,autor,email} }
// POST /api/voz → { acao:'assinar', ideia_id, nome, email }
//
// Tabelas Supabase (executar no SQL Editor):
// CREATE TABLE IF NOT EXISTS voz_ideias (
//   id text primary key,
//   cat text not null,
//   titulo text not null,
//   descricao text not null,
//   autor text not null,
//   email text not null,
//   criado_em timestamptz default now()
// );
// CREATE TABLE IF NOT EXISTS voz_assinaturas (
//   id bigserial primary key,
//   ideia_id text not null references voz_ideias(id) on delete cascade,
//   nome text not null,
//   email text not null,
//   criado_em timestamptz default now(),
//   unique(ideia_id, email)
// );
// ALTER TABLE voz_ideias ENABLE ROW LEVEL SECURITY;
// ALTER TABLE voz_assinaturas ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "leitura_publica_ideias" ON voz_ideias FOR SELECT USING (true);
// CREATE POLICY "insercao_publica_ideias" ON voz_ideias FOR INSERT WITH CHECK (true);
// CREATE POLICY "leitura_publica_sigs" ON voz_assinaturas FOR SELECT USING (true);
// CREATE POLICY "insercao_publica_sigs" ON voz_assinaturas FOR INSERT WITH CHECK (true);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6Z3p0dmlhanRjdGhxZ2VrdnJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2ODc2OTgsImV4cCI6MjA4OTI2MzY5OH0.RN3a0gfygXo9BsGZpwaVLIgbQv8AO0K6-dWF0SIazTw';

const hGet = { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}`, 'Accept': 'application/json' };
const hPost = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json', 'Accept': 'application/json', 'Prefer': 'return=minimal' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: listar ideias com contagem de assinaturas ────────────────────────
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    try {
      const [rIdeias, rSigs] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/voz_ideias?select=*&order=criado_em.desc&limit=100`, { headers: hGet }),
        fetch(`${SUPABASE_URL}/rest/v1/voz_assinaturas?select=ideia_id,nome,email,criado_em&limit=2000`, { headers: hGet })
      ]);
      if (!rIdeias.ok) {
        const err = await rIdeias.text();
        if (err.includes('does not exist') || err.includes('relation')) {
          return res.status(200).json({ ideias: [], aviso: 'Tabelas ainda não criadas' });
        }
        return res.status(500).json({ erro: `Supabase ${rIdeias.status}` });
      }
      const ideias = await rIdeias.json();
      const sigs = rSigs.ok ? await rSigs.json() : [];
      // Agregar assinaturas por ideia
      const sigsPorIdeia = {};
      for (const s of sigs) {
        if (!sigsPorIdeia[s.ideia_id]) sigsPorIdeia[s.ideia_id] = [];
        sigsPorIdeia[s.ideia_id].push({ nome: s.nome, email: s.email, data: new Date(s.criado_em).toLocaleDateString('pt-BR') });
      }
      const resultado = ideias.map(i => ({
        id: i.id, cat: i.cat, titulo: i.titulo, desc: i.descricao,
        autor: i.autor, email: i.email,
        data: new Date(i.criado_em).toLocaleDateString('pt-BR'),
        sigs: sigsPorIdeia[i.id] || []
      }));
      return res.status(200).json({ ideias: resultado });
    } catch (e) {
      return res.status(500).json({ erro: e.message });
    }
  }

  // ── POST: publicar ideia ou assinar ──────────────────────────────────────
  if (req.method === 'POST') {
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (_) {}
    const { acao } = body;

    if (acao === 'publicar') {
      const { ideia } = body;
      if (!ideia?.titulo || !ideia?.desc || !ideia?.autor) {
        return res.status(400).json({ erro: 'Campos obrigatórios: titulo, desc, autor' });
      }
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/voz_ideias`, {
          method: 'POST', headers: hPost,
          body: JSON.stringify({
            id: ideia.id || ('i' + Date.now()),
            cat: ideia.cat || 'geral',
            titulo: ideia.titulo.substring(0, 200),
            descricao: ideia.desc.substring(0, 2000),
            autor: ideia.autor.substring(0, 100),
            email: (ideia.email || '').substring(0, 200)
          })
        });
        if (!r.ok) return res.status(500).json({ erro: `Supabase ${r.status}` });
        // Adicionar assinatura automática do autor
        await fetch(`${SUPABASE_URL}/rest/v1/voz_assinaturas`, {
          method: 'POST', headers: hPost,
          body: JSON.stringify({ ideia_id: ideia.id, nome: ideia.autor, email: ideia.email || '' })
        });
        return res.status(201).json({ ok: true });
      } catch (e) { return res.status(500).json({ erro: e.message }); }
    }

    if (acao === 'assinar') {
      const { ideia_id, nome, email } = body;
      if (!ideia_id || !nome) return res.status(400).json({ erro: 'Campos: ideia_id, nome' });
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/voz_assinaturas`, {
          method: 'POST', headers: { ...hPost, 'Prefer': 'return=minimal,resolution=ignore-duplicates' },
          body: JSON.stringify({ ideia_id, nome: nome.substring(0,100), email: (email||'').substring(0,200) })
        });
        if (!r.ok && r.status !== 409) return res.status(500).json({ erro: `Supabase ${r.status}` });
        return res.status(201).json({ ok: true });
      } catch (e) { return res.status(500).json({ erro: e.message }); }
    }

    return res.status(400).json({ erro: 'Ação desconhecida. Use: publicar, assinar' });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
