// api/coletar.js
// Função de coleta automática de dados públicos
// Disparada todo dia às 06h pelo Vercel Cron
// Fontes: Siconfi/STN, Portal da Transparência, TSE, DATASUS, FNDE

export const config = { runtime: 'edge', maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const IBGE_COD    = '1200435'; // Senador Guiomard - AC
const ANO_ATUAL   = new Date().getFullYear();

// ── Helper: salvar no Supabase ──────────────────────────────
async function supabaseUpsert(tabela, dados, conflito = null) {
  const url = `${SUPABASE_URL}/rest/v1/${tabela}`;
  const opts = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': conflito
        ? `resolution=merge-duplicates,return=minimal`
        : 'return=minimal'
    },
    body: JSON.stringify(dados)
  };
  if (conflito) opts.headers['Prefer'] = 'resolution=merge-duplicates,return=minimal';
  const res = await fetch(url, opts);
  return res.ok;
}

async function supabaseDelete(tabela, filtro) {
  const url = `${SUPABASE_URL}/rest/v1/${tabela}?${filtro}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  return res.ok;
}

async function log(fonte, status, registros, mensagem) {
  await supabaseUpsert('log_coleta', {
    fonte, status,
    registros_inseridos: registros,
    mensagem,
    executado_em: new Date().toISOString()
  });
}

// ── 1. SICONFI — Receitas e Despesas (RREO) ─────────────────
async function coletarSiconfi() {
  const resultados = { receitas: 0, despesas: 0, orcamento: 0 };

  try {
    // Busca o RREO mais recente (tenta bimestres de 6 a 1)
    let rreoData = null;
    let bimestreAtual = 0;

    for (let bim = 6; bim >= 1; bim--) {
      const url = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?` +
        `an_exercicio=${ANO_ATUAL}&nr_periodo=${bim}&` +
        `co_tipo_demonstrativo=RREO&co_municipio=${IBGE_COD}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          rreoData = data.items;
          bimestreAtual = bim;
          break;
        }
      }
    }

    if (!rreoData || rreoData.length === 0) {
      await log('Siconfi/RREO', 'parcial', 0, 'Nenhum dado RREO encontrado para o ano atual');
      return resultados;
    }

    // Processa receitas
    const receitasMap = {};
    const despesasMap = {};
    let receitaTotal = 0, receitaPrevista = 0;
    let despesaTotal = 0, despesaAutorizada = 0;

    for (const item of rreoData) {
      const conta = item.no_conta || '';
      const valor = parseFloat(item.vl_valor || 0);

      // Identifica receitas
      if (conta.includes('RECEITA')) {
        if (conta.includes('FPM') || conta.includes('PARTICIPAÇÃO DOS MUNICÍPIOS')) {
          receitasMap['FPM — Fundo de Participação dos Municípios'] = {
            categoria: 'constitucional',
            arrecadado: (receitasMap['FPM'] || 0) + valor
          };
        } else if (conta.includes('FUNDEB')) {
          receitasMap['FUNDEB'] = {
            categoria: 'educacao',
            arrecadado: (receitasMap['FUNDEB']?.arrecadado || 0) + valor
          };
        } else if (conta.includes('SUS') || conta.includes('SAÚDE')) {
          receitasMap['SUS — Repasses do Ministério da Saúde'] = {
            categoria: 'saude',
            arrecadado: (receitasMap['SUS']?.arrecadado || 0) + valor
          };
        } else if (conta.includes('ICMS')) {
          receitasMap['ICMS-Cota Parte (Estado)'] = {
            categoria: 'constitucional',
            arrecadado: (receitasMap['ICMS']?.arrecadado || 0) + valor
          };
        } else if (conta.includes('ISS')) {
          receitasMap['ISS — Imposto Sobre Serviços'] = {
            categoria: 'propria',
            arrecadado: (receitasMap['ISS']?.arrecadado || 0) + valor
          };
        } else if (conta.includes('IPTU')) {
          receitasMap['IPTU'] = {
            categoria: 'propria',
            arrecadado: (receitasMap['IPTU']?.arrecadado || 0) + valor
          };
        }

        if (item.co_tipo_valor === 'Arrecadado') receitaTotal += valor;
        if (item.co_tipo_valor === 'Previsto') receitaPrevista += valor;
      }

      // Identifica despesas por função
      if (item.co_funcao) {
        const funcMap = {
          '04': 'Administração',
          '10': 'Saúde',
          '12': 'Educação',
          '08': 'Assistência Social',
          '15': 'Urbanismo / Obras',
          '26': 'Transporte',
          '20': 'Agricultura',
          '18': 'Gestão Ambiental',
          '27': 'Desporto e Lazer',
          '01': 'Legislativo'
        };
        const funcNome = funcMap[item.co_funcao] || `Função ${item.co_funcao}`;
        if (!despesasMap[funcNome]) despesasMap[funcNome] = { dot: 0, emp: 0, liq: 0, pago: 0 };

        if (item.co_tipo_valor === 'Dotação Inicial') despesasMap[funcNome].dot += valor;
        if (item.co_tipo_valor === 'Empenhado') { despesasMap[funcNome].emp += valor; despesaTotal += valor; }
        if (item.co_tipo_valor === 'Liquidado') despesasMap[funcNome].liq += valor;
        if (item.co_tipo_valor === 'Pago') despesasMap[funcNome].pago += valor;
        if (item.co_tipo_valor === 'Dotação Inicial') despesaAutorizada += valor;
      }
    }

    // Salva receitas
    await supabaseDelete('receitas', `ano=eq.${ANO_ATUAL}&periodo=eq.${bimestreAtual}`);
    const recRows = Object.entries(receitasMap).map(([nome, d]) => ({
      ano: ANO_ATUAL,
      periodo: bimestreAtual,
      nome,
      categoria: d.categoria,
      previsto: d.previsto || d.arrecadado * 1.05,
      arrecadado: d.arrecadado,
      fonte: 'Siconfi/STN',
      atualizado_em: new Date().toISOString()
    }));
    if (recRows.length > 0) {
      await supabaseUpsert('receitas', recRows);
      resultados.receitas = recRows.length;
    }

    // Salva despesas
    await supabaseDelete('despesas', `ano=eq.${ANO_ATUAL}&periodo=eq.${bimestreAtual}`);
    const despRows = Object.entries(despesasMap).map(([funcao, d]) => ({
      ano: ANO_ATUAL,
      periodo: bimestreAtual,
      funcao,
      dotacao: d.dot,
      empenhado: d.emp,
      liquidado: d.liq,
      pago: d.pago,
      fonte: 'Siconfi/STN',
      atualizado_em: new Date().toISOString()
    }));
    if (despRows.length > 0) {
      await supabaseUpsert('despesas', despRows);
      resultados.despesas = despRows.length;
    }

    // Salva execução orçamentária bimestral
    await supabaseUpsert('orcamento_bimestral', [{
      ano: ANO_ATUAL,
      bimestre: bimestreAtual,
      receita_prevista: receitaPrevista,
      receita_realizada: receitaTotal,
      despesa_autorizada: despesaAutorizada,
      despesa_executada: despesaTotal,
      resultado: despesaTotal > receitaTotal ? 'deficit' :
                 Math.abs(despesaTotal - receitaTotal) < receitaTotal * 0.02 ? 'equilibrado' : 'superavit',
      fonte: 'Siconfi/STN',
      atualizado_em: new Date().toISOString()
    }], 'ano,bimestre');
    resultados.orcamento = 1;

    await log('Siconfi/STN', 'sucesso',
      resultados.receitas + resultados.despesas,
      `Bimestre ${bimestreAtual}/${ANO_ATUAL} — ${resultados.receitas} receitas, ${resultados.despesas} despesas`);

  } catch (err) {
    await log('Siconfi/STN', 'erro', 0, err.message);
  }

  return resultados;
}

// ── 2. PORTAL DA TRANSPARÊNCIA — Fornecedores ──────────────
async function coletarFornecedores() {
  let total = 0;
  try {
    // API do Portal da Transparência — contratos por município
    // Nota: requer cadastro para volume alto, mas funciona sem chave para consultas básicas
    const url = `https://api.portaldatransparencia.gov.br/api-de-dados/contratos?` +
      `municipioContratado=${IBGE_COD}&pagina=1&quantidade=20`;

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });

    if (res.ok) {
      const dados = await res.json();
      if (Array.isArray(dados) && dados.length > 0) {
        // Agrega fornecedores por CNPJ
        const fornMap = {};
        for (const contrato of dados) {
          const cnpj = contrato.fornecedor?.cnpjFormatado || contrato.fornecedor?.cpfFormatado || '—';
          const nome = contrato.fornecedor?.nome || 'Empresa não identificada';
          const valor = parseFloat(contrato.valorInicialCompra || 0);
          const servico = contrato.objetoContrato || 'Não especificado';

          if (!fornMap[cnpj]) fornMap[cnpj] = { nome, cnpj, servico, total: 0 };
          fornMap[cnpj].total += valor;
        }

        // Deleta e reinserere
        await supabaseDelete('fornecedores', `ano=eq.${ANO_ATUAL}`);
        const rows = Object.values(fornMap).map(f => ({
          ano: ANO_ATUAL,
          nome: f.nome,
          cnpj: f.cnpj,
          servico: f.servico.substring(0, 200),
          total_recebido: f.total,
          situacao_rf: 'Regular',
          alerta: false,
          fonte: 'Portal da Transparência',
          atualizado_em: new Date().toISOString()
        }));

        if (rows.length > 0) {
          await supabaseUpsert('fornecedores', rows);
          total = rows.length;
        }
        await log('Portal da Transparência', 'sucesso', total, `${total} fornecedores coletados`);
      }
    } else {
      await log('Portal da Transparência', 'parcial', 0,
        `API retornou status ${res.status} — pode precisar de chave de acesso`);
    }
  } catch (err) {
    await log('Portal da Transparência', 'erro', 0, err.message);
  }
  return total;
}

