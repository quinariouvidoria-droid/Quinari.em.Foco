// api/frequencia.js — Frequência Parlamentar via Google Sheets da Câmara
//
// Lê automaticamente as planilhas públicas da Câmara Municipal de Senador Guiomard:
//   2026: https://docs.google.com/spreadsheets/d/17yV6lYMlycmheq1CADwjdZAEmFX5WqbBGx72f6CgFdQ
//   2025: https://docs.google.com/spreadsheets/d/1O4jCj924S_ZHxmW-YeMKB9tHffDAm8ciqAjwu8PG5dY
//
// Formato real da planilha (colunas horizontais por vereador):
//   Sessão | Mês | Data | Hora | Tipo de Sessão | Local | [Vereador 1] | [Vereador 2] | ...
//   Cada célula de vereador contém "P" (presente) ou outro valor (falta)
//
// SHEETS_FREQ_URL (opcional): variável de ambiente para substituir por outra planilha

const SHEETS_2026 = 'https://docs.google.com/spreadsheets/d/17yV6lYMlycmheq1CADwjdZAEmFX5WqbBGx72f6CgFdQ/gviz/tq?tqx=out:csv';
const SHEETS_2025 = 'https://docs.google.com/spreadsheets/d/1O4jCj924S_ZHxmW-YeMKB9tHffDAm8ciqAjwu8PG5dY/gviz/tq?tqx=out:csv';

// Nomes completos canônicos dos vereadores
const NOMES_COMPLETOS = [
  'Williene Magda Novais Jardim',
  'Telma Regina Cunha de Queiroz Silva',
  'Tammy Rodrigues de Paula Lima',
  'Sandro Cunha e Souza',
  'Ivanete Figueiredo de Souza',
  'Leyryana Conceição de Oliveira',
  'Rozildo de Souza Lima',
  'João Rafael Tavares da Cruz Maia',
  'Paulo Cesar Miranda Gomes',
  'Eder Paulino Silva Bandeira',
  'Elvys Lenon Nascimento Araújo',
];

// Fragmentos que identificam cada vereador no cabeçalho da planilha
const FRAGMENTOS = {
  'williene':   'Williene Magda Novais Jardim',
  'telma':      'Telma Regina Cunha de Queiroz Silva',
  'tammy':      'Tammy Rodrigues de Paula Lima',
  'sandro':     'Sandro Cunha e Souza',
  'sandrão':    'Sandro Cunha e Souza',
  'ivanete':    'Ivanete Figueiredo de Souza',
  'leyryana':   'Leyryana Conceição de Oliveira',
  'leiri':      'Leyryana Conceição de Oliveira',
  'rozildo':    'Rozildo de Souza Lima',
  'rafael':     'João Rafael Tavares da Cruz Maia',
  'joão rafael':'João Rafael Tavares da Cruz Maia',
  'paulinho':   'Paulo Cesar Miranda Gomes',
  'paulo cesar':'Paulo Cesar Miranda Gomes',
  'eder':       'Eder Paulino Silva Bandeira',
  'lenon':      'Elvys Lenon Nascimento Araújo',
  'elvys':      'Elvys Lenon Nascimento Araújo',
};

function normalizar(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function identificarVereador(colunaHeader) {
  const norm = normalizar(colunaHeader);
  // Tenta cada fragmento conhecido
  for (const [frag, nomeCompleto] of Object.entries(FRAGMENTOS)) {
    if (norm.includes(normalizar(frag))) return nomeCompleto;
  }
  return null;
}

// Parser CSV correto — respeita campos entre aspas (inclusive vírgulas internas)
function parsearLinhaCSV(linha) {
  const campos = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (aspas && linha[i + 1] === '"') { campo += '"'; i++; }
      else aspas = !aspas;
    } else if (c === ',' && !aspas) {
      campos.push(campo.trim());
      campo = '';
    } else {
      campo += c;
    }
  }
  campos.push(campo.trim());
  return campos;
}

function parsearCSV(texto) {
  return texto.trim().split('\n').map(parsearLinhaCSV);
}

