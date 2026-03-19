// api/admin-patrocinadores.js
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;

async function isAdmin(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.replace('Bearer ', '');
  const res = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': process.env.SUPABASE_ANON_KEY || SUPA_KEY }
  });
  if (!res.ok) return false;
  const user = await res.json();
  if (!user?.email) return false;
  const check = await fetch(
    `${SUPA_URL}/rest/v1/admins?email=eq.${encodeURIComponent(user.email)}&select=email`,
    { headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` } }
  );
  const admins = await check.json();
  return Array.isArray(admins) && admins.length > 0;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const h = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

  if (req.method === 'GET') {
    const r = await fetch(`${SUPA_URL}/rest/v1/patrocinadores?order=posicao.asc`, { headers: h });
    return res.status(200).json(await r.json());
  }

  const admin = await isAdmin(req.headers['authorization']);
  if (!admin) return res.status(401).json({ erro: 'Não autorizado.' });

  if (req.method === 'POST') {
    const body = req.body;
    if (body.id) {
      const r = await fetch(`${SUPA_URL}/rest/v1/patrocinadores?id=eq.${body.id}`,
        { method: 'PATCH', headers: { ...h, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ ...body, atualizado_em: new Date().toISOString() }) });
      return res.status(r.ok ? 200 : 400).json({ ok: r.ok });
    }
    const r = await fetch(`${SUPA_URL}/rest/v1/patrocinadores`,
      { method: 'POST', headers: { ...h, 'Prefer': 'return=representation' }, body: JSON.stringify(body) });
    return res.status(r.ok ? 201 : 400).json(await r.json());
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ erro: 'ID obrigatório' });
    const r = await fetch(`${SUPA_URL}/rest/v1/patrocinadores?id=eq.${id}`,
      { method: 'PATCH', headers: { ...h, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ ativo: false, nome: 'Vaga disponível', logo_url: null, whatsapp: null, link_externo: null }) });
    return res.status(r.ok ? 200 : 400).json({ ok: r.ok });
  }

  return res.status(405).json({ erro: 'Método não permitido' });
}
