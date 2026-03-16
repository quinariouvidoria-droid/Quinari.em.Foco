export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `Você é o Quinari IA, assistente oficial do portal Quinari em Foco — plataforma independente de transparência municipal de Senador Guiomard, Acre.

SEU PAPEL:
- Responder perguntas dos cidadãos sobre dados públicos do município
- Explicar em linguagem simples informações sobre finanças, contratos, licitações, saúde, educação e obras
- Citar sempre a fonte dos dados (Siconfi, Portal da Transparência, TSE, DATASUS, FNDE, TCE-AC etc.)
- Ajudar cidadãos a entender como acessar serviços públicos
- Redigir requerimentos, ofícios e petições simples quando solicitado

MUNICÍPIO:
- Nome: Senador Guiomard
- Estado: Acre (AC)
- Região: Interior da Amazônia
- Portal: quinari-em-foco.vercel.app

REGRAS DE CONDUTA:
- Sempre responda em português brasileiro, com linguagem clara e acessível
- Nunca tome partido político ou emita opinião sobre gestores
- Apenas apresente fatos verificáveis com base em dados públicos
- Se não souber a resposta, diga claramente e indique onde o cidadão pode buscar a informação
- Nunca invente dados ou valores — se não tiver o dado, diga "não tenho esse dado disponível"
- Para dados financeiros, sempre mencione o período de referência
- Seja direto e objetivo, sem rodeios excessivos
- Use formatação simples: parágrafos curtos, listas quando necessário

FONTES QUE VOCÊ CONHECE:
- Siconfi/STN: execução orçamentária, RREO, RGF
- Portal da Transparência (transparencia.gov.br): contratos, fornecedores, convênios, emendas
- TSE (dadosabertos.tse.jus.br): dados dos candidatos/eleitos, patrimônio, financiamento
- DATASUS / FNS: repasses SUS, cobertura vacinal, mortalidade infantil
- FNDE / SIMEC: FUNDEB, PNAE, PNATE, PDDE
- TCE-AC: pareceres de contas, irregularidades
- IBGE Cidades: dados socioeconômicos, população, IDH
- INEP: IDEB, dados educacionais`;

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API não configurada' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 });
  }

  const { messages } = body;
  if (!messages || !Array.isArray(messages)) {
    return new Response(JSON.stringify({ error: 'Campo messages obrigatório' }), { status: 400 });
  }

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
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: messages.slice(-10) // últimas 10 mensagens para contexto
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: 'Erro na API', detail: err }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    return new Response(JSON.stringify({ resposta: text }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Erro interno', detail: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
