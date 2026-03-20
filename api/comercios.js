// api/comercios.js — Diretório de Comércios de Senador Guiomard
// GET /api/comercios           → lista todos os comércios ativos
// GET /api/comercios?cat=X     → filtrado por categoria
// GET /api/comercios?busca=X   → busca por nome/desc
// POST /api/comercios → { acao:'cadastrar', comercio:{...} }
// POST /api/comercios → { acao:'avaliar', comercio_id, nota(1-5), comentario }
//
// Tabelas Supabase (executar no SQL Editor):
// CREATE TABLE IF NOT EXISTS comercios (
//   id bigserial primary key,
//   nome text not null,
//   cat text not null default 'outro',
//   descricao text,
//   endereco text,
//   telefone text,
//   whatsapp text,
//   instagram text,
//   horario text,
//   foto_url text,
//   ativo boolean not null default true,
//   criado_em timestamptz default now()
// );
// CREATE TABLE IF NOT EXISTS comercios_avaliacoes (
//   id bigserial primary key,
//   comercio_id bigint not null references comercios(id) on delete cascade,
//   nota smallint not null check (nota between 1 and 5),
//   comentario text,
//   criado_em timestamptz default now()
// );
// ALTER TABLE comercios ENABLE ROW LEVEL SECURITY;
// ALTER TABLE comercios_avaliacoes ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "leitura_publica_com" ON comercios FOR SELECT USING (true);
// CREATE POLICY "insercao_publica_com" ON comercios FOR INSERT WITH CHECK (true);
// CREATE POLICY "leitura_publica_av" ON comercios_avaliacoes FOR SELECT USING (true);
// CREATE POLICY "insercao_publica_av" ON comercios_avaliacoes FOR INSERT WITH CHECK (true);

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

const CATS_VALIDAS = ['alimentacao','saude','educacao','moda','eletronicos','construcao','servicos','beleza','agro','transporte','outro'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, s-maxage=120');
    try {
      let url = `${SUPABASE_URL}/rest/v1/comercios?ativo=eq.true&select=*,comercios_avaliacoes(nota)&order=nome.asc&limit=300`;
      const r = await fetch(url, { headers: hGet });
      if (!r.ok) {
        const err = await r.text();
        if (err.includes('does not exist') || err.includes('relation') || r.status === 404) {
          return res.status(200).json({ comercios: [], aviso: 'Tabela ainda não criada' });
        }
        return res.status(500).json({ erro: `Supabase ${r.status}` });
      }
      const rows = await r.json();
      // Calcular média de avaliações
      const comercios = rows.map(c => {
        const avs = c.comercios_avaliacoes || [];
        const media = avs.length ? (avs.reduce((s, a) => s + a.nota, 0) / avs.length) : null;
        const { comercios_avaliacoes: _, ...rest } = c;
        return { ...rest, media: media ? +media.toFixed(1) : null, total_avaliacoes: avs.length };
      });
      return res.status(200).json({ comercios });
    } catch (e) {
      return res.status(500).json({ erro: e.message });
    }
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (_) {}
    const { acao } = body;

    if (acao === 'cadastrar') {
      const { comercio: c } = body;
      if (!c?.nome) return res.status(400).json({ erro: 'Campo obrigatório: nome' });
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/comercios`, {
          method: 'POST', headers: hPost,
          body: JSON.stringify({
            nome:      c.nome.substring(0, 200),
            cat:       CATS_VALIDAS.includes(c.cat) ? c.cat : 'outro',
            descricao: (c.descricao || '').substring(0, 1000),
            endereco:  (c.endereco  || '').substring(0, 300),
            telefone:  (c.telefone  || '').substring(0, 50),
            whatsapp:  (c.whatsapp  || '').substring(0, 50),
            instagram: (c.instagram || '').substring(0, 100),
            horario:   (c.horario   || '').substring(0, 200),
            foto_url:  (c.foto_url  || '').substring(0, 500),
            ativo: true
          })
        });
        if (!r.ok) return res.status(500).json({ erro: `Supabase ${r.status}` });
        const [novo] = await r.json();
        return res.status(201).json({ ok: true, id: novo?.id });
      } catch (e) { return res.status(500).json({ erro: e.message }); }
    }

    if (acao === 'avaliar') {
      const { comercio_id, nota, comentario } = body;
      if (!comercio_id || !nota || nota < 1 || nota > 5) {
        return res.status(400).json({ erro: 'Campos: comercio_id, nota (1-5)' });
      }
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/comercios_avaliacoes`, {
          method: 'POST', headers: { ...hPost, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            comercio_id,
            nota: parseInt(nota),
            comentario: (comentario || '').substring(0, 500)
          })
        });
        if (!r.ok) return res.status(500).json({ erro: `Supabase ${r.status}` });
        return res.status(201).json({ ok: true });
      } catch (e) { return res.status(500).json({ erro: e.message }); }
    }

    return res.status(400).json({ erro: 'Ação inválida. Use: cadastrar, avaliar' });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