// Lê planilha horizontal: colunas = vereadores, linhas = sessões
function processarPlanilha(texto, ano) {
  const linhas = parsearCSV(texto);
  if (linhas.length < 2) return null;

  const cabecalho = linhas[0];

  // Mapear quais colunas correspondem a vereadores conhecidos
  const colsVereador = []; // [{idx, nome}]
  for (let i = 0; i < cabecalho.length; i++) {
    const nome = identificarVereador(cabecalho[i]);
    if (nome) {
      // Evitar duplicatas (mesmo vereador pode aparecer em col diferente — pega a primeira)
      if (!colsVereador.find(c => c.nome === nome)) {
        colsVereador.push({ idx: i, nome, coluna: cabecalho[i] });
      }
    }
  }

  if (colsVereador.length === 0) return null;

  // Inicializar contadores
  const contagem = {};
  for (const cv of colsVereador) {
    contagem[cv.nome] = { presencas: 0, faltas: 0 };
  }

  let totalSessoes = 0;
  const sessoes = [];

  for (const linha of linhas.slice(1)) {
    // Linha válida: tem valor na primeira coluna (número/nome da sessão) e uma data
    const primCol = (linha[0] || '').trim();
    const dataCol = (linha[2] || '').trim();
    if (!primCol || !dataCol) continue;

    totalSessoes++;
    const tipo  = (linha[4] || '').trim();
    const data  = dataCol;
    const sessaoInfo = { sessao: primCol, data, tipo, presentes: [] };

    for (const cv of colsVereador) {
      const val = (linha[cv.idx] || '').trim().toUpperCase();
      if (val === 'P') {
        contagem[cv.nome].presencas++;
        sessaoInfo.presentes.push(cv.nome);
      } else {
        // Conta como falta apenas se a célula não está em branco
        // (células vazias = sessão ainda não realizada)
        if (val !== '') contagem[cv.nome].faltas++;
      }
    }
    sessoes.push(sessaoInfo);
  }

  const dados = colsVereador.map(cv => {
    const c = contagem[cv.nome];
    const realizadas = c.presencas + c.faltas;
    const percentual = realizadas > 0
      ? Math.round((c.presencas / realizadas) * 100)
      : 0;
    return {
      nome:            cv.nome,
      nomeMatch:       cv.nome,
      sessoesPrevistas: totalSessoes,
      sessoesRealizadas: realizadas,
      presencas:       c.presencas,
      faltas:          c.faltas,
      justificadas:    0,
      percentual:      Math.min(100, Math.max(0, percentual)),
    };
  });

  return { dados, totalSessoes, sessoesComDados: sessoes.length, ano };
}

async function buscarPlanilha(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const texto = await r.text();
  if (!texto || texto.length < 20) throw new Error('Planilha vazia');
  return texto;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=3600'); // cache 1h

  const anoAtual = new Date().getFullYear();

  // Prioridade: env var → planilha do ano atual → planilha do ano anterior
  const urlOverride = process.env.SHEETS_FREQ_URL;

  const tentativas = urlOverride
    ? [{ url: urlOverride, ano: anoAtual }]
    : [
        { url: SHEETS_2026, ano: 2026 },
        { url: SHEETS_2025, ano: 2025 },
      ];

  let resultado = null;
  let erros = [];

  for (const { url, ano } of tentativas) {
    try {
      const texto = await buscarPlanilha(url);
      resultado = processarPlanilha(texto, ano);
      if (resultado && resultado.dados.length > 0) break;
    } catch (e) {
      erros.push(`${ano}: ${e.message}`);
    }
  }

  if (!resultado || resultado.dados.length === 0) {
    return res.status(200).json({
      configurado: true,
      fonte: 'Google Sheets da Câmara Municipal',
      aviso: 'Não foi possível carregar dados de frequência. ' + erros.join('; '),
      dados: [],
      total: 0,
    });
  }

  return res.status(200).json({
    configurado: true,
    fonte: 'Google Sheets da Câmara Municipal',
    ano: resultado.ano,
    totalSessoes: resultado.totalSessoes,
    sessoesRealizadas: resultado.sessoesComDados,
    dados: resultado.dados,
    total: resultado.dados.length,
  });
}
