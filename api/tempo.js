// api/tempo.js — Proxy para Open-Meteo (sem API key)
// Evita bloqueios de CSP/CORS no browser em produção

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, s-maxage=900'); // cache 15 min

  const url = 'https://api.open-meteo.com/v1/forecast?' +
    'latitude=-10.0417&longitude=-67.7436' +
    '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,apparent_temperature,precipitation' +
    '&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max' +
    '&timezone=America%2FRio_Branco&forecast_days=5';

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(502).json({ erro: `Open-Meteo ${r.status}` });
    const dados = await r.json();
    return res.status(200).json(dados);
  } catch (e) {
    return res.status(504).json({ erro: e.message });
  }
}
