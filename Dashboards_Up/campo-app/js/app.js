/* Campo – Visitas: lógica principal */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const MAX_PHOTOS = 10, MIN_SLOTS = 4;
  const PALETTE = ['#ff5722', '#00e5ff', '#ffeb3b', '#e040fb', '#76ff03', '#ff9100', '#40c4ff', '#ff4081'];
  const DEFAULTS = { project: '', zoomMini: 17, maxPx: 1600 };

  const S = {
    map: null, baseKey: localStorage.getItem('campo.base') || 'sat', baseLayer: null,
    layers: [], leaf: {}, points: [], markers: {},
    gps: null, gpsDot: null, gpsCircle: null, firstFix: false,
    settings: loadSettings(), draft: null, urls: [], thumbUrls: [], zip: null, installEvt: null, picking: false
  };

  function loadSettings() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('campo.settings') || '{}')); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  const saveSettings = () => localStorage.setItem('campo.settings', JSON.stringify(S.settings));

  /* ---------- UI helpers ---------- */
  function toast(msg, ms = 2800) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }
  function busy(msg, pct) {
    $('#busy').hidden = false; $('#busyMsg').textContent = msg;
    const bar = $('#busyBar').parentElement;
    if (pct == null) bar.hidden = true; else { bar.hidden = false; $('#busyBar').style.width = pct + '%'; }
  }
  const unbusy = () => { $('#busy').hidden = true; };

  function openSheet(id) {
    $$('.sheet').forEach(s => { s.hidden = s.id !== id; });
    $('#scrim').hidden = false;
    document.body.classList.add('sheet-open');
    $$('#bottomnav button').forEach(b => b.classList.toggle('active', b.dataset.sheet === id));
    if (id === 'sheetLayers') renderLayers();
    if (id === 'sheetPoints') renderPoints();
    if (id === 'sheetExport') renderExport();
    if (id === 'sheetSettings') renderSettings();
  }
  function closeSheets() {
    $$('.sheet').forEach(s => { s.hidden = true; });
    $('#scrim').hidden = true;
    document.body.classList.remove('sheet-open');
    $$('#bottomnav button').forEach(b => b.classList.remove('active'));
    setTimeout(() => S.map && S.map.invalidateSize(), 50);
  }

  /* ---------- Mapa ---------- */
  function initMap() {
    S.map = L.map('map', { zoomControl: false, preferCanvas: true, maxZoom: 20, attributionControl: true }).setView([4.6, -74.1], 6);
    L.control.zoom({ position: 'topright' }).addTo(S.map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(S.map);
    S.map.attributionControl.setPrefix(false);
    setBase(S.baseKey);
  }
  function setBase(key) {
    if (!BASEMAPS[key]) key = 'sat';
    S.baseKey = key; localStorage.setItem('campo.base', key);
    if (S.baseLayer) S.map.removeLayer(S.baseLayer);
    const bm = BASEMAPS[key];
    S.baseLayer = L.tileLayer(bm.url, { maxNativeZoom: bm.maxNative, maxZoom: 20, crossOrigin: true, attribution: bm.attr }).addTo(S.map);
    S.baseLayer.bringToBack();
    $('#btnBase').textContent = (key === 'sat' ? '🛰️ ' : '🗺️ ') + bm.name;
  }

  /* ---------- GPS ---------- */
  function startGps() {
    const chip = $('#gpsChip');
    if (!navigator.geolocation) { chip.textContent = 'GPS no disponible'; chip.className = 'chip bad'; return; }
    navigator.geolocation.watchPosition(pos => {
      const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
      S.gps = { lat, lng, acc, t: Date.now() };
      chip.textContent = `GPS ±${Math.round(acc)} m`;
      chip.className = 'chip ' + (acc <= 15 ? 'ok' : acc <= 50 ? 'warn' : 'bad');
      if (!S.gpsDot) {
        S.gpsDot = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="gps-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, zIndexOffset: -100 }).addTo(S.map);
        S.gpsCircle = L.circle([lat, lng], { radius: acc, color: '#1e88e5', weight: 1, fillOpacity: .1, interactive: false }).addTo(S.map);
      } else { S.gpsDot.setLatLng([lat, lng]); S.gpsCircle.setLatLng([lat, lng]).setRadius(acc); }
      if (!S.firstFix) { S.firstFix = true; if (!S.layers.some(l => l.visible) && !S.points.length) S.map.setView([lat, lng], 16); }
    }, err => {
      chip.textContent = err.code === 1 ? 'GPS sin permiso' : 'GPS sin señal'; chip.className = 'chip bad';
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }

  /* ---------- Capas ---------- */
  function drawLayer(l) {
    if (S.leaf[l.id]) { S.map.removeLayer(S.leaf[l.id]); delete S.leaf[l.id]; }
    const color = l.color;
    const g = L.geoJSON({ type: 'FeatureCollection', features: l.features }, {
      style: () => ({ color, weight: 2.5, opacity: .95, fillColor: color, fillOpacity: .15 }),
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1 }),
      onEachFeature: (f, lyr) => {
        const p = f.properties || {};
        if (p.name || p.description) lyr.bindPopup(`<b>${esc(p.name)}</b>${p.description ? '<br>' + esc(p.description.slice(0, 400)) : ''}`);
      }
    });
    S.leaf[l.id] = g;
    if (l.visible) g.addTo(S.map);
    // los puntos levantados siempre por encima
    Object.values(S.markers).forEach(m => m.setZIndexOffset(1000));
  }
  function fitLayer(l) {
    const b = l.bbox; if (!b) return;
    S.map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [30, 30], maxZoom: 19 });
  }
  function fitAll() {
    const vis = S.layers.filter(l => l.visible && l.bbox);
    if (!vis.length) return;
    const b = vis.reduce((a, l) => [Math.min(a[0], l.bbox[0]), Math.min(a[1], l.bbox[1]), Math.max(a[2], l.bbox[2]), Math.max(a[3], l.bbox[3])], [180, 90, -180, -90]);
    S.map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [30, 30], maxZoom: 18 });
  }
  async function addLayerFiles(files) {
    for (const file of files) {
      try {
        busy(`Leyendo ${file.name}…`);
        await sleep(30);
        const fc = await GeoParse.parseFile(file);
        if (!fc.features.length) throw new Error('El archivo no contiene puntos, líneas ni polígonos.');
        const layer = {
          id: uid(), name: file.name.replace(/\.[^.]+$/, ''), color: PALETTE[S.layers.length % PALETTE.length],
          visible: true, features: fc.features, bbox: fc.bbox, createdAt: Date.now()
        };
        await DB.put('layers', layer);
        S.layers.push(layer); drawLayer(layer); fitLayer(layer);
        toast(`Capa cargada: ${layer.name} (${layer.features.length} elementos)`);
      } catch (e) {
        toast(`No se pudo cargar ${file.name}: ${e.message}`, 5000);
      }
    }
    unbusy(); renderLayers();
  }
  function renderLayers() {
    const box = $('#layerList'); box.innerHTML = '';
    if (!S.layers.length) { box.innerHTML = '<p class="empty">Aún no hay capas cargadas.</p>'; return; }
    S.layers.forEach(l => {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<input type="checkbox" ${l.visible ? 'checked' : ''} aria-label="Visible">
        <input type="color" value="${l.color}" aria-label="Color">
        <div class="grow"><b>${esc(l.name)}</b><small>${l.features.length} elementos</small></div>
        <button class="ico" data-a="zoom" title="Ir a la capa">🔍</button>
        <button class="ico" data-a="del" title="Eliminar">🗑️</button>`;
      const [cb, col] = $$('input', row);
      cb.onchange = async () => { l.visible = cb.checked; await DB.put('layers', l); drawLayer(l); };
      col.onchange = async () => { l.color = col.value; await DB.put('layers', l); drawLayer(l); };
      $('[data-a=zoom]', row).onclick = () => { closeSheets(); fitLayer(l); };
      $('[data-a=del]', row).onclick = async () => {
        if (!confirm(`¿Eliminar la capa «${l.name}»?`)) return;
        await DB.del('layers', l.id);
        if (S.leaf[l.id]) { S.map.removeLayer(S.leaf[l.id]); delete S.leaf[l.id]; }
        S.layers = S.layers.filter(x => x.id !== l.id); renderLayers();
      };
      box.appendChild(row);
    });
  }
  const visibleLayers = () => S.layers.filter(l => l.visible).map(l => ({ name: l.name, color: l.color, features: l.features }));

  /* ---------- Puntos (mapa + lista) ---------- */
  const sortedPoints = () => S.points.slice().sort((a, b) => a.createdAt - b.createdAt);
  function refreshMarkers() {
    Object.values(S.markers).forEach(m => m.remove()); S.markers = {};
    sortedPoints().forEach((p, i) => {
      const icon = L.divIcon({ className: '', html: `<div class="pin"><span>${i + 1}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 36] });
      const m = L.marker([p.lat, p.lng], { icon, zIndexOffset: 1000 }).addTo(S.map);
      m.on('click', () => openPoint(p.id));
      S.markers[p.id] = m;
    });
    const b = $('#ptBadge'); b.hidden = !S.points.length; b.textContent = S.points.length;
  }
  function renderPoints() {
    S.thumbUrls.forEach(URL.revokeObjectURL); S.thumbUrls = [];
    const box = $('#pointList'); box.innerHTML = '';
    if (!S.points.length) { box.innerHTML = '<p class="empty">Todavía no hay puntos. Usa «＋ Punto» en el mapa.</p>'; return; }
    sortedPoints().forEach((p, i) => {
      const ph = p.photos[0]; let url = '';
      if (ph) { url = URL.createObjectURL(ph.marked || ph.orig); S.thumbUrls.push(url); }
      const row = document.createElement('div'); row.className = 'row pt';
      row.innerHTML = `${url ? `<img class="thumb" src="${url}" alt="">` : '<div class="thumb"></div>'}
        <div class="grow"><b><span class="num">${i + 1}</span>${esc(p.name)}</b>
        <small>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} · ${p.photos.length} foto(s)</small></div>
        <button class="ico" data-a="map" title="Ver en el mapa">📍</button>`;
      row.onclick = e => { if (e.target.closest('[data-a=map]')) { closeSheets(); S.map.setView([p.lat, p.lng], Math.max(S.map.getZoom(), 18)); } else openPoint(p.id); };
      box.appendChild(row);
    });
  }

  /* ---------- Formulario de punto ---------- */
  const sigOf = d => `${d.name}|${d.lat.toFixed(7)}|${d.lng.toFixed(7)}`;
  let persistT;
  function persistDraft(now) {
    clearTimeout(persistT);
    const run = () => { if (S.draft) DB.put('meta', { k: 'draft', v: S.draft }).catch(() => { }); };
    if (now) run(); else persistT = setTimeout(run, 400);
  }
  function newPoint() {
    const loc = S.gps ? { lat: S.gps.lat, lng: S.gps.lng, acc: S.gps.acc, src: 'gps' } : { lat: S.map.getCenter().lat, lng: S.map.getCenter().lng, src: 'center' };
    S.draft = { id: uid(), isNew: true, name: `Punto ${S.points.length + 1}`, desc: '', createdAt: Date.now(), photos: [], ...loc };
    openForm();
  }
  function openPoint(id) {
    const p = S.points.find(x => x.id === id); if (!p) return;
    S.draft = { id: p.id, isNew: false, name: p.name, desc: p.desc, lat: p.lat, lng: p.lng, src: 'saved', createdAt: p.createdAt, photos: p.photos.map(x => ({ ...x })) };
    openForm();
  }
  function openForm() {
    const d = S.draft;
    $('#pointTitle').textContent = d.isNew ? 'Nuevo punto' : 'Editar punto';
    $('#fName').value = d.name; $('#fDesc').value = d.desc;
    $('#btnDelete').hidden = d.isNew;
    updateCoords(); renderPhotos();
    openSheet('sheetPoint');
    persistDraft(true);
  }
  function updateCoords() {
    const d = S.draft;
    const src = d.src === 'gps' ? ` · GPS ±${Math.round(d.acc || 0)} m` : d.src === 'center' ? ' · centro del mapa' : d.src === 'map' ? ' · elegido en el mapa' : '';
    $('#fCoords').textContent = `${d.lat.toFixed(6)}, ${d.lng.toFixed(6)}${src}`;
  }
  function renderPhotos() {
    S.urls.forEach(URL.revokeObjectURL); S.urls = [];
    const d = S.draft, grid = $('#photoGrid'); grid.innerHTML = '';
    const sig = sigOf({ ...d, name: $('#fName').value.trim() || d.name });
    const slots = Math.min(MAX_PHOTOS, Math.max(MIN_SLOTS, d.photos.length + 1));
    for (let i = 0; i < slots; i++) {
      const ph = d.photos[i], el = document.createElement('div');
      if (ph) {
        const url = URL.createObjectURL(ph.marked || ph.orig); S.urls.push(url);
        const done = ph.marked && ph.markedFor === sig;
        el.className = 'slot filled';
        el.innerHTML = `<img src="${url}" alt="Foto ${i + 1}"><span class="badge ${done ? 'ok' : ''}">${done ? '✓ marcada' : 'pendiente'}</span>`;
        el.onclick = () => showViewer(i);
      } else {
        el.className = 'slot'; el.textContent = '＋';
        el.onclick = () => $('#inCam').click();
      }
      grid.appendChild(el);
    }
    $('#photoCount').textContent = `(${d.photos.length}/${MAX_PHOTOS})`;
  }
  async function addPhotos(files, fromCamera) {
    const d = S.draft; if (!d) return;
    files = Array.from(files); if (!files.length) return;
    busy('Procesando foto…');
    try {
      for (const f of files) {
        if (d.photos.length >= MAX_PHOTOS) { toast(`Máximo ${MAX_PHOTOS} fotos por punto`); break; }
        const orig = await Watermark.resizeImage(f, S.settings.maxPx, 0.9);
        d.photos.push({ id: uid(), takenAt: fromCamera ? Date.now() : (f.lastModified || Date.now()), orig, marked: null, markedFor: null });
      }
    } catch (e) { toast('No se pudo leer la foto: ' + e.message, 4500); }
    unbusy(); renderPhotos(); persistDraft(true);
  }
  function showViewer(i) {
    const ph = S.draft.photos[i]; if (!ph) return;
    const sig = sigOf({ ...S.draft, name: $('#fName').value.trim() || S.draft.name });
    const done = ph.marked && ph.markedFor === sig;
    const v = $('#viewer'); v._i = i;
    if (v._url) URL.revokeObjectURL(v._url);
    v._url = URL.createObjectURL(ph.marked || ph.orig);
    $('#viewerImg').src = v._url;
    $('#viewerNote').textContent = done ? 'Foto con marca de agua' : 'Vista previa sin marca: se aplicará al guardar el punto';
    v.hidden = false;
  }
  function useGps() {
    if (!S.gps) { toast('Aún no hay señal GPS'); return; }
    Object.assign(S.draft, { lat: S.gps.lat, lng: S.gps.lng, acc: S.gps.acc, src: 'gps' });
    updateCoords(); renderPhotos(); persistDraft();
  }
  function useCenter() {
    const c = S.map.getCenter(); Object.assign(S.draft, { lat: c.lat, lng: c.lng, src: 'center' });
    updateCoords(); renderPhotos(); persistDraft();
  }
  function startPick() {
    S.draft.name = $('#fName').value; S.draft.desc = $('#fDesc').value; persistDraft(true);
    S.picking = true; closeSheets();
    document.body.classList.add('picking');
    $('#crosshair').hidden = false; $('#pickBar').hidden = false;
    S.map.setView([S.draft.lat, S.draft.lng], Math.max(S.map.getZoom(), 17));
  }
  function endPick(ok) {
    S.picking = false;
    document.body.classList.remove('picking');
    $('#crosshair').hidden = true; $('#pickBar').hidden = true;
    if (ok) { const c = S.map.getCenter(); Object.assign(S.draft, { lat: c.lat, lng: c.lng, src: 'map' }); }
    openForm();
  }
  async function savePoint() {
    const d = S.draft;
    d.name = $('#fName').value.trim(); d.desc = $('#fDesc').value.trim();
    if (!d.name) { toast('Escribe el nombre del punto'); $('#fName').focus(); return; }
    const sig = sigOf(d);
    const need = d.photos.filter(p => !p.marked || p.markedFor !== sig);
    try {
      busy('Preparando…', 0);
      if (need.length) {
        busy('Dibujando minimapa…', 5);
        const others = S.points.filter(p => p.id !== d.id).map(p => ({ lat: p.lat, lng: p.lng }));
        const mini = await Watermark.renderMinimap({ lat: d.lat, lng: d.lng, zoom: S.settings.zoomMini, size: 512, base: S.baseKey, layers: visibleLayers(), others });
        if (!mini.tilesLoaded) toast('Sin mapa base (sin conexión): el minimapa solo muestra tus capas', 4500);
        let i = 0;
        for (const ph of need) {
          busy(`Aplicando marca de agua ${++i} de ${need.length}…`, Math.round(10 + i / need.length * 90));
          ph.marked = await Watermark.compose(ph.orig, { minimap: mini.canvas, legend: mini.legend, name: d.name, lat: d.lat, lng: d.lng, takenAt: ph.takenAt, project: S.settings.project });
          ph.markedFor = sig;
        }
      }
      const rec = {
        id: d.id, name: d.name, desc: d.desc, lat: d.lat, lng: d.lng, createdAt: d.createdAt, updatedAt: Date.now(),
        photos: d.photos.map(({ id, takenAt, orig, marked, markedFor }) => ({ id, takenAt, orig, marked, markedFor }))
      };
      await DB.put('points', rec);
      const k = S.points.findIndex(p => p.id === rec.id);
      if (k >= 0) S.points[k] = rec; else S.points.push(rec);
      await DB.del('meta', 'draft');
      S.draft = null; refreshMarkers(); closeSheets();
      toast(`Punto guardado · ${rec.photos.length} foto(s)`);
    } catch (e) {
      console.error(e); toast('Error al guardar: ' + e.message, 6000);
    }
    unbusy();
  }
  async function cancelForm() {
    const d = S.draft;
    if (d && d.isNew && (d.photos.length || $('#fDesc').value.trim()) && !confirm('¿Descartar este punto sin guardar?')) return;
    S.draft = null; await DB.del('meta', 'draft'); closeSheets();
  }
  async function deletePoint() {
    if (!confirm('¿Eliminar este punto y sus fotos?')) return;
    const id = S.draft.id;
    await DB.del('points', id); await DB.del('meta', 'draft');
    S.points = S.points.filter(p => p.id !== id); S.draft = null;
    refreshMarkers(); closeSheets(); toast('Punto eliminado');
  }

  /* ---------- Exportar ---------- */
  const slug = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'punto';
  const csvCell = v => { v = String(v == null ? '' : v); return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const stampName = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };

  function renderExport() {
    const np = S.points.length, nf = S.points.reduce((a, p) => a + p.photos.length, 0);
    const mb = S.points.reduce((a, p) => a + p.photos.reduce((b, f) => b + (f.marked || f.orig).size, 0), 0) / 1048576;
    $('#exportSummary').innerHTML = `<b>${np}</b> punto(s) · <b>${nf}</b> foto(s) · aprox. <b>${mb.toFixed(1)} MB</b>`;
    $('#btnZip').disabled = !np; $('#zipResult').hidden = !S.zip;
    if (S.zip) $('#zipInfo').innerHTML = `<b>${esc(S.zip.name)}</b><br><small>${(S.zip.blob.size / 1048576).toFixed(1)} MB</small>`;
    $('#btnShare').hidden = !(S.zip && navigator.canShare && navigator.canShare({ files: [new File([S.zip.blob], S.zip.name, { type: 'application/zip' })] }));
  }
  function kmlDoc(pts, imgPath) {
    const pm = pts.map((p, i) => {
      const imgs = p.photos.map((_, k) => `<p><img src="${imgPath(i, k)}" width="480"/></p>`).join('');
      const when = new Date(p.photos[0] ? p.photos[0].takenAt : p.createdAt).toISOString();
      return `<Placemark><name>${esc(`${i + 1}. ${p.name}`)}</name><styleUrl>#pt</styleUrl><TimeStamp><when>${when}</when></TimeStamp>
<description><![CDATA[<p>${esc(p.desc).replace(/\]\]>/g, '')}</p><p>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</p>${imgs}]]></description>
<Point><coordinates>${p.lng},${p.lat},0</coordinates></Point></Placemark>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(S.settings.project || 'Visita de campo')}</name>
<Style id="pt"><IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon></IconStyle></Style>
${pm}
</Document></kml>`;
  }
  async function buildZip() {
    if (!S.points.length) return;
    const optOrig = $('#optOrig').checked, optKmz = $('#optKmz').checked;
    const pts = sortedPoints(), zip = new JSZip(), kmz = optKmz ? new JSZip() : null;
    const csv = ['id;nombre;descripcion;latitud;longitud;fecha_hora;num_fotos;fotos'];
    const geo = { type: 'FeatureCollection', features: [] };
    const fname = (i, k, p) => `${String(i + 1).padStart(2, '0')}_${slug(p.name)}_${k + 1}.jpg`;
    const total = pts.reduce((a, p) => a + p.photos.length, 0); let done = 0;
    busy('Armando paquete…', 0);
    try {
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], names = [];
        for (let k = 0; k < p.photos.length; k++) {
          const ph = p.photos[k], n = fname(i, k, p); names.push(n);
          const data = ph.marked || ph.orig;
          zip.file('fotos/' + n, data, { compression: 'STORE' });
          if (optOrig) zip.file('fotos_originales/' + n, ph.orig, { compression: 'STORE' });
          if (kmz) kmz.file('files/' + n, data, { compression: 'STORE' });
          busy(`Agregando fotos (${++done}/${total})…`, Math.round(done / Math.max(1, total) * 60));
          if (done % 5 === 0) await sleep(0);
        }
        const when = Watermark.fmtDate(p.photos[0] ? p.photos[0].takenAt : p.createdAt);
        csv.push([i + 1, p.name, p.desc, p.lat.toFixed(7), p.lng.toFixed(7), when, names.length, names.join(' | ')].map(csvCell).join(';'));
        geo.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: i + 1, nombre: p.name, descripcion: p.desc, fecha_hora: when, fotos: names.map(n => 'fotos/' + n) } });
      }
      zip.file('puntos.kml', kmlDoc(pts, (i, k) => 'fotos/' + fname(i, k, pts[i])), { compression: 'DEFLATE' });
      zip.file('puntos.geojson', JSON.stringify(geo, null, 1), { compression: 'DEFLATE' });
      zip.file('puntos.csv', '\ufeff' + csv.join('\r\n'), { compression: 'DEFLATE' });
      if (kmz) {
        kmz.file('doc.kml', kmlDoc(pts, (i, k) => 'files/' + fname(i, k, pts[i])));
        busy('Generando KMZ…', 65);
        const kb = await kmz.generateAsync({ type: 'blob', compression: 'STORE' });
        zip.file('puntos.kmz', kb, { compression: 'STORE' });
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, m => busy('Comprimiendo…', 70 + Math.round(m.percent * 0.3)));
      const proj = S.settings.project ? slug(S.settings.project) + '_' : '';
      S.zip = { blob, name: `campo_${proj}${stampName()}.zip` };
    } catch (e) { console.error(e); toast('No se pudo generar el ZIP: ' + e.message, 6000); }
    unbusy(); renderExport();
  }
  function downloadZip() {
    if (!S.zip) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(S.zip.blob); a.download = S.zip.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  async function shareZip() {
    try { await navigator.share({ files: [new File([S.zip.blob], S.zip.name, { type: 'application/zip' })], title: S.zip.name }); }
    catch (e) { if (e.name !== 'AbortError') toast('No se pudo compartir; usa «Descargar»', 4000); }
  }
  async function wipePoints() {
    if (!S.points.length) return;
    if (!confirm('¿Borrar TODOS los puntos y fotos de este dispositivo? Asegúrate de haber descargado el ZIP.')) return;
    await DB.clear('points'); await DB.del('meta', 'draft');
    S.points = []; S.zip = null; refreshMarkers(); renderExport(); toast('Puntos borrados');
  }

  /* ---------- Ajustes ---------- */
  function renderSettings() {
    $('#sProject').value = S.settings.project;
    $('#sZoom').value = S.settings.zoomMini; $('#sZoomVal').textContent = S.settings.zoomMini;
    $('#sMaxPx').value = String(S.settings.maxPx);
    $('#btnInstall').hidden = !S.installEvt;
  }

  /* ---------- Eventos ---------- */
  function bind() {
    $$('#bottomnav button').forEach(b => b.onclick = () => {
      const id = b.dataset.sheet;
      if (!$('#' + id).hidden) closeSheets(); else openSheet(id);
    });
    $$('[data-close]').forEach(b => b.onclick = closeSheets);
    $('#scrim').onclick = () => { if ($('#sheetPoint').hidden) closeSheets(); };
    $('#btnAdd').onclick = newPoint;
    $('#btnLocate').onclick = () => { if (S.gps) S.map.setView([S.gps.lat, S.gps.lng], Math.max(S.map.getZoom(), 17)); else toast('Aún no hay señal GPS'); };
    $('#btnBase').onclick = () => setBase(S.baseKey === 'sat' ? 'osm' : 'sat');

    $('#inLayer').onchange = e => { const f = Array.from(e.target.files); e.target.value = ''; addLayerFiles(f); };

    $('#fName').oninput = () => { if (S.draft) { S.draft.name = $('#fName').value; persistDraft(); } };
    $('#fName').onchange = renderPhotos;
    $('#fDesc').oninput = () => { if (S.draft) { S.draft.desc = $('#fDesc').value; persistDraft(); } };
    $('#locGps').onclick = useGps; $('#locCenter').onclick = useCenter; $('#locPick').onclick = startPick;
    $('#pickOk').onclick = () => endPick(true); $('#pickCancel').onclick = () => endPick(false);
    $('#btnCam').onclick = () => $('#inCam').click();
    $('#btnGal').onclick = () => $('#inGal').click();
    $('#inCam').onchange = e => { const f = Array.from(e.target.files); e.target.value = ''; addPhotos(f, true); };
    $('#inGal').onchange = e => { const f = Array.from(e.target.files); e.target.value = ''; addPhotos(f, false); };
    $('#btnSave').onclick = savePoint; $('#btnCancel').onclick = cancelForm; $('#btnDelete').onclick = deletePoint;

    $('#viewerClose').onclick = () => { $('#viewer').hidden = true; };
    $('#viewerDel').onclick = () => {
      const v = $('#viewer'); if (!confirm('¿Quitar esta foto?')) return;
      S.draft.photos.splice(v._i, 1); v.hidden = true; renderPhotos(); persistDraft(true);
    };

    $('#btnZip').onclick = buildZip; $('#btnDownload').onclick = downloadZip; $('#btnShare').onclick = shareZip;
    $('#btnWipe').onclick = wipePoints;

    $('#sProject').oninput = e => { S.settings.project = e.target.value.trim(); saveSettings(); };
    $('#sZoom').oninput = e => { S.settings.zoomMini = +e.target.value; $('#sZoomVal').textContent = e.target.value; saveSettings(); };
    $('#sMaxPx').onchange = e => { S.settings.maxPx = +e.target.value; saveSettings(); };
    $('#btnInstall').onclick = async () => { if (!S.installEvt) return; S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; $('#btnInstall').hidden = true; };
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });

    const net = () => { $('#netChip').hidden = navigator.onLine; };
    window.addEventListener('online', net); window.addEventListener('offline', net); net();
  }

  /* ---------- Arranque ---------- */
  async function init() {
    initMap(); bind();
    try { await DB.open(); } catch (e) { toast('No se pudo abrir el almacenamiento local: ' + e.message, 8000); return; }
    S.layers = await DB.all('layers'); S.layers.sort((a, b) => a.createdAt - b.createdAt);
    S.layers.forEach(drawLayer);
    S.points = await DB.all('points'); refreshMarkers();
    if (S.layers.some(l => l.visible)) fitAll();
    else if (S.points.length) S.map.setView([S.points[0].lat, S.points[0].lng], 16);
    startGps();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
    // recuperar un punto sin guardar (p. ej. si el navegador se recargó al volver de la cámara)
    const m = await DB.get('meta', 'draft');
    if (m && m.v && m.v.photos) { S.draft = m.v; toast('Se recuperó un punto sin guardar'); openForm(); }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  init();
  window.__campo = S; // útil para depuración
})();
