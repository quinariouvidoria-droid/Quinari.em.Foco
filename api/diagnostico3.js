// api/diagnostico3.js — inspeciona estrutura real do Anexo 02 (despesas)
// Acesse: https://quinari-em-foco.vercel.app/api/diagnostico3

export default async function handler(req, res) {
  const url = 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt/rreo?an_exercicio=2024&nr_periodo=6&co_tipo_demonstrativo=RREO&no_anexo=RREO-Anexo%2002&id_ente=1200450';
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const json = await r.json();
  const itens = json.items || [];

  // Mostra os primeiros 8 itens completos para entender a estrutura
  const amostra = itens.slice(0, 8);

  // Conta valores únicos de cada campo para entender a cardinalidade
  const unicosCodConta = [...new Set(itens.map(i => i.cod_conta))];
  const unicosConta    = [...new Set(itens.map(i => i.conta))];
  const unicosColuna   = [...new Set(itens.map(i => i.coluna))];
  const unicosRotulo   = [...new Set(itens.map(i => i.rotulo))];
  const unicosEsfera   = [...new Set(itens.map(i => i.esfera))];

  return res.status(200).json({
    total_itens: itens.length,
    campos_disponiveis: itens[0] ? Object.keys(itens[0]) : [],
    cardinalidade: {
      cod_conta_unicos: unicosCodConta.length,
      conta_unicos: unicosConta.length,
      coluna_unicos: unicosColuna.length,
      rotulo_unicos: unicosRotulo.length,
      esfera_unicos: unicosEsfera.length,
    },
    valores_cod_conta: unicosCodConta.slice(0, 20),
    valores_coluna: unicosColuna,
    valores_rotulo: unicosRotulo,
    amostra_primeiros_8: amostra
  });
}
