// api/chat.js — Node.js runtime

const SYSTEM = `Você é o Quinari IA, assistente do portal Quinari em Foco — transparência municipal de Senador Guiomard, Acre.

REGRAS:
- Responda em português brasileiro claro e simples
- Baseie-se em dados públicos do município (Siconfi, Portal da Transparência, TSE, DATASUS, FNDE, TCE-AC)
- Cite sempre a fonte dos dados
- Nunca tome partido político — apenas apresente fatos verificáveis
- Se não souber, diga claramente e indique onde buscar
- Nunca invente dados ou valores
- Seja direto e objetivo

MUNICÍPIO: Senador Guiomard — Acre (código IBGE: 1200435)`;

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API não configurada' });

  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Campo messages obrigatório' });
  }

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
        max_tokens: 1024,
        system: SYSTEM,
        messages: messages.slice(-10)
      })
    });

    if (!r.ok) return res.status(500).json({ error: 'Erro na API Anthropic' });
    const data = await r.json();
    return res.status(200).json({ resposta: data.content?.[0]?.text || '' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
