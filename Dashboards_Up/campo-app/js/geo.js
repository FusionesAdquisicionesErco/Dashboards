/* Lectura de KMZ / KML / GeoJSON -> lista de features GeoJSON simples (WGS84) */
const GeoParse = (() => {
  const ND = (el, n) => Array.from(el.getElementsByTagNameNS('*', n));
  const child = (el, n) => Array.from(el.children).find(c => c.localName === n);
  const r6 = v => Math.round(v * 1e6) / 1e6;

  function stripHtml(s) {
    if (!s) return '';
    const d = new DOMParser().parseFromString(s, 'text/html');
    return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function coordsOf(el) {
    const c = ND(el, 'coordinates')[0];
    if (!c) return [];
    return c.textContent.trim().split(/\s+/).map(t => t.split(','))
      .filter(p => p.length >= 2).map(p => [r6(+p[0]), r6(+p[1])])
      .filter(p => isFinite(p[0]) && isFinite(p[1]));
  }
  function bboxOf(type, coords) {
    let w = 180, s = 90, e = -180, n = -90;
    const add = c => { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; };
    if (type === 'Point') add(coords);
    else if (type === 'LineString') coords.forEach(add);
    else coords.forEach(r => r.forEach(add));
    return [w, s, e, n];
  }
  function mk(type, coords, props) {
    return { type: 'Feature', properties: props, geometry: { type, coordinates: coords }, bbox: bboxOf(type, coords) };
  }

  function parseKml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('El KML no es válido.');
    const out = [];
    ND(doc, 'Placemark').forEach(pm => {
      const props = {
        name: ((child(pm, 'name') || {}).textContent || '').trim(),
        description: stripHtml(((child(pm, 'description') || {}).textContent) || '')
      };
      ND(pm, 'Polygon').forEach(pg => {
        const outer = ND(pg, 'outerBoundaryIs')[0];
        if (!outer) return;
        const rings = [coordsOf(outer)];
        ND(pg, 'innerBoundaryIs').forEach(i => rings.push(coordsOf(i)));
        const ok = rings.filter(r => r.length >= 3);
        if (ok.length) out.push(mk('Polygon', ok, props));
      });
      ND(pm, 'LineString').forEach(ls => { const c = coordsOf(ls); if (c.length >= 2) out.push(mk('LineString', c, props)); });
      ND(pm, 'Point').forEach(pt => { const c = coordsOf(pt)[0]; if (c) out.push(mk('Point', c, props)); });
    });
    return out;
  }

  function fromGeoJSON(obj) {
    const out = [];
    const prop = p => {
      p = p || {};
      const name = p.name || p.Name || p.NOMBRE || p.nombre || p.NAME || '';
      const description = p.description || p.descripcion || p.Description || '';
      return { name: String(name), description: String(description) };
    };
    const pair = c => [r6(c[0]), r6(c[1])];
    function geom(g, props) {
      if (!g) return;
      const t = g.type, c = g.coordinates;
      if (t === 'Point') out.push(mk('Point', pair(c), props));
      else if (t === 'MultiPoint') c.forEach(p => out.push(mk('Point', pair(p), props)));
      else if (t === 'LineString') out.push(mk('LineString', c.map(pair), props));
      else if (t === 'MultiLineString') c.forEach(l => out.push(mk('LineString', l.map(pair), props)));
      else if (t === 'Polygon') out.push(mk('Polygon', c.map(r => r.map(pair)), props));
      else if (t === 'MultiPolygon') c.forEach(pg => out.push(mk('Polygon', pg.map(r => r.map(pair)), props)));
      else if (t === 'GeometryCollection') (g.geometries || []).forEach(x => geom(x, props));
    }
    if (obj.type === 'FeatureCollection') obj.features.forEach(f => geom(f.geometry, prop(f.properties)));
    else if (obj.type === 'Feature') geom(obj.geometry, prop(obj.properties));
    else geom(obj, prop({}));
    return out;
  }

  function finish(features) {
    let w = 180, s = 90, e = -180, n = -90;
    features.forEach(f => {
      const b = f.bbox;
      if (b[0] < -180 || b[2] > 180 || b[1] < -90 || b[3] > 90)
        throw new Error('Las coordenadas no parecen estar en WGS84 (lat/lon). Exporta la capa en WGS84 y vuelve a cargarla.');
      if (b[0] < w) w = b[0]; if (b[1] < s) s = b[1]; if (b[2] > e) e = b[2]; if (b[3] > n) n = b[3];
    });
    return { features, bbox: [w, s, e, n] };
  }

  async function parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    let feats = [];
    if (ext === 'kmz') {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const kmls = Object.keys(zip.files).filter(n => /\.kml$/i.test(n) && !zip.files[n].dir);
      if (!kmls.length) throw new Error('El KMZ no contiene ningún archivo .kml.');
      for (const n of kmls) feats = feats.concat(parseKml(await zip.files[n].async('string')));
    } else if (ext === 'kml') {
      feats = parseKml(await file.text());
    } else if (ext === 'geojson' || ext === 'json') {
      feats = fromGeoJSON(JSON.parse(await file.text()));
    } else {
      throw new Error('Formato no soportado. Usa KMZ, KML o GeoJSON.');
    }
    return finish(feats);
  }
  return { parseFile };
})();