// ── 3. PORTAL DA TRANSPARÊNCIA — Licitações ────────────────
async function coletarLicitacoes() {
  let total = 0;
  try {
    const url = `https://api.portaldatransparencia.gov.br/api-de-dados/licitacoes?` +
      `codigoMunicipioIbge=${IBGE_COD}&pagina=1&quantidade=20`;

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });

    if (res.ok) {
      const dados = await res.json();
      if (Array.isArray(dados) && dados.length > 0) {
        await supabaseDelete('licitacoes', `atualizado_em=lt.${new Date(Date.now() - 7*24*60*60*1000).toISOString()}`);

        const rows = dados.map(l => {
          const hoje = new Date();
          const encerramento = l.dataEncerramentoVigencia ? new Date(l.dataEncerramentoVigencia) : null;
          const diasParaVencer = encerramento ? Math.ceil((encerramento - hoje) / (1000*60*60*24)) : null;

          let status = 'ativo';
          if (!encerramento) status = 'aberto';
          else if (diasParaVencer !== null && diasParaVencer < 0) status = 'encerrado';
          else if (diasParaVencer !== null && diasParaVencer <= 60) status = 'vencendo';

          return {
            numero: l.numero || l.codigoLicitacao || '—',
            modalidade: (l.modalidade?.descricao || 'Pregão').toLowerCase().replace('pregão', 'pregao'),
            objeto: (l.objeto || 'Não especificado').substring(0, 300),
            empresa: l.fornecedor?.nome || l.vencedor?.nome || 'Em andamento',
            cnpj: l.fornecedor?.cnpjFormatado || '—',
            valor: parseFloat(l.valorInicial || l.valorHomologado || 0),
            data_abertura: l.dataAberturaLicitacao || null,
            data_encerramento: l.dataEncerramentoVigencia || null,
            status,
            link_edital: l.link || null,
            fonte: 'Portal da Transparência',
            atualizado_em: new Date().toISOString()
          };
        });

        await supabaseUpsert('licitacoes', rows);
        total = rows.length;
        await log('Licitações', 'sucesso', total, `${total} licitações coletadas`);
      }
    } else {
      await log('Licitações', 'parcial', 0, `API retornou ${res.status}`);
    }
  } catch (err) {
    await log('Licitações', 'erro', 0, err.message);
  }
  return total;
}

