// api/orcamento.js — Receitas e Despesas Anuais via SICONFI
//
// Fonte: Sistema de Informações Contábeis e Fiscais do Setor Público Brasileiro
// URL: https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo
// IBGE Senador Guiomard: 1200450
//
// Estrutura do RREO (confirmada para Senador Guiomard):
//   Anexo 01 (Receitas):
//     - cod_conta: "ReceitasExcetoIntraOrcamentarias"
//     - coluna "Até o Bimestre (c)" → total arrecadado no ano
//     - coluna "PREVISÃO ATUALIZADA (a)" → orçado atualizado
//   Anexo 02 (Despesas):
//     - conta: "TOTAL (III) = (I + II)" → total geral
//     - conta: "DESPESAS (EXCETO INTRA-ORÇAMENTÁRIAS) (I)" → subtotal
//     - coluna "DESPESAS LIQUIDADAS ATÉ O BIMESTRE (d)" → liquidado no ano

const IBGE = '1200450';

function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim();
}

async function buscarRREO(ano, numeroAnexo) {
  const anexo = String(numeroAnexo).padStart(2, '0');
  const anoAtual = new Date().getFullYear();
  // Para o ano atual, começa pelo bimestre mais recente possível
  const mesAtual = new Date().getMonth() + 1; // 1-12
  const bimAtual = Math.min(Math.ceil(mesAtual / 2), 6);
  const maxBim = (parseInt(ano) === anoAtual) ? bimAtual : 6;

  for (let bim = maxBim; bim >= 1; bim--) {
    try {
      const url = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo` +
        `?an_exercicio=${ano}&nr_periodo=${bim}&co_tipo_demonstrativo=RREO` +
        `&no_anexo=RREO-Anexo%20${anexo}&id_ente=${IBGE}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
      if (!r.ok) continue;
      const d = await r.json();
      const itens = d.items || [];
      if (itens.length > 0) return { itens, bimestre: bim };
    } catch (e) { /* tenta próximo bimestre */ }
  }
  return { itens: [], bimestre: 0 };
}

function extrairReceitas(itens) {
  // Busca o row de receitas principais: cod_conta "ReceitasExcetoIntraOrcamentarias"
  // ou o primeiro row com valores substanciais
  let realizadas = 0;
  let orcado = 0;

  for (const item of itens) {
    const codConta = item.cod_conta || '';
    const coluna   = norm(item.coluna || '');
    const val      = parseFloat(item.valor) || 0;

    // Total arrecadado: linha principal + coluna "Até o Bimestre"
    const isLinhaPrincipal = codConta === 'ReceitasExcetoIntraOrcamentarias';
    const isColAte = coluna.includes('ate o bimestre') || coluna === 'ate o bimestre (c)';

    if (isLinhaPrincipal && isColAte && val > realizadas) {
      realizadas = val;
    }

    // Previsão atualizada (orçado)
    const isColOrcado = coluna.includes('previsao atualizada') || coluna.includes('previsão atualizada') ||
      (coluna.includes('previsao') && coluna.includes('inicial'));
    if (isLinhaPrincipal && isColOrcado && val > orcado) {
      orcado = val;
    }
  }

  // Fallback: se não encontrou pela cod_conta, pega o maior valor em "Até o Bimestre"
  if (realizadas === 0) {
    for (const item of itens) {
      const coluna = norm(item.coluna || '');
      const val = parseFloat(item.valor) || 0;
      if ((coluna.includes('ate o bimestre') || coluna === 'ate o bimestre (c)') && val > realizadas) {
        realizadas = val;
      }
    }
  }
  if (orcado === 0) {
    for (const item of itens) {
      const coluna = norm(item.coluna || '');
      const val = parseFloat(item.valor) || 0;
      if (coluna.includes('previsao') && val > orcado) {
        orcado = val;
      }
    }
  }

  return { realizadas, orcado };
}

