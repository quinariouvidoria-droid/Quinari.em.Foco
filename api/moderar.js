// api/moderar.js — Node.js runtime

const SYSTEM = `Você é um moderador de conteúdo do portal Quinari em Foco, Senador Guiomard, Acre.

Analise o texto e retorne APENAS um JSON (sem markdown):
{"aprovado":true/false,"nivel":"ok"|"atencao"|"bloqueado","motivo":null/"motivo se bloqueado","texto_limpo":"texto com palavrões censurados ou o original"}

BLOQUEAR: palavrões em excesso, discurso de ódio, ameaças, conteúdo sexual, spam.
ATENÇÃO: linguagem agressiva sem ódio explícito.
APROVAR: críticas políticas (são democracia), denúncias, sugestões, linguagem popular.
NÃO censure crítica a gestores públicos.`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ aprovado:true, nivel:'ok', motivo:null, texto_limpo:null });

  const { texto, tipo } = req.body || {};
  if (!texto) return res.status(400).json({ error: 'Campo texto obrigatório' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: SYSTEM,
        messages: [{ role:'user', content:`Tipo: ${tipo||'geral'}\nTexto: "${texto}"` }]
      })
    });
    if (!r.ok) return res.status(200).json({ aprovado:true, nivel:'ok', motivo:null, texto_limpo:null });
    const data = await r.json();
    const txt = (data.content?.[0]?.text||'{}').replace(/```json|```/g,'').trim();
    try { return res.status(200).json(JSON.parse(txt)); }
    catch { return res.status(200).json({ aprovado:true, nivel:'ok', motivo:null, texto_limpo:null }); }
  } catch {
    return res.status(200).json({ aprovado:true, nivel:'ok', motivo:null, texto_limpo:null });
  }
};
