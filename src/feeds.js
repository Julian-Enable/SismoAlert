const USGS_FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const EMSC_FEED = 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=200';

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
    url: p.url || p.sources?.indexOf('us') >= 0 ? p.url || '' : p.url || ''
  };
};

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'SismoAlert/0.1 (+aviso sismico Colombia)' } });
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

export async function fetchSgc(apiUrl) {
  if (!apiUrl) throw new Error('SGC_API_URL no configurada');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${apiUrl.replace(/\/$/, '')}/api/events/search/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 1, page_size: 50 }),
      signal: ctrl.signal
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const items = j.results || j.events || j.data || [];
    return items
      .map((e) => {
        const lat = Number(e.latitud ?? e.lat ?? e.latitude);
        const lon = Number(e.longitud ?? e.lon ?? e.longitude);
        if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
        return {
          id: `sgc:${e.id ?? e.event_id ?? e.pk}`,
          source: 'SGC',
          time: new Date(e.fecha_local ?? e.time ?? e.fecha).getTime(),
          mag: Number(e.magnitud ?? e.mag ?? e.magnitude) || null,
          lat,
          lon,
          depth: e.profundidad ?? e.depth ?? null,
          place: e.municipio ? `${e.municipio}, ${e.departamento || ''}`.trim() : e.lugar || 'Colombia',
          url: 'https://sgc.gov.co/sismos'
        };
      })
      .filter(Boolean);
  } finally {
    clearTimeout(t);
  }
}