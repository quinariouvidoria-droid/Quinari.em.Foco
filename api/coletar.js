// api/coletar.js — Quinari em Foco v2
// Código IBGE Senador Guiomard: 1200450
// CORRIGIDO: parâmetros Siconfi e mapeamento de campos

const IBGE = '1200450';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TRANSP_KEY   = process.env.TRANSPARENCIA_API_KEY;

// ─── Salvar no Supabase ───────────────────────────────────────────────────────
async function salvar(tabela, registros) {
  if (!registros || registros.length === 0) return { count: 0 };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(registros)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase (${tabela}): ${res.status} — ${err}`);
  }
  return { count: registros.length };
}

// ─── Log no Supabase ──────────────────────────────────────────────────────────
async function registrarLog(fonte, status, total, erro = null) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/log_coleta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({
        fonte, status, total_registros: total,
        erro, executado_em: new Date().toISOString()
      })
    });
  } catch(e) { /* silencioso */ }
}

// ─── 1. SICONFI — RREO (Receitas e Despesas) ─────────────────────────────────
// IMPORTANTE: A API do Siconfi usa apenas id_ente, an_exercicio, nr_periodo,
// co_tipo_demonstrativo e no_anexo. Sem co_esfera ou co_poder.
async function coletarSiconfi(ano) {
  const resultado = { receitas: 0, indicadores: 0, detalhes: [] };

  // Tenta todos os bimestres do mais recente ao mais antigo
  for (let bimestre = 6; bimestre >= 1; bimestre--) {
    try {
      // RREO Anexo 01 — Balanço Orçamentário (Receitas e Despesas)
      const url = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?an_exercicio=${ano}&nr_periodo=${bimestre}&co_tipo_demonstrativo=RREO&no_anexo=RREO-Anexo%2001&id_ente=${IBGE}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if (!res.ok) {
        resultado.detalhes.push(`Bimestre ${bimestre}: HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      resultado.detalhes.push(`Bimestre ${bimestre}: ${json.items?.length ?? 0} itens`);

      if (!json.items || json.items.length === 0) continue;

      // Primeiro item para inspecionar os campos disponíveis
      const campos = Object.keys(json.items[0]);
      resultado.campos_disponiveis = campos;

      // Mapeia os campos — a API Siconfi pode variar os nomes
      // Campos comuns: ro_periodo_atual, vl_periodo_atual, co_conta, no_conta, rotulo, coluna, valor
      const receitas = json.items
        .filter(d => {
          // Filtra linhas de receita (contêm "RECEITA" no nome ou código)
          const nome = (d.no_conta || d.conta || d.rotulo || '').toUpperCase();
          return nome.includes('RECEITA') || nome.includes('FPM') || nome.includes('FUNDEB') || nome.includes('TRANSFERENCIA');
        })
        .map(d => ({
          ano: parseInt(ano),
          fonte: d.no_conta || d.conta || d.rotulo || 'Não informado',
          categoria: d.co_conta || d.cod_conta || 'S/C',
          orcado: parseFloat(d.vl_periodo_anterior || d.valor || 0) || 0,
          arrecadado: parseFloat(d.vl_periodo_atual || d.valor || 0) || 0,
          atualizado_em: new Date().toISOString()
        }));

      // Se não encontrou receitas específicas, salva todos os itens como receitas
      const registrosParaSalvar = receitas.length > 0 ? receitas : json.items.map(d => ({
        ano: parseInt(ano),
        fonte: d.no_conta || d.conta || d.rotulo || JSON.stringify(d).substring(0, 100),
        categoria: d.co_conta || d.cod_conta || 'S/C',
        orcado: parseFloat(d.vl_periodo_anterior || 0) || 0,
        arrecadado: parseFloat(d.vl_periodo_atual || d.valor || 0) || 0,
        atualizado_em: new Date().toISOString()
      }));

      if (registrosParaSalvar.length > 0) {
        await salvar('receitas', registrosParaSalvar);
        resultado.receitas = registrosParaSalvar.length;
        resultado.bimestre_usado = bimestre;
        await registrarLog('Siconfi/RREO', 'ok', resultado.receitas);
        break; // Encontrou dados, para o loop
      }
    } catch(e) {
      resultado.detalhes.push(`Bimestre ${bimestre}: ${e.message}`);
    }
  }

  // RGF — Indicadores LRF (pessoal, dívida)
  try {
    const urlRgf = `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rgf?an_exercicio=${ano}&nr_periodo=3&co_tipo_demonstrativo=RGF&no_anexo=RGF-Anexo%2001&id_ente=${IBGE}`;
    const resRgf = await fetch(urlRgf, { signal: AbortSignal.timeout(8000) });
    if (resRgf.ok) {
      const rgf = await resRgf.json();
      resultado.detalhes.push(`RGF: ${rgf.items?.length ?? 0} itens`);
      if (rgf.items && rgf.items.length > 0) {
        const indicadores = rgf.items.map(d => ({
          ano: parseInt(ano),
          nome: d.no_conta || d.conta || d.rotulo || 'Indicador',
          valor: parseFloat(d.vl_periodo_atual || d.valor || 0) || 0,
          limite: parseFloat(d.vl_periodo_anterior || 0) || null,
          atualizado_em: new Date().toISOString()
        }));
        await salvar('indicadores', indicadores);
        resultado.indicadores = indicadores.length;
        await registrarLog('Siconfi/RGF', 'ok', resultado.indicadores);
      }
    }
  } catch(e) {
    resultado.detalhes.push(`RGF erro: ${e.message}`);
  }

  if (resultado.receitas === 0) {
    await registrarLog('Siconfi/RREO', 'parcial', 0, resultado.detalhes.join(' | '));
  }

  return resultado;
}

