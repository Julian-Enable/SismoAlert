const USGS_FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const EMSC_FEED = 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=200';
const SGC_FEED = 'https://archive.sgc.gov.co/feed/v1.0.1/summary/five_days_2.json';

// El feed del SGC vive detras de CloudFront con WAF: solo responde a un User-Agent de navegador.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const norm = (id, source, f) => {
  const p = f.properties || {};
  const [lon, lat, depth] = (f.geometry && f.geometry.coordinates) || [];
  if (lat === undefined || lon === undefined) return null;
  const flynn = (s) =>
    s ? s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()) : '';
  return {
    id,
    source,
    time: new Date(p.time).getTime(),
    mag: p.mag ?? null,
    lat,
    lon,
    depth: depth ?? null,
    place: (p.place || flynn(p.flynn_region) || `${source} reportado`).replace(/^\s*M\d[\d.]*\s+/, ''),
    url: p.url || ''
  };
};

async function fetchJson(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'SismoAlert/0.1 (+aviso sismico Colombia)', ...headers }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchUsgs() {
  const geo = await fetchJson(USGS_FEED);
  return (geo.features || [])
    .map((f) => norm(`usgs:${f.id}`, 'USGS', f))
    .filter(Boolean);
}

export async function fetchEmsc() {
  const geo = await fetchJson(EMSC_FEED);
  return (geo.features || [])
    .map((f) => norm(`emsc:${f.properties?.source_id || f.id}`, 'EMSC', f))
    .filter(Boolean);
}

// El SGC entrega "2026-09-21 19:12" (UTC, truncado al minuto).
function sgcTime(value) {
  if (!value) return NaN;
  const iso = String(value).trim().replace(' ', 'T');
  return Date.parse(/T\d{2}:\d{2}$/.test(iso) ? `${iso}:00Z` : `${iso}Z`);
}

// Red Sismologica Nacional del SGC: localiza con estaciones locales, asi que publica
// los sismos de Colombia mucho antes que USGS o EMSC.
export async function fetchSgc(feedUrl = SGC_FEED) {
  const geo = await fetchJson(feedUrl || SGC_FEED, {
    'User-Agent': BROWSER_UA,
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://www.sgc.gov.co/'
  });
  return (geo.features || [])
    .map((f) => {
      const p = f.properties || {};
      // Ojo: este feed invierte el orden GeoJSON, entrega [lat, lon, profundidad].
      const [lat, lon, depth] = (f.geometry && f.geometry.coordinates) || [];
      const time = sgcTime(p.utcTime);
      if (lat === undefined || lon === undefined || !Number.isFinite(time)) return null;
      const mag = Number(p.mag);
      return {
        id: `sgc:${f.id}`,
        source: 'SGC',
        time,
        mag: Number.isFinite(mag) ? mag : null,
        lat: Number(lat),
        lon: Number(lon),
        depth: depth ?? null,
        place: p.place || 'Colombia',
        url: f.id ? `https://www.sgc.gov.co/detalleevento/${f.id}/resumen` : 'https://www.sgc.gov.co/sismos',
        preliminary: p.status === 'automatic'
      };
    })
    .filter(Boolean);
}
