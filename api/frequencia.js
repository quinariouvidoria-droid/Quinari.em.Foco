// api/frequencia.js — Frequência Parlamentar via Google Sheets CSV
//
// Configure a variável de ambiente no Vercel:
//   SHEETS_FREQ_URL = URL de exportação CSV da planilha
//
// Como obter a URL:
//   1. Abra a planilha no Google Sheets
//   2. Arquivo → Compartilhar → Publicar na web
//   3. Escolha a aba de frequência → Formato: CSV → Publicar
//   4. Copie o link gerado (começa com docs.google.com/spreadsheets/d/...)
//   5. Cole em SHEETS_FREQ_URL nas variáveis de ambiente do Vercel
//
// Formato esperado da planilha (qualquer ordem de colunas):
//   Vereador | Sessões Previstas | Presenças | Faltas | Justificadas | % Presença
//   (Os nomes das colunas são detectados automaticamente)

const SHEETS_URL = process.env.SHEETS_FREQ_URL;

// Apelidos para fazer o match com os nomes completos da planilha
const APELIDOS = {
  'tammy':         'Tammy Rodrigues de Paula Lima',
  'sandrão':       'Sandro Cunha e Souza',
  'sandro':        'Sandro Cunha e Souza',
  'telma':         'Telma Regina Cunha de Queiroz Silva',
  'telma queiroz': 'Telma Regina Cunha de Queiroz Silva',
  'ivanete':       'Ivanete Figueiredo de Souza',
  'leiri':         'Leyryana Conceição de Oliveira',
  'leyryana':      'Leyryana Conceição de Oliveira',
  'williene':      'Williene Magda Novais Jardim',
  'rozildo':       'Rozildo de Souza Lima',
  'rafael maia':   'João Rafael Tavares da Cruz Maia',
  'joão rafael':   'João Rafael Tavares da Cruz Maia',
  'paulinho':      'Paulo Cesar Miranda Gomes',
  'paulo cesar':   'Paulo Cesar Miranda Gomes',
  'eder paulino':  'Eder Paulino Silva Bandeira',
  'lenon':         'Elvys Lenon Nascimento Araújo',
  'elvys':         'Elvys Lenon Nascimento Araújo',
};

function normalizarNome(nome) {
  return (nome || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '').trim();
}

function matchVereador(nomeColuna) {
  const norm = normalizarNome(nomeColuna);
  // tenta match direto por apelido
  for (const [apelido, nomeCompleto] of Object.entries(APELIDOS)) {
    if (norm.includes(normalizarNome(apelido))) return nomeCompleto;
  }
  // tenta match por sobrenome
  const partes = norm.split(' ').filter(p => p.length > 3);
  for (const [apelido, nomeCompleto] of Object.entries(APELIDOS)) {
    const partesApelido = normalizarNome(apelido).split(' ');
    if (partesApelido.some(p => partes.includes(p))) return nomeCompleto;
  }
  return nomeColuna; // retorna o original se não encontrar
}

function parseCSV(texto) {
  const linhas = texto.trim().split('\n').map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
  if (linhas.length < 2) return [];

  const cabecalho = linhas[0].map(c => normalizarNome(c));

  // Detectar índices das colunas relevantes
  const iNome      = cabecalho.findIndex(c => c.includes('vereador') || c.includes('parlamentar') || c.includes('nome'));
  const iPrevistas = cabecalho.findIndex(c => c.includes('prevista') || c.includes('total') || c.includes('sessoes'));
  const iPresenca  = cabecalho.findIndex(c => c.includes('presenca') || c.includes('presencas') || c.includes('presente'));
  const iFaltas    = cabecalho.findIndex(c => c.includes('falta') || c.includes('ausente'));
  const iJust      = cabecalho.findIndex(c => c.includes('justif'));
  const iPerc      = cabecalho.findIndex(c => c.includes('%') || c.includes('percent') || c.includes('taxa'));

  if (iNome === -1) return [];

  return linhas.slice(1)
    .filter(l => l.length > 1 && l[iNome])
    .map(l => {
      const sessoesPrevistas = iPrevistas >= 0 ? parseInt(l[iPrevistas]) || 0 : 0;
      const presencas        = iPresenca  >= 0 ? parseInt(l[iPresenca])  || 0 : 0;
      const faltas           = iFaltas    >= 0 ? parseInt(l[iFaltas])    || 0 : 0;
      const justificadas     = iJust      >= 0 ? parseInt(l[iJust])      || 0 : 0;

      let percentual = 0;
      if (iPerc >= 0 && l[iPerc]) {
        percentual = parseFloat(l[iPerc].replace('%','').replace(',','.')) || 0;
      } else if (sessoesPrevistas > 0) {
        percentual = Math.round((presencas / sessoesPrevistas) * 100);
      } else if (presencas + faltas > 0) {
        percentual = Math.round((presencas / (presencas + faltas)) * 100);
      }

      return {
        nome:           l[iNome],
        nomeMatch:      matchVereador(l[iNome]),
        sessoesPrevistas,
        presencas,
        faltas,
        justificadas,
        percentual:     Math.min(100, Math.max(0, percentual)),
        _raw:           l
      };
    });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=3600'); // cache 1h

  if (!SHEETS_URL) {
    return res.status(200).json({
      configurado: false,
      aviso: 'Variável SHEETS_FREQ_URL não configurada. Adicione nas variáveis de ambiente do Vercel.',
      dados: []
    });
  }

  try {
    const r = await fetch(SHEETS_URL, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return res.status(500).json({ erro: `Google Sheets retornou ${r.status}` });

    const csv = await r.text();
    if (!csv || csv.length < 10) return res.status(500).json({ erro: 'Planilha vazia ou inacessível' });

    const dados = parseCSV(csv);
    return res.status(200).json({ configurado: true, dados, total: dados.length });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