// ─── 2. Portal da Transparência — Licitações e Contratos ─────────────────────
async function coletarTransparencia(ano) {
  const resultado = { licitacoes: 0, fornecedores: 0, detalhes: [] };
  const headers = {
    'chave-api-dados': TRANSP_KEY,
    'Accept': 'application/json'
  };

  // Licitações
  try {
    const url = `https://api.portaldatransparencia.gov.br/api-de-dados/licitacoes?codigoIbge=${IBGE}&dataInicial=01/01/${ano}&dataFinal=31/12/${ano}&pagina=1`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    resultado.detalhes.push(`Licitacoes HTTP: ${res.status}`);

    if (res.ok) {
      const dados = await res.json();
      resultado.detalhes.push(`Licitacoes registros: ${Array.isArray(dados) ? dados.length : 'não é array — ' + JSON.stringify(dados).substring(0, 100)}`);

      if (Array.isArray(dados) && dados.length > 0) {
        // Busca mais páginas se necessário
        let todos = [...dados];
        if (dados.length === 500) {
          for (let p = 2; p <= 5; p++) {
            const r2 = await fetch(`https://api.portaldatransparencia.gov.br/api-de-dados/licitacoes?codigoIbge=${IBGE}&dataInicial=01/01/${ano}&dataFinal=31/12/${ano}&pagina=${p}`, { headers, signal: AbortSignal.timeout(8000) });
            if (!r2.ok) break;
            const d2 = await r2.json();
            if (!d2 || d2.length === 0) break;
            todos = todos.concat(d2);
            if (d2.length < 500) break;
          }
        }

        const licitacoes = todos.map(d => ({
          ano: parseInt(ano),
          numero: String(d.numero || d.id || 'S/N').substring(0, 50),
          modalidade: String(d.modalidade?.descricao || d.modalidadeLicitacao?.descricao || 'Não informado').substring(0, 100),
          objeto: String(d.objeto || 'Não informado').substring(0, 500),
          valor_estimado: parseFloat(d.valorEstimado || d.valor || 0) || 0,
          valor_adjudicado: parseFloat(d.valorAdjudicado || 0) || 0,
          situacao: String(d.situacao?.descricao || d.situacao || 'Não informado').substring(0, 100),
          data_abertura: d.dataAbertura || d.dataPublicacaoEdital || null,
          vencedor: String(d.fornecedorVencedor?.nome || d.nomeRazaoSocial || '').substring(0, 200) || null,
          atualizado_em: new Date().toISOString()
        }));
        await salvar('licitacoes', licitacoes);
        resultado.licitacoes = licitacoes.length;
        await registrarLog('Transparencia/Licitacoes', 'ok', resultado.licitacoes);
      }
    } else {
      const errBody = await res.text();
      resultado.detalhes.push(`Licitacoes erro body: ${errBody.substring(0, 200)}`);
      await registrarLog('Transparencia/Licitacoes', 'erro', 0, `HTTP ${res.status}: ${errBody.substring(0, 200)}`);
    }
  } catch(e) {
    resultado.detalhes.push(`Licitacoes excecao: ${e.message}`);
    await registrarLog('Transparencia/Licitacoes', 'erro', 0, e.message);
  }

  // Contratos / Fornecedores
  try {
    const url = `https://api.portaldatransparencia.gov.br/api-de-dados/contratos?codigoIbge=${IBGE}&dataInicial=01/01/${ano}&dataFinal=31/12/${ano}&pagina=1`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    resultado.detalhes.push(`Contratos HTTP: ${res.status}`);

    if (res.ok) {
      const dados = await res.json();
      resultado.detalhes.push(`Contratos registros: ${Array.isArray(dados) ? dados.length : 'não é array'}`);

      if (Array.isArray(dados) && dados.length > 0) {
        const fornecedores = dados.map(d => ({
          ano: parseInt(ano),
          nome: String(d.fornecedor?.nome || d.nomeRazaoSocial || 'Não informado').substring(0, 200),
          cnpj_cpf: String(d.fornecedor?.cnpjCpf || d.cpfCnpj || '').substring(0, 20) || null,
          valor_total: parseFloat(d.valorInicialCompra || d.valor || 0) || 0,
          objeto: String(d.objeto || 'Não informado').substring(0, 300),
          numero_contrato: String(d.numero || '').substring(0, 50) || null,
          data_inicio: d.dataInicioVigencia || null,
          data_fim: d.dataFimVigencia || null,
          atualizado_em: new Date().toISOString()
        }));
        await salvar('fornecedores', fornecedores);
        resultado.fornecedores = fornecedores.length;
        await registrarLog('Transparencia/Contratos', 'ok', resultado.fornecedores);
      }
    } else {
      const errBody = await res.text();
      resultado.detalhes.push(`Contratos erro body: ${errBody.substring(0, 200)}`);
      await registrarLog('Transparencia/Contratos', 'erro', 0, `HTTP ${res.status}: ${errBody.substring(0, 200)}`);
    }
  } catch(e) {
    resultado.detalhes.push(`Contratos excecao: ${e.message}`);
    await registrarLog('Transparencia/Contratos', 'erro', 0, e.message);
  }

  return resultado;
}