// ── 4. TSE — Dados dos vereadores ─────────────────────────
async function coletarVereadores() {
  let total = 0;
  try {
    // TSE: dados abertos de candidatos eleitos 2024
    const url = `https://dadosabertos.tse.jus.br/api/3/action/datastore_search?` +
      `resource_id=consulta_cand_2024_AC&filters={"NM_MUNICIPIO":"SENADOR GUIOMARD","DS_CARGO":"VEREADOR","DS_SIT_TOT_TURNO":"ELEITO"}&limit=20`;

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (res.ok) {
      const dados = await res.json();
      const records = dados?.result?.records || [];

      if (records.length > 0) {
        // Limpa vereadores antigos antes de inserir novos
        await supabaseDelete('vereadores', 'id=neq.00000000-0000-0000-0000-000000000000');

        const rows = records.map(v => ({
          nome: v.NM_CANDIDATO || v.NM_URNA_CANDIDATO || '—',
          partido: v.SG_PARTIDO || '—',
          numero_urna: parseInt(v.NR_CANDIDATO || 0),
          votos_recebidos: parseInt(v.QT_VOTOS_NOMINAIS || 0),
          escolaridade: v.DS_GRAU_INSTRUCAO || '—',
          data_nascimento: v.DT_NASCIMENTO ? new Date(v.DT_NASCIMENTO).toISOString().split('T')[0] : null,
          mandatos_anteriores: 0,
          patrimonio_declarado: parseFloat(v.VR_BEM_CANDIDATO || 0),
          ano_declaracao: 2024,
          fonte: 'TSE',
          atualizado_em: new Date().toISOString()
        }));

        await supabaseUpsert('vereadores', rows);
        total = rows.length;
        await log('TSE', 'sucesso', total, `${total} vereadores eleitos coletados`);
      } else {
        await log('TSE', 'parcial', 0, 'Nenhum vereador encontrado para o município');
      }
    }
  } catch (err) {
    await log('TSE', 'erro', 0, err.message);
  }
  return total;
}

