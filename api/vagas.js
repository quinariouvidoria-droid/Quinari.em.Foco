// api/vagas.js — Vagas de Emprego de Senador Guiomard
// GET /api/vagas             → lista todas as vagas abertas
// GET /api/vagas?id=123      → detalhe de uma vaga
// POST /api/vagas → { acao:'publicar', vaga:{titulo,empresa,cat,local,tipo,salario,descricao,contato,email,telefone} }
// POST /api/vagas → { acao:'candidatar', vaga_id, nome, email, telefone, mensagem }
// POST /api/vagas → { acao:'encerrar', vaga_id, email } (encerra vaga pelo email do anunciante)
//
// Tabelas Supabase (executar no SQL Editor):
// CREATE TABLE IF NOT EXISTS vagas_emprego (
//   id bigserial primary key,
//   titulo text not null,
//   empresa text not null,
//   cat text not null default 'outro',
//   local text,
//   tipo text not null default 'clt',
//   salario text,
//   descricao text,
//   contato text,
//   email text,
//   telefone text,
//   ativa boolean not null default true,
//   criado_em timestamptz default now()
// );
// CREATE TABLE IF NOT EXISTS vagas_candidaturas (
//   id bigserial primary key,
//   vaga_id bigint not null references vagas_emprego(id) on delete cascade,
//   nome text not null,
//   email text not null,
//   telefone text,
//   mensagem text,
//   criado_em timestamptz default now(),
//   unique(vaga_id, email)
// );
// ALTER TABLE vagas_emprego ENABLE ROW LEVEL SECURITY;
// ALTER TABLE vagas_candidaturas ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "leitura_publica_vagas" ON vagas_emprego FOR SELECT USING (true);
// CREATE POLICY "insercao_publica_vagas" ON vagas_emprego FOR INSERT WITH CHECK (true);
// CREATE POLICY "update_publica_vagas" ON vagas_emprego FOR UPDATE USING (true);
// CREATE POLICY "leitura_publica_cand" ON vagas_candidaturas FOR SELECT USING (true);
// CREATE POLICY "insercao_publica_cand" ON vagas_candidaturas FOR INSERT WITH CHECK (true);

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

const CATS_VALIDAS = ['comercio','industria','servicos','saude','educacao','construcao','tecnologia','agro','publico','outro'];
const TIPOS_VALIDOS = ['clt','pj','temporario','estagio','autonomo','outro'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    const { id } = req.query;
    try {
      let url;
      if (id) {
        url = `${SUPABASE_URL}/rest/v1/vagas_emprego?id=eq.${encodeURIComponent(id)}&select=*`;
      } else {
        url = `${SUPABASE_URL}/rest/v1/vagas_emprego?ativa=eq.true&select=*&order=criado_em.desc&limit=100`;
      }
      const r = await fetch(url, { headers: hGet });
      if (!r.ok) {
        const err = await r.text();
        if (err.includes('does not exist') || err.includes('relation') || r.status === 404) {
          return res.status(200).json({ vagas: [], aviso: 'Tabela ainda não criada' });
        }
        return res.status(500).json({ erro: `Supabase ${r.status}` });
      }
      const vagas = await r.json();
      return res.status(200).json({ vagas });
    } catch (e) {
      return res.status(500).json({ erro: e.message });
    }
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch (_) {}
    const { acao } = body;

    // ── publicar vaga
    if (acao === 'publicar') {
      const { vaga } = body;
      if (!vaga?.titulo || !vaga?.empresa) {
        return res.status(400).json({ erro: 'Campos obrigatórios: titulo, empresa' });
      }
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/vagas_emprego`, {
          method: 'POST', headers: hPost,
          body: JSON.stringify({
            titulo:    vaga.titulo.substring(0, 200),
            empresa:   vaga.empresa.substring(0, 200),
            cat:       CATS_VALIDAS.includes(vaga.cat) ? vaga.cat : 'outro',
            local:     (vaga.local  || '').substring(0, 200),
            tipo:      TIPOS_VALIDOS.includes(vaga.tipo) ? vaga.tipo : 'outro',
            salario:   (vaga.salario   || '').substring(0, 100),
            descricao: (vaga.descricao || '').substring(0, 3000),
            contato:   (vaga.contato   || '').substring(0, 200),
            email:     (vaga.email     || '').substring(0, 200),
            telefone:  (vaga.telefone  || '').substring(0, 50),
            ativa: true
          })
        });
        if (!r.ok) return res.status(500).json({ erro: `Supabase ${r.status}` });
        const [nova] = await r.json();
        return res.status(201).json({ ok: true, id: nova?.id });
      } catch (e) { return res.status(500).json({ erro: e.message }); }
    }

    // ── candidatar-se
    if (acao === 'candidatar') {
      const { vaga_id, nome, email, telefone, mensagem } = body;
      if (!vaga_id || !nome || !email) {
        return res.status(400).json({ erro: 'Campos: vaga_id, nome, email' });
      }
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/vagas_candidaturas`, {
          method: 'POST',
          headers: { ...hPost, 'Prefer': 'return=minimal,resolution=ignore-duplicates' },
          body: JSON.stringify({
            vaga_id,
            nome: nome.substring(0, 200),
            email: email.substring(0, 200),
            telefone: (telefone || '').substring(0, 50),
            mensagem: (mensagem || '').substring(0, 1000)
          })
        });
        if (!r.ok && r.status !== 409) return res.status(500).json({ erro: `Supabase ${r.status}` });
        return res.status(201).json({ ok: true });
      } catch (e) { return res.status(500).json({ erro: e.message }); }
    }

    // ── encerrar vaga (por email do anunciante)
    if (acao === 'encerrar') {
      const { vaga_id, email } = body;
      if (!vaga_id || !email) return res.status(400).json({ erro: 'Campos: vaga_id, email' });
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/vagas_emprego?id=eq.${encodeURIComponent(vaga_id)}&email=eq.${encodeURIComponent(email)}`, {
          method: 'PATCH',
          headers: { ...hPost, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ ativa: false })
        });
        if (!r.ok) return res.status(500).json({ erro: `Supabase ${r.status}` });
        return res.status(200).json({ ok: true });
      } catch (e) { return res.status(500).json({ erro: e.message }); }
    }

    return res.status(400).json({ erro: 'Ação inválida. Use: publicar, candidatar, encerrar' });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