function extrairDespesas(itens) {
  // Busca o row "TOTAL (III) = (I + II)" ou "DESPESAS (EXCETO INTRA-ORÇAMENTÁRIAS)"
  // com coluna de liquidadas até o bimestre
  let liquidadas = 0;
  let empenhadas = 0;
  let dotacao = 0;

  const isTotalRow = (conta) => {
    const n = norm(conta);
    return n.includes('total (iii)') || n.includes('total (i + ii)') ||
      (n.includes('total') && (n.includes('iii') || n.includes('i + ii')));
  };
  const isExcetoIntraRow = (conta) => {
    const n = norm(conta);
    return n.includes('exceto intra') || n.includes('exceto intra-orcamentaria');
  };

  // Prioridade: total (III) > exceto intra > maior valor
  for (const item of itens) {
    const conta  = item.conta || '';
    const coluna = norm(item.coluna || '');
    const val    = parseFloat(item.valor) || 0;

    const ehTotal = isTotalRow(conta);
    const ehIntra = !ehTotal && isExcetoIntraRow(conta);

    // Liquidadas
    const isColLiq = coluna.includes('liquidadas ate') || coluna.includes('liquidadas até') ||
      coluna.includes('despesas liquidadas') && coluna.includes('bimestre');
    if (isColLiq && val > 0) {
      if (ehTotal && val > liquidadas) liquidadas = val;
      else if (ehIntra && liquidadas === 0 && val > 0) liquidadas = val;
    }

    // Empenhadas
    const isColEmp = coluna.includes('empenhadas ate') || coluna.includes('empenhadas até') ||
      coluna.includes('despesas empenhadas') && coluna.includes('bimestre');
    if (isColEmp && val > 0) {
      if (ehTotal && val > empenhadas) empenhadas = val;
      else if (ehIntra && empenhadas === 0) empenhadas = val;
    }

    // Dotação
    const isColDot = coluna.includes('dotacao inicial') || coluna.includes('dotação inicial') ||
      coluna === 'dotacao inicial';
    if (isColDot && val > 0) {
      if (ehTotal && val > dotacao) dotacao = val;
      else if (ehIntra && dotacao === 0) dotacao = val;
    }
  }

  // Fallback: maior valor encontrado nas colunas certas
  if (liquidadas === 0) {
    for (const item of itens) {
      const coluna = norm(item.coluna || '');
      const val = parseFloat(item.valor) || 0;
      if (coluna.includes('liquidadas') && coluna.includes('bimestre') && val > liquidadas) {
        liquidadas = val;
      }
    }
  }

  return { liquidadas, empenhadas, dotacao };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=3600'); // cache 1h

  const anoAtual = new Date().getFullYear();
  // Últimos 4 anos + ano atual
  const anos = [];
  for (let a = anoAtual - 3; a <= anoAtual; a++) anos.push(a);

  // Busca todos os anos em paralelo (Anexo 01 e 02 simultâneos por ano)
  const resultados = await Promise.all(anos.map(async (ano) => {
    const [recObj, despObj] = await Promise.all([
      buscarRREO(ano, 1),
      buscarRREO(ano, 2),
    ]);

    const { realizadas, orcado } = extrairReceitas(recObj.itens);
    const { liquidadas, empenhadas, dotacao } = extrairDespesas(despObj.itens);

    const saldo = realizadas - liquidadas;
    const percExec = orcado > 0 ? Math.round((realizadas / orcado) * 100) : 0;

    return {
      ano,
      receitas_orcadas:    Math.round(orcado),
      receitas_realizadas: Math.round(realizadas),
      despesas_dotacao:    Math.round(dotacao),
      despesas_empenhadas: Math.round(empenhadas),
      despesas_liquidadas: Math.round(liquidadas),
      saldo:               Math.round(saldo),
      perc_exec_receitas:  percExec,
      bimestre_receitas:   recObj.bimestre,
      bimestre_despesas:   despObj.bimestre,
      parcial:             recObj.bimestre < 6,
    };
  }));

  const validos = resultados.filter(r => r.receitas_realizadas > 0 || r.despesas_liquidadas > 0);

  return res.status(200).json({
    municipio:   'Senador Guiomard',
    uf:          'AC',
    ibge:        IBGE,
    fonte:       'SICONFI — Tesouro Nacional',
    atualizadoEm: new Date().toISOString(),
    anos:        validos,
  });
}