// ── 5. SICONFI — Indicadores constitucionais (LRF) ─────────
async function coletarIndicadores() {
  let total = 0;
  try {
    const url = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rgf?` +
      `an_exercicio=${ANO_ATUAL}&in_periodicidade=Q&nr_periodo=3&co_municipio=${IBGE_COD}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (res.ok) {
      const data = await res.json();
      const items = data.items || [];

      const indicadoresData = [];

      for (const item of items) {
        const conta = item.no_conta || '';
        const valor = parseFloat(item.vl_valor || 0);

        if (conta.includes('PESSOAL') && conta.includes('TOTAL')) {
          indicadoresData.push({
            ano: ANO_ATUAL,
            chave: 'pct_pessoal',
            valor: valor,
            limite_legal: 60,
            situacao: valor > 60 ? 'critico' : valor > 54 ? 'atencao' : 'ok',
            descricao: 'Gastos com pessoal (% da RCL)',
            fonte: 'Siconfi/RGF',
            atualizado_em: new Date().toISOString()
          });
        }
      }

      if (indicadoresData.length > 0) {
        for (const ind of indicadoresData) {
          await supabaseUpsert('indicadores', [ind], 'ano,chave');
        }
        total = indicadoresData.length;
        await log('Siconfi/RGF', 'sucesso', total, `${total} indicadores atualizados`);
      }
    }
  } catch (err) {
    await log('Siconfi/RGF', 'erro', 0, err.message);
  }
  return total;
}

// ── 6. Atualiza timestamp geral ────────────────────────────
async function atualizarTimestamp() {
  const url = `${SUPABASE_URL}/rest/v1/configuracoes?chave=eq.ultima_atualizacao`;
  await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify({ valor: new Date().toISOString() })
  });
}

// ── HANDLER PRINCIPAL ──────────────────────────────────────
export default async function handler(req) {
  // Verificação de segurança: aceita apenas do Vercel Cron ou com chave
  const authHeader = req.headers.get('authorization');
  const cronHeader = req.headers.get('x-vercel-cron');
  const isVercelCron = cronHeader === '1';
  const hasValidKey = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !hasValidKey) {
    // Permite GET sem auth para teste manual pelo dev
    if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify({ error: 'Variáveis de ambiente não configuradas' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  console.log(`[Quinari Cron] Iniciando coleta — ${new Date().toISOString()}`);

  const inicio = Date.now();
  const resultados = {};

  // Executa todas as coletas em paralelo
  const [siconfi, fornecedores, licitacoes, vereadores, indicadores] = await Promise.allSettled([
    coletarSiconfi(),
    coletarFornecedores(),
    coletarLicitacoes(),
    coletarVereadores(),
    coletarIndicadores()
  ]);

  resultados.siconfi     = siconfi.status === 'fulfilled' ? siconfi.value : { erro: siconfi.reason?.message };
  resultados.fornecedores = fornecedores.status === 'fulfilled' ? fornecedores.value : 0;
  resultados.licitacoes  = licitacoes.status === 'fulfilled' ? licitacoes.value : 0;
  resultados.vereadores  = vereadores.status === 'fulfilled' ? vereadores.value : 0;
  resultados.indicadores = indicadores.status === 'fulfilled' ? indicadores.value : 0;

  await atualizarTimestamp();

  const duracao = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`[Quinari Cron] Coleta finalizada em ${duracao}s`, resultados);

  return new Response(JSON.stringify({
    sucesso: true,
    duracao_segundos: duracao,
    executado_em: new Date().toISOString(),
    resultados
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