// ─── 3. TSE — Vereadores 2024 ─────────────────────────────────────────────────
// Dados fixos baseados no resultado oficial TSE — Eleição Municipal 2024
// Senador Guiomard-AC tem 9 vagas de vereador
async function coletarVereadoresTSE() {
  // Dados públicos do TSE — eleição outubro 2024
  // Fonte: resultados.tse.jus.br — município 01392 (código TSE para Senador Guiomard)
  const vereadores = [
    { nome: 'AGUARDAR CONFIRMAÇÃO TSE', partido: 'Verificar em resultados.tse.jus.br', votos: 0, situacao: 'Eleito' },
  ];

  // Tenta buscar da API pública do TSE
  try {
    // API TSE — resultado por município (eleição 2024, código 407 = municipal)
    const url = 'https://resultados.tse.jus.br/oficial/ele2024/407/dados/ac/ac01392-c0013-e000407-u.json';
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const dados = await res.json();
      // Estrutura TSE: dados.cands = candidatos
      if (dados.cands && dados.cands.length > 0) {
        const eleitos = dados.cands
          .filter(c => c.st === 'Eleito' || c.st === 'Eleito por QP' || c.st === 'Eleito por média')
          .map(c => ({
            nome: c.nm || c.nmc || 'Não informado',
            partido: c.sg || 'Não informado',
            votos: parseInt(c.vap || c.tv || 0),
            situacao: c.st || 'Eleito',
            municipio: 'Senador Guiomard',
            uf: 'AC',
            ano_eleicao: 2024,
            cargo: 'Vereador',
            atualizado_em: new Date().toISOString()
          }));
        if (eleitos.length > 0) {
          await salvar('vereadores', eleitos);
          await registrarLog('TSE', 'ok', eleitos.length);
          return { vereadores: eleitos.length, fonte: 'API TSE' };
        }
      }
    }
  } catch(e) {
    await registrarLog('TSE', 'parcial', 0, `API TSE indisponivel: ${e.message} — inserindo placeholder`);
  }

  // Fallback: insere 1 registro placeholder para não deixar tabela vazia
  await salvar('vereadores', [{
    nome: 'DADOS PENDENTES — Consultar resultados.tse.jus.br',
    partido: 'N/A',
    votos: 0,
    situacao: 'Verificar',
    municipio: 'Senador Guiomard',
    uf: 'AC',
    ano_eleicao: 2024,
    cargo: 'Vereador',
    atualizado_em: new Date().toISOString()
  }]);
  return { vereadores: 1, fonte: 'placeholder' };
}

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const ano = req.query.ano || String(new Date().getFullYear());
  const debug = req.query.debug === 'true'; // ?debug=true mostra detalhes completos

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ erro: 'SUPABASE_URL ou SUPABASE_SERVICE_KEY não configuradas no Vercel' });
  }

  if (!TRANSP_KEY) {
    return res.status(500).json({ erro: 'TRANSPARENCIA_API_KEY não configurada no Vercel' });
  }

  const inicio = Date.now();

  try {
    const [siconfi, transparencia, tse] = await Promise.allSettled([
      coletarSiconfi(ano),
      coletarTransparencia(ano),
      coletarVereadoresTSE()
    ]);

    const relatorio = {
      ano,
      status: 'concluido',
      tempo_ms: Date.now() - inicio,
      resumo: {
        siconfi: siconfi.status === 'fulfilled'
          ? { receitas: siconfi.value.receitas, indicadores: siconfi.value.indicadores }
          : { erro: siconfi.reason?.message },
        transparencia: transparencia.status === 'fulfilled'
          ? { licitacoes: transparencia.value.licitacoes, fornecedores: transparencia.value.fornecedores }
          : { erro: transparencia.reason?.message },
        tse: tse.status === 'fulfilled'
          ? { vereadores: tse.value.vereadores }
          : { erro: tse.reason?.message }
      }
    };

    // Modo debug: inclui detalhes técnicos para diagnóstico
    if (debug) {
      relatorio.debug = {
        siconfi: siconfi.status === 'fulfilled' ? siconfi.value : siconfi.reason?.message,
        transparencia: transparencia.status === 'fulfilled' ? transparencia.value : transparencia.reason?.message,
        tse: tse.status === 'fulfilled' ? tse.value : tse.reason?.message
      };
    }

    return res.status(200).json(relatorio);
  } catch(e) {
    return res.status(500).json({ erro: e.message });
  }
}
