/* Descarga de mapa base para usar sin señal (se guarda en Cache Storage, aparte del caché automático) */
const OfflineMaps = (() => {
  const CACHE = 'campo-offline-v1';
  const ZKEY = 'campo.offlineZones';
  const KB_PER_TILE = 20; // promedio aproximado de una tesela satelital

  const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
  const lat2y = (lat, z) => {
    lat = Math.max(-85.05, Math.min(85.05, lat));
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
  };
  function ranges(bbox, zmin, zmax) {
    const out = [];
    for (let z = zmin; z <= zmax; z++) {
      out.push({ z, x0: lon2x(bbox[0], z), x1: lon2x(bbox[2], z), y0: lat2y(bbox[3], z), y1: lat2y(bbox[1], z) });
    }
    return out;
  }
  const count = (bbox, zmin, zmax) => ranges(bbox, zmin, zmax).reduce((a, r) => a + (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1), 0);
  function urls(tpl, bbox, zmin, zmax) {
    const list = [];
    ranges(bbox, zmin, zmax).forEach(r => {
      for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++)
        list.push(tpl.replace('{z}', r.z).replace('{x}', x).replace('{y}', y));
    });
    return list;
  }
  // agranda el bbox unos metros a cada lado
  function pad(bbox, m) {
    const dLat = m / 111320, dLng = m / (111320 * Math.cos((bbox[1] + bbox[3]) / 2 * Math.PI / 180));
    return [bbox[0] - dLng, bbox[1] - dLat, bbox[2] + dLng, bbox[3] + dLat];
  }

  /* Descarga con 6 conexiones en paralelo. onProg(hechas, total). isCancelled() para detener. */
  async function download(tpl, bbox, zmin, zmax, onProg, isCancelled) {
    const cache = await caches.open(CACHE);
    const list = urls(tpl, bbox, zmin, zmax);
    let i = 0, ok = 0, fail = 0, quota = false;
    async function worker() {
      while (i < list.length && !isCancelled() && !quota) {
        const url = list[i++];
        try {
          if (await cache.match(url)) ok++;
          else {
            // cache:'reload' hace que el service worker no la duplique en el caché automático
            const r = await fetch(url, { mode: 'cors', cache: 'reload' });
            if (r.ok) { await cache.put(url, r); ok++; } else fail++;
          }
        } catch (e) { fail++; if (e && e.name === 'QuotaExceededError') quota = true; }
        onProg(ok + fail, list.length);
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    return { ok, fail, total: list.length, cancelled: isCancelled(), quota };
  }

  const zones = () => { try { return JSON.parse(localStorage.getItem(ZKEY) || '[]'); } catch (e) { return []; } };
  const saveZones = z => localStorage.setItem(ZKEY, JSON.stringify(z));

  async function removeZone(id, tpl) {
    const all = zones(), z = all.find(x => x.id === id); if (!z) return;
    const rest = all.filter(x => x.id !== id);
    const keep = new Set(); rest.forEach(r => urls(tpl, r.bbox, r.zmin, r.zmax).forEach(u => keep.add(u)));
    const cache = await caches.open(CACHE);
    const del = urls(tpl, z.bbox, z.zmin, z.zmax).filter(u => !keep.has(u));
    for (let k = 0; k < del.length; k += 50) await Promise.all(del.slice(k, k + 50).map(u => cache.delete(u)));
    saveZones(rest);
  }

  return { CACHE, KB_PER_TILE, count, pad, download, zones, saveZones, removeZone };
})();
