export const config = { runtime: 'edge' };

const SYSTEM_MODERATION = `Você é um moderador de conteúdo do portal de transparência Quinari em Foco, de Senador Guiomard, Acre.

Analise o texto fornecido e retorne APENAS um JSON com a seguinte estrutura, sem nenhum texto adicional:

{
  "aprovado": true ou false,
  "nivel": "ok" | "atencao" | "bloqueado",
  "motivo": "descrição breve do motivo se reprovado, ou null se aprovado",
  "texto_limpo": "versão do texto com palavrões substituídos por *** se houver, ou o texto original"
}

REGRAS DE MODERAÇÃO:

BLOQUEAR (aprovado: false, nivel: "bloqueado"):
- Palavrões e linguagem obscena em excesso
- Discurso de ódio, racismo, homofobia, xenofobia ou qualquer discriminação
- Ameaças explícitas a pessoas ou instituições
- Conteúdo sexual explícito
- Desinformação deliberada com dados inventados apresentados como fatos
- Spam ou conteúdo completamente sem sentido
- Divulgação de dados pessoais privados de terceiros (CPF, endereço residencial, etc.)

ATENÇÃO (aprovado: true, nivel: "atencao"):
- Linguagem muito agressiva mas sem ódio explícito
- Acusações graves sem nenhuma evidência mencionada
- Conteúdo limítrofe

APROVAR (aprovado: true, nivel: "ok"):
- Críticas políticas e ao governo, mesmo que duras — isso é democracia
- Denúncias com ou sem provas — o portal avalia depois
- Opiniões sobre gestão pública, vereadores, prefeita
- Pedidos, sugestões, propostas de qualquer tipo
- Linguagem simples e popular do interior do Acre
- Gírias e expressões regionais
- Textos com poucos erros de ortografia

IMPORTANTE: Não censure crítica política. Cidadãos têm direito de criticar gestores públicos. Apenas bloqueie o que é genuinamente ofensivo ou ilegal.`;

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Se não há API key, aprovar tudo (fallback seguro)
    return new Response(JSON.stringify({
      aprovado: true,
      nivel: 'ok',
      motivo: null,
      texto_limpo: null
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 });
  }

  const { texto, tipo } = body;
  if (!texto) {
    return new Response(JSON.stringify({ error: 'Campo texto obrigatório' }), { status: 400 });
  }

  const prompt = `Tipo de conteúdo: ${tipo || 'publicação geral'}
  
Texto para moderar:
"${texto}"

Retorne apenas o JSON de moderação.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: SYSTEM_MODERATION,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      // Fallback: aprovar em caso de erro de API
      return new Response(JSON.stringify({
        aprovado: true,
        nivel: 'ok',
        motivo: null,
        texto_limpo: null
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '{}';

    let resultado;
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      resultado = JSON.parse(clean);
    } catch {
      resultado = { aprovado: true, nivel: 'ok', motivo: null, texto_limpo: null };
    }

    return new Response(JSON.stringify(resultado), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      aprovado: true, nivel: 'ok', motivo: null, texto_limpo: null
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
