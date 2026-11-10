/* JMaps M&A · ERCO — lógica principal
   v1.5: rumbo de la foto, observaciones estructuradas, protección de datos, recorridos GPS y mapa sin conexión */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ic = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const MAX_PHOTOS = 10, MIN_SLOTS = 4;
  // Colores de capas: de la paleta de marca (complementarios + amarillo/lima) para que contrasten sobre satélite
  const PALETTE = ['#F99207', '#00B7D3', '#E3DD16', '#F53333', '#BDE732', '#FFFFFF'];
  const DEFAULT_CATS = ['General', 'Infraestructura eléctrica', 'Acceso y vías', 'Ambiental', 'Social / comunidad', 'Predial / linderos', 'Riesgo o amenaza'];
  const DEFAULTS = { project: '', zoomMini: 17, maxPx: 1600, wmStyle: 'card', showHeading: true, cats: DEFAULT_CATS.join('\n') };
  // Nivel de la observación (relevancia / riesgo): color del pin y de la etiqueta en la marca de agua
  const LEVELS = { alto: { name: 'Alto', color: '#F53333' }, medio: { name: 'Medio', color: '#F99207' }, bajo: { name: 'Bajo', color: '#45A824' } };
  const TRACK_COLOR = '#00B7D3';
  const REMIND_HOURS = 24;

  const S = {
    map: null, baseKey: localStorage.getItem('campo.base') || 'sat', baseLayer: null,
    layers: [], leaf: {}, points: [], markers: {},
    gps: null, gpsDot: null, gpsCircle: null, firstFix: false, gpsWatch: null, gpsDenied: false,
    settings: loadSettings(), draft: null, urls: [], thumbUrls: [], zip: null, installEvt: null, picking: false,
    tracks: [], trackLines: {}, rec: null, wake: null, filter: { lvl: '', cat: '' }, dl: null
  };
  const cats = () => {
    const l = S.settings.cats.split('\n').map(x => x.trim()).filter(Boolean);
    return l.length ? l : DEFAULT_CATS;
  };
  const isPending = p => !p.exportedAt || (p.updatedAt || p.createdAt) > p.exportedAt;
  const fmtKm = m => m >= 1000 ? `${(m / 1000).toFixed(2).replace('.', ',')} km` : `${Math.round(m)} m`;
  const fmtDur = ms => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  function haversine(a, b) { // [lng,lat] -> metros
    const R = 6371000, r = Math.PI / 180, dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

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
    if (id === 'sheetExport') { renderExport(); renderStorage(); }
    if (id === 'sheetLayers') renderOffline();
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
    // el botón muestra a qué mapa se cambiará al tocarlo
    const next = key === 'sat' ? 'osm' : 'sat';
    const b = $('#btnBase');
    b.innerHTML = ic(next === 'osm' ? 'map' : 'globe');
    b.title = b.ariaLabel = `Cambiar a mapa ${BASEMAPS[next].name.toLowerCase()}`;
  }

  /* ---------- GPS ---------- */
  const GPS_OPTS = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };

  function setChip(text, cls) {
    const c = $('#gpsChip'); c.className = 'chip ' + cls;
    c.innerHTML = `<i class="dot"></i><span>${esc(text)}</span>`;
  }

  function onGps(pos) {
    const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
    S.gps = { lat, lng, acc, t: Date.now() }; S.gpsDenied = false;
    if (S.rec) addTrackFix(lng, lat, acc, pos.timestamp || Date.now());
    setChip(`GPS ±${Math.round(acc)} m`, acc <= 15 ? 'ok' : acc <= 50 ? 'warn' : 'bad');
    $('#gpsBanner').hidden = true;
    if (!S.gpsDot) {
      S.gpsDot = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="gps-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: -100 }).addTo(S.map);
      S.gpsCircle = L.circle([lat, lng], { radius: acc, color: '#00B7D3', weight: 1, fillOpacity: .1, interactive: false }).addTo(S.map);
    } else { S.gpsDot.setLatLng([lat, lng]); S.gpsCircle.setLatLng([lat, lng]).setRadius(acc); }
    if (!S.firstFix) { S.firstFix = true; if (!S.layers.some(l => l.visible) && !S.points.length) S.map.setView([lat, lng], 16); }
  }

  function onGpsErr(err, manual) {
    if (err.code === 1) { // permiso denegado o servicios de localización apagados
      S.gpsDenied = true;
      setChip('GPS bloqueado', 'bad');
      $('#gpsBannerText').textContent = 'La ubicación está bloqueada. Toca «Ver cómo» para activarla.';
      $('#gpsBannerBtn').textContent = 'Ver cómo';
      $('#gpsBanner').hidden = false;
      if (manual) openGpsHelp();
    } else {
      // con un fix reciente ignoramos timeouts aislados del seguimiento continuo
      if (S.gps && Date.now() - S.gps.t < 120000) return;
      setChip('GPS sin señal', 'warn');
      if (manual) toast('Aún no hay señal GPS. Sal a cielo abierto y vuelve a intentar.', 4500);
    }
  }

  function watchGps() {
    if (S.gpsWatch != null || !navigator.geolocation) return;
    S.gpsWatch = navigator.geolocation.watchPosition(onGps, e => onGpsErr(e, false), { enableHighAccuracy: true, maximumAge: 5000, timeout: 60000 });
  }

  /* Pide la ubicación. Si se llama desde un toque del usuario, iOS/Android muestran el aviso de permiso. */
  function requestGps(manual) {
    if (!navigator.geolocation) {
      setChip('GPS no disponible', 'bad'); if (manual) toast('Este navegador no tiene GPS'); return;
    }
    if (S.gpsWatch != null) { navigator.geolocation.clearWatch(S.gpsWatch); S.gpsWatch = null; }
    setChip('Buscando GPS…', 'warn');
    navigator.geolocation.getCurrentPosition(
      pos => { onGps(pos); watchGps(); },
      err => { onGpsErr(err, manual); if (err.code !== 1) watchGps(); },
      GPS_OPTS
    );
  }

  function openGpsHelp() {
    const body = IS_IOS ? `
      <p>En iPhone, si la ubicación ya fue bloqueada, solo se activa desde Ajustes:</p>
      <ol>
        <li><b>Ajustes → Privacidad y seguridad → Servicios de localización</b>: debe estar <b>activado</b>.</li>
        <li>En esa lista entra a <b>Sitios web de Safari</b> y elige <b>Mientras se usa la app</b> (o «Preguntar la próxima vez»). Activa <b>Ubicación precisa</b>.</li>
        <li>Si instalaste la app en la pantalla de inicio, es posible que aparezca en esa misma lista con su nombre: configúrala igual.</li>
        <li>Si la abres desde Safari: toca <b>aA</b> en la barra de direcciones → <b>Configuración del sitio web → Ubicación → Preguntar o Permitir</b>.</li>
        <li>Vuelve a la app y toca <b>Reintentar</b>.</li>
      </ol>
      <p class="hint">Los nombres exactos pueden variar un poco según tu versión de iOS.</p>` : `
      <p>En Android, activa el permiso de ubicación:</p>
      <ol>
        <li>Toca el <b>candado</b> (o el ícono de ajustes) junto a la dirección → <b>Permisos → Ubicación → Permitir</b>.</li>
        <li>Verifica que la <b>ubicación del teléfono</b> esté encendida (panel rápido, ícono de «Ubicación»).</li>
        <li>Si instalaste la app: <b>Ajustes de Android → Apps → JMaps M&amp;A → Permisos → Ubicación → Permitir</b>.</li>
        <li>Vuelve a la app y toca <b>Reintentar</b>.</li>
      </ol>`;
    $('#gpsHelpBody').innerHTML = body;
    $('#gpsHelp').hidden = false;
  }

  function startGps() {
    $('#gpsChip').onclick = () => requestGps(true);
    $('#gpsBannerBtn').onclick = () => requestGps(true);
    $('#gpsRetry').onclick = () => { $('#gpsHelp').hidden = true; requestGps(true); };
    $('#gpsHelpClose').onclick = () => { $('#gpsHelp').hidden = true; };
    // al volver de Ajustes, reintenta solo
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (!S.gps || S.gpsDenied)) requestGps(false);
    });
    let granted = false;
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(st => {
        granted = st.state === 'granted';
        if (!granted) $('#gpsBanner').hidden = !!S.gps;
        st.onchange = () => { if (st.state === 'granted' && !S.gps) requestGps(false); };
      }).catch(() => { });
    }
    // intento automático (en Android muestra el aviso); si no hay fix, el banner invita a tocar «Activar»
    requestGps(false);
    setTimeout(() => { if (!S.gps && !granted) $('#gpsBanner').hidden = false; }, 1200);
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
        <button class="ico" data-a="zoom" title="Ir a la capa" aria-label="Ir a la capa">${ic('zoom')}</button>
        <button class="ico" data-a="del" title="Eliminar" aria-label="Eliminar">${ic('trash')}</button>`;
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
  function visibleLayers() {
    const out = S.layers.filter(l => l.visible).map(l => ({ name: l.name, color: l.color, features: l.features }));
    const feats = [];
    S.tracks.filter(t => t.visible).forEach(t => t.segs.forEach(sg => {
      if (sg.length < 2) return;
      const c = sg.map(p => [p[0], p[1]]);
      const b = c.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[0]), Math.max(a[3], q[1])], [180, 90, -180, -90]);
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c }, bbox: b });
    }));
    if (feats.length) out.push({ name: 'Recorrido', color: TRACK_COLOR, features: feats });
    return out;
  }

  /* ---------- Puntos (mapa + lista) ---------- */
  const sortedPoints = () => S.points.slice().sort((a, b) => a.createdAt - b.createdAt);
  function refreshMarkers() {
    Object.values(S.markers).forEach(m => m.remove()); S.markers = {};
    sortedPoints().forEach((p, i) => {
      const lv = LEVELS[p.level];
      const icon = L.divIcon({ className: '', html: `<div class="pin${lv ? ' lvl-' + p.level : ''}"><span>${i + 1}</span></div>`, iconSize: [34, 34], iconAnchor: [17, 40] });
      const m = L.marker([p.lat, p.lng], { icon, zIndexOffset: 1000 }).addTo(S.map);
      m.on('click', () => openPoint(p.id));
      S.markers[p.id] = m;
    });
    const b = $('#ptBadge'); b.hidden = !S.points.length; b.textContent = S.points.length;
    updatePendingBadge();
  }
  function renderPoints() {
    S.thumbUrls.forEach(URL.revokeObjectURL); S.thumbUrls = [];
    const box = $('#pointList'); box.innerHTML = '';
    renderFilters();
    if (!S.points.length) { box.innerHTML = '<p class="empty">Todavía no hay puntos. Usa «Punto» en el mapa.</p>'; return; }
    const f = S.filter; let shown = 0;
    sortedPoints().forEach((p, i) => {
      if ((f.lvl && (p.level || 'none') !== f.lvl) || (f.cat && p.cat !== f.cat)) return;
      shown++;
      const ph = p.photos[0]; let url = '';
      if (ph) { url = URL.createObjectURL(ph.marked || ph.orig); S.thumbUrls.push(url); }
      const row = document.createElement('div'); row.className = 'row pt';
      row.innerHTML = `${url ? `<img class="thumb" src="${url}" alt="">` : '<div class="thumb"></div>'}
        <div class="grow"><b><span class="num">${i + 1}</span>${esc(p.name)}</b>
        <small>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} · ${p.photos.length} foto(s)</small>
        <span class="tags">${p.cat ? `<i class="tag">${esc(p.cat)}</i>` : ''}${LEVELS[p.level] ? `<i class="tag lvl" style="--c:${LEVELS[p.level].color}">${LEVELS[p.level].name}</i>` : ''}${isPending(p) ? '<i class="tag pend">Sin exportar</i>' : ''}</span></div>
        <button class="ico" data-a="map" title="Ver en el mapa" aria-label="Ver en el mapa">${ic('pin')}</button>`;
      row.onclick = e => { if (e.target.closest('[data-a=map]')) { closeSheets(); S.map.setView([p.lat, p.lng], Math.max(S.map.getZoom(), 18)); } else openPoint(p.id); };
      box.appendChild(row);
    });
    if (!shown) box.innerHTML = '<p class="empty">Ningún punto coincide con el filtro.</p>';
  }
  function renderFilters() {
    const used = [...new Set(S.points.map(p => p.cat).filter(Boolean))];
    const cnt = k => S.points.filter(p => (p.level || 'none') === k).length;
    const chip = (v, txt, n) => `<button class="fchip${S.filter.lvl === v ? ' on' : ''}" data-l="${v}">${txt}${n != null ? ` <b>${n}</b>` : ''}</button>`;
    $('#pointFilters').hidden = !S.points.length;
    $('#lvlFilter').innerHTML = chip('', 'Todos', S.points.length) + Object.entries(LEVELS).map(([k, v]) => chip(k, `<i class="sw" style="--c:${v.color}"></i>${v.name}`, cnt(k))).join('') + (cnt('none') ? chip('none', 'Sin nivel', cnt('none')) : '');
    $$('#lvlFilter button').forEach(b => b.onclick = () => { S.filter.lvl = b.dataset.l; renderPoints(); });
    const sel = $('#catFilter');
    sel.innerHTML = '<option value="">Todas las categorías</option>' + used.map(c => `<option${c === S.filter.cat ? ' selected' : ''}>${esc(c)}</option>`).join('');
    if (S.filter.cat && !used.includes(S.filter.cat)) S.filter.cat = '';
  }

  /* ---------- Formulario de punto ---------- */
  const sigOf = d => `${d.name}|${d.lat.toFixed(7)}|${d.lng.toFixed(7)}|${d.cat || ''}|${d.level || ''}`;
  // firma por foto: si cambia el punto o el rumbo de esa foto, se vuelve a marcar
  const photoSig = (d, ph) => `${sigOf(d)}|${S.settings.showHeading && ph.heading != null ? ph.heading : '-'}`;
  const liveDraft = () => ({ ...S.draft, name: $('#fName').value.trim() || S.draft.name });
  let persistT;
  function persistDraft(now) {
    clearTimeout(persistT);
    const run = () => { if (S.draft) DB.put('meta', { k: 'draft', v: S.draft }).catch(() => { }); };
    if (now) run(); else persistT = setTimeout(run, 400);
  }
  function newPoint() {
    if (S.settings.showHeading) Compass.start(); // toque del usuario: en iPhone pide permiso de brújula
    const loc = S.gps ? { lat: S.gps.lat, lng: S.gps.lng, acc: S.gps.acc, src: 'gps' } : { lat: S.map.getCenter().lat, lng: S.map.getCenter().lng, src: 'center' };
    S.draft = { id: uid(), isNew: true, name: `Punto ${S.points.length + 1}`, desc: '', cat: '', level: '', createdAt: Date.now(), photos: [], ...loc };
    openForm();
  }
  function openPoint(id) {
    const p = S.points.find(x => x.id === id); if (!p) return;
    if (S.settings.showHeading) Compass.start();
    S.draft = { id: p.id, isNew: false, name: p.name, desc: p.desc, cat: p.cat || '', level: p.level || '', exportedAt: p.exportedAt || null, lat: p.lat, lng: p.lng, src: 'saved', createdAt: p.createdAt, photos: p.photos.map(x => ({ ...x })) };
    openForm();
  }
  function openForm() {
    const d = S.draft;
    $('#pointTitle').textContent = d.isNew ? 'Nuevo punto' : 'Editar punto';
    $('#fName').value = d.name; $('#fDesc').value = d.desc;
    const cl = cats(); if (d.cat && !cl.includes(d.cat)) cl.push(d.cat);
    $('#fCat').innerHTML = '<option value="">Sin categoría</option>' + cl.map(c => `<option${c === d.cat ? ' selected' : ''}>${esc(c)}</option>`).join('');
    renderLevel();
    $('#btnDelete').hidden = d.isNew;
    updateCoords(); renderPhotos();
    openSheet('sheetPoint');
    persistDraft(true);
  }
  function renderLevel() {
    $$('#fLevel button').forEach(b => b.classList.toggle('on', (b.dataset.v || '') === (S.draft.level || '')));
  }
  function updateCoords() {
    const d = S.draft;
    const src = d.src === 'gps' ? ` · GPS ±${Math.round(d.acc || 0)} m` : d.src === 'center' ? ' · centro del mapa' : d.src === 'map' ? ' · elegido en el mapa' : '';
    $('#fCoords').textContent = `${d.lat.toFixed(6)}, ${d.lng.toFixed(6)}${src}`;
  }
  function renderPhotos() {
    S.urls.forEach(URL.revokeObjectURL); S.urls = [];
    const d = S.draft, grid = $('#photoGrid'); grid.innerHTML = '';
    const ld = liveDraft();
    const slots = Math.min(MAX_PHOTOS, Math.max(MIN_SLOTS, d.photos.length + 1));
    for (let i = 0; i < slots; i++) {
      const ph = d.photos[i], el = document.createElement('div');
      if (ph) {
        const url = URL.createObjectURL(ph.marked || ph.orig); S.urls.push(url);
        const done = ph.marked && ph.markedFor === photoSig(ld, ph);
        el.className = 'slot filled';
        const hd = S.settings.showHeading ? `<span class="hd ${ph.heading == null ? 'none' : ''}">${ph.heading == null ? 'Sin rumbo' : Compass.label(ph.heading)}</span>` : '';
        el.innerHTML = `<img src="${url}" alt="Foto ${i + 1}">${hd}<span class="badge ${done ? 'ok' : ''}">${done ? 'Marcada' : 'Pendiente'}</span>`;
        el.onclick = () => showViewer(i);
      } else {
        el.className = 'slot'; el.innerHTML = ic('plus');
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
        // rumbo: 1) el que trae la foto (EXIF)  2) si viene de la cámara, la brújula justo al volver
        let heading = null, headingSrc = null;
        const ex = await Exif.readHeading(f);
        if (ex) { heading = Math.round(ex.heading); headingSrc = 'exif'; }
        else if (fromCamera && S.settings.showHeading) {
          busy('Leyendo brújula… mantén el celular hacia donde tomaste la foto');
          heading = await Compass.sample(1000); headingSrc = heading != null ? 'auto' : null;
          busy('Procesando foto…');
        }
        const orig = await Watermark.resizeImage(f, S.settings.maxPx, 0.9);
        d.photos.push({ id: uid(), takenAt: fromCamera ? Date.now() : (f.lastModified || Date.now()), orig, marked: null, markedFor: null, heading, headingSrc });
      }
    } catch (e) { toast('No se pudo leer la foto: ' + e.message, 4500); }
    unbusy(); renderPhotos(); persistDraft(true);
  }
  const HSRC = { exif: 'de la foto', auto: 'brújula al tomarla', manual: 'fijado a mano' };
  function renderViewerHeading() {
    const v = $('#viewer'), ph = S.draft && S.draft.photos[v._i]; if (!ph) return;
    $('#vhBox').hidden = !S.settings.showHeading;
    $('#vhVal').textContent = ph.heading == null ? 'Sin rumbo' : `${Compass.label(ph.heading)} (${HSRC[ph.headingSrc] || ''})`;
    $('#vhClear').hidden = ph.heading == null;
  }
  function showViewer(i) {
    const ph = S.draft.photos[i]; if (!ph) return;
    const done = ph.marked && ph.markedFor === photoSig(liveDraft(), ph);
    const v = $('#viewer'); v._i = i;
    if (v._url) URL.revokeObjectURL(v._url);
    v._url = URL.createObjectURL(ph.marked || ph.orig);
    $('#viewerImg').src = v._url;
    $('#viewerNote').textContent = done ? 'Foto con marca de agua' : 'Vista previa sin marca: se aplicará al guardar el punto';
    v.hidden = false;
    renderViewerHeading(); $('#vhLive').textContent = '';
  }
  async function fixHeading() {
    const ok = await Compass.start();
    if (!ok) { toast('La brújula no está disponible o no tiene permiso en este navegador', 4500); return; }
    const btn = $('#vhFix'); btn.disabled = true;
    const off = Compass.subscribe(h => { $('#vhLive').textContent = `Ahora: ${Compass.label(h)}`; });
    await sleep(1200); // deja ver la lectura en vivo antes de fijar
    const h = await Compass.sample(800); off(); btn.disabled = false;
    if (h == null) { toast('No llegó lectura de la brújula. Mueve el celular en forma de 8 y reintenta.', 5000); return; }
    const ph = S.draft.photos[$('#viewer')._i];
    ph.heading = h; ph.headingSrc = 'manual';
    $('#vhLive').textContent = '';
    renderViewerHeading(); renderPhotos(); persistDraft(true);
    toast(`Rumbo fijado: ${Compass.label(h)}`);
  }
  function useGps() {
    if (!S.gps) { requestGps(true); return; }
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
    d.name = $('#fName').value.trim(); d.desc = $('#fDesc').value.trim(); d.cat = $('#fCat').value;
    if (!d.name) { toast('Escribe el nombre del punto'); $('#fName').focus(); return; }
    const need = d.photos.filter(p => !p.marked || p.markedFor !== photoSig(d, p));
    const lv = LEVELS[d.level];
    const tag = [d.cat, lv && `Nivel ${lv.name.toLowerCase()}`].filter(Boolean).join(' · ');
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
          const heading = S.settings.showHeading && ph.heading != null ? ph.heading : null;
          ph.marked = await Watermark.compose(ph.orig, {
            minimap: mini.canvas, legend: mini.legend, name: d.name, lat: d.lat, lng: d.lng, takenAt: ph.takenAt,
            project: S.settings.project, style: S.settings.wmStyle, heading, tag, tagColor: lv ? lv.color : null
          });
          ph.markedFor = photoSig(d, ph);
        }
      }
      const rec = {
        id: d.id, name: d.name, desc: d.desc, cat: d.cat || '', level: d.level || '', lat: d.lat, lng: d.lng,
        createdAt: d.createdAt, updatedAt: Date.now(), exportedAt: d.exportedAt || null,
        photos: d.photos.map(({ id, takenAt, orig, marked, markedFor, heading, headingSrc }) => ({ id, takenAt, orig, marked, markedFor, heading: heading == null ? null : heading, headingSrc: headingSrc || null }))
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

  function exportSet() {
    const all = sortedPoints().map((p, i) => ({ p, n: i + 1 })); // la numeración siempre es la global
    return $('#optPending').checked ? all.filter(x => isPending(x.p)) : all;
  }
  function renderExport() {
    const pend = S.points.filter(isPending).length;
    $('#optPendingN').textContent = pend;
    $('#optPending').disabled = !pend || pend === S.points.length;
    if ($('#optPending').disabled) $('#optPending').checked = false;
    const set = exportSet();
    const np = set.length, nf = set.reduce((a, x) => a + x.p.photos.length, 0);
    const mb = set.reduce((a, x) => a + x.p.photos.reduce((b, f) => b + (f.marked || f.orig).size, 0), 0) / 1048576;
    const nt = S.tracks.filter(t => t.endedAt && t.segs.some(sg => sg.length > 1)).length;
    $('#exportSummary').innerHTML = `<b>${np}</b> punto(s) · <b>${nf}</b> foto(s) · aprox. <b>${mb.toFixed(1)} MB</b>${nt ? ` · <b>${nt}</b> recorrido(s)` : ''}
      <div class="pend-line ${pend ? 'warn' : 'ok'}">${pend ? `${pend} punto(s) sin exportar todavía` : 'Todo está exportado'}</div>`;
    $('#btnZip').disabled = !np && !nt; $('#zipResult').hidden = !S.zip;
    if (S.zip) $('#zipInfo').innerHTML = `<b>${esc(S.zip.name)}</b><br><small>${(S.zip.blob.size / 1048576).toFixed(1)} MB</small>`;
    $('#btnShare').hidden = !(S.zip && navigator.canShare && navigator.canShare({ files: [new File([S.zip.blob], S.zip.name, { type: 'application/zip' })] }));
  }
  const KML_ICON = { alto: 'red-circle', medio: 'orange-circle', bajo: 'grn-circle', '': 'wht-circle' };
  function kmlDoc(set, imgPath, tracks) {
    const pm = set.map(({ p, n }, i) => {
      const imgs = p.photos.map((ph, k) => `<p><img src="${imgPath(i, k)}" width="480"/>${ph.heading != null ? `<br>Rumbo: ${Compass.label(ph.heading)}` : ''}</p>`).join('');
      const when = new Date(p.photos[0] ? p.photos[0].takenAt : p.createdAt).toISOString();
      const lv = LEVELS[p.level];
      return `<Placemark><name>${esc(`${n}. ${p.name}`)}</name><styleUrl>#pt-${p.level || 'none'}</styleUrl><TimeStamp><when>${when}</when></TimeStamp>
<ExtendedData><Data name="categoria"><value>${esc(p.cat || '')}</value></Data><Data name="nivel"><value>${lv ? lv.name : ''}</value></Data></ExtendedData>
<description><![CDATA[${p.cat || lv ? `<p><b>${esc([p.cat, lv && 'Nivel ' + lv.name.toLowerCase()].filter(Boolean).join(' · '))}</b></p>` : ''}<p>${esc(p.desc).replace(/\]\]>/g, '')}</p><p>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</p>${imgs}]]></description>
<Point><coordinates>${p.lng},${p.lat},0</coordinates></Point></Placemark>`;
    }).join('\n');
    const styles = ['alto', 'medio', 'bajo', ''].map(k => `<Style id="pt-${k || 'none'}"><IconStyle><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/${KML_ICON[k]}.png</href></Icon></IconStyle></Style>`).join('\n');
    const trk = tracks.length ? `<Folder><name>Recorridos</name>\n${tracks.map(t => `<Placemark><name>${esc(t.name)}</name><description>${fmtKm(t.dist)} · ${fmtDur((t.endedAt || Date.now()) - t.createdAt)}</description><styleUrl>#trk</styleUrl><MultiGeometry>${t.segs.filter(sg => sg.length > 1).map(sg => `<LineString><tessellate>1</tessellate><coordinates>${sg.map(q => `${q[0]},${q[1]},0`).join(' ')}</coordinates></LineString>`).join('')}</MultiGeometry></Placemark>`).join('\n')}\n</Folder>` : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(S.settings.project || 'Visita de campo')}</name>
${styles}
<Style id="trk"><LineStyle><color>ffd3b700</color><width>4</width></LineStyle></Style>
${pm}
${trk}
</Document></kml>`;
  }
  function gpxDoc(tracks) {
    const iso = t => new Date(t).toISOString();
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="JMaps M&amp;A · ERCO" xmlns="http://www.topografix.com/GPX/1/1">
${tracks.map(t => `<trk><name>${esc(t.name)}</name>${t.segs.filter(sg => sg.length > 1).map(sg => `<trkseg>${sg.map(q => `<trkpt lat="${q[1]}" lon="${q[0]}"><time>${iso(q[2])}</time></trkpt>`).join('')}</trkseg>`).join('')}</trk>`).join('\n')}
</gpx>`;
  }
  async function buildZip() {
    const set = exportSet();
    const tracks = S.tracks.filter(t => t.endedAt && t.segs.some(sg => sg.length > 1)).sort((a, b) => a.createdAt - b.createdAt);
    if (!set.length && !tracks.length) return;
    const optOrig = $('#optOrig').checked, optKmz = $('#optKmz').checked;
    const zip = new JSZip(), kmz = optKmz ? new JSZip() : null;
    const csv = ['id;nombre;categoria;nivel;descripcion;latitud;longitud;fecha_hora;num_fotos;fotos;rumbos'];
    const geo = { type: 'FeatureCollection', features: [] };
    const fname = (x, k) => `${String(x.n).padStart(2, '0')}_${slug(x.p.name)}_${k + 1}.jpg`;
    const total = set.reduce((a, x) => a + x.p.photos.length, 0); let done = 0;
    busy('Armando paquete…', 0);
    try {
      for (const x of set) {
        const p = x.p, names = [];
        for (let k = 0; k < p.photos.length; k++) {
          const ph = p.photos[k], n = fname(x, k); names.push(n);
          const data = ph.marked || ph.orig;
          zip.file('fotos/' + n, data, { compression: 'STORE' });
          if (optOrig) zip.file('fotos_originales/' + n, ph.orig, { compression: 'STORE' });
          if (kmz) kmz.file('files/' + n, data, { compression: 'STORE' });
          busy(`Agregando fotos (${++done}/${total})…`, Math.round(done / Math.max(1, total) * 60));
          if (done % 5 === 0) await sleep(0);
        }
        const when = Watermark.fmtDate(p.photos[0] ? p.photos[0].takenAt : p.createdAt);
        const lv = LEVELS[p.level] ? LEVELS[p.level].name : '';
        const rumbos = p.photos.map((ph, k) => `${k + 1}: ${ph.heading != null ? Compass.label(ph.heading) : '—'}`).join(' | ');
        csv.push([x.n, p.name, p.cat || '', lv, p.desc, p.lat.toFixed(7), p.lng.toFixed(7), when, names.length, names.join(' | '), rumbos].map(csvCell).join(';'));
        geo.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: {
          id: x.n, nombre: p.name, categoria: p.cat || '', nivel: lv, descripcion: p.desc, fecha_hora: when,
          fotos: names.map(n => 'fotos/' + n), rumbos_grados: p.photos.map(ph => ph.heading == null ? null : ph.heading) } });
      }
      tracks.forEach(t => geo.features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: t.segs.filter(sg => sg.length > 1).map(sg => sg.map(q => [q[0], q[1]])) },
        properties: { tipo: 'recorrido', nombre: t.name, distancia_m: Math.round(t.dist), inicio: new Date(t.createdAt).toISOString(), fin: new Date(t.endedAt).toISOString() } }));
      zip.file('puntos.kml', kmlDoc(set, (i, k) => 'fotos/' + fname(set[i], k), tracks), { compression: 'DEFLATE' });
      zip.file('puntos.geojson', JSON.stringify(geo, null, 1), { compression: 'DEFLATE' });
      zip.file('puntos.csv', '\ufeff' + csv.join('\r\n'), { compression: 'DEFLATE' });
      if (tracks.length) zip.file('recorridos.gpx', gpxDoc(tracks), { compression: 'DEFLATE' });
      if (kmz) {
        kmz.file('doc.kml', kmlDoc(set, (i, k) => 'files/' + fname(set[i], k), tracks));
        busy('Generando KMZ…', 65);
        const kb = await kmz.generateAsync({ type: 'blob', compression: 'STORE' });
        zip.file('puntos.kmz', kb, { compression: 'STORE' });
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, m => busy('Comprimiendo…', 70 + Math.round(m.percent * 0.3)));
      const proj = S.settings.project ? slug(S.settings.project) + '_' : '';
      S.zip = { blob, name: `JMaps_MA_${proj}${stampName()}${$('#optPending').checked ? '_nuevos' : ''}.zip`, ids: set.map(x => x.p.id) };
    } catch (e) { console.error(e); toast('No se pudo generar el ZIP: ' + e.message, 6000); }
    unbusy(); renderExport();
  }
  /* Al descargar o compartir, los puntos del ZIP quedan marcados como exportados */
  async function markExported() {
    if (!S.zip || !S.zip.ids) return;
    const now = Date.now();
    for (const id of S.zip.ids) {
      const p = S.points.find(x => x.id === id); if (!p) continue;
      p.exportedAt = now; await DB.put('points', p);
    }
    localStorage.setItem('campo.lastExport', String(now));
    updatePendingBadge(); renderExport();
  }
  function downloadZip() {
    if (!S.zip) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(S.zip.blob); a.download = S.zip.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    markExported();
  }
  async function shareZip() {
    try { await navigator.share({ files: [new File([S.zip.blob], S.zip.name, { type: 'application/zip' })], title: S.zip.name }); markExported(); }
    catch (e) { if (e.name !== 'AbortError') toast('No se pudo compartir; usa «Descargar»', 4000); }
  }
  async function wipePoints() {
    if (!S.points.length) return;
    const pend = S.points.filter(isPending).length;
    const msg = pend
      ? `⚠ Hay ${pend} punto(s) que NUNCA se han exportado. Si los borras se pierden.\n\n¿Borrar de todas formas TODOS los puntos y fotos de este dispositivo?`
      : '¿Borrar TODOS los puntos y fotos de este dispositivo? (todos ya fueron exportados)';
    if (!confirm(msg)) return;
    await DB.clear('points'); await DB.del('meta', 'draft');
    S.points = []; S.zip = null; refreshMarkers(); renderExport(); toast('Puntos borrados');
  }

  /* ---------- Protección de datos ---------- */
  function updatePendingBadge() {
    const n = S.points.filter(isPending).length, b = $('#expBadge');
    b.hidden = !n; b.textContent = n;
  }
  async function renderStorage() {
    const st = navigator.storage, box = $('#storageBox');
    let persisted = null, est = null;
    try { if (st && st.persisted) persisted = await st.persisted(); } catch (e) { }
    try { if (st && st.estimate) est = await st.estimate(); } catch (e) { }
    const used = est ? `${(est.usage / 1048576).toFixed(0)} MB usados${est.quota ? ` de ~${(est.quota / 1073741824).toFixed(1)} GB disponibles` : ''}` : '';
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    let state, cls, tip = '';
    if (persisted) { state = 'Protegido: el navegador no borrará los datos por falta de espacio'; cls = 'ok'; }
    else if (persisted === false) { state = 'Sin protección: el navegador podría borrar los datos si falta espacio'; cls = 'warn'; }
    else { state = 'Este navegador no permite fijar la protección'; cls = 'warn'; }
    if (IS_IOS && !standalone) tip = 'En iPhone, Safari puede borrar los datos de sitios que no usas en 7 días. Instala la app en la pantalla de inicio para evitarlo.';
    box.innerHTML = `<div class="box-title">Seguridad de los datos</div>
      <div class="pend-line ${cls}">${state}</div>${used ? `<small class="muted">${used}</small>` : ''}
      ${tip ? `<p class="hint warn-hint">${tip}</p>` : ''}
      ${persisted === false ? '<button id="btnPersist" class="block">Proteger datos</button>' : ''}`;
    const b = $('#btnPersist');
    if (b) b.onclick = async () => {
      const ok = await st.persist().catch(() => false);
      toast(ok ? 'Datos protegidos' : 'El navegador no lo permitió. Instalar la app suele habilitarlo.', 4500);
      renderStorage();
    };
  }
  function checkReminder() {
    const pend = S.points.filter(isPending);
    if (!pend.length) { $('#remindBanner').hidden = true; return; }
    const oldest = Math.min(...pend.map(p => p.updatedAt || p.createdAt));
    const snooze = +localStorage.getItem('campo.remindSnooze') || 0;
    if (Date.now() - oldest < REMIND_HOURS * 3600e3 || Date.now() < snooze) return;
    const days = Math.max(1, Math.round((Date.now() - oldest) / 86400e3));
    $('#remindText').textContent = `Tienes ${pend.length} punto(s) sin exportar desde hace ${days} día(s). Descarga el ZIP para no perderlos.`;
    $('#remindBanner').hidden = false;
  }

  /* ---------- Recorrido GPS ---------- */
  function trackStats(t) {
    let d = 0;
    t.segs.forEach(sg => { for (let i = 1; i < sg.length; i++) d += haversine(sg[i - 1], sg[i]); });
    t.dist = d; return t;
  }
  function drawTrack(t) {
    if (S.trackLines[t.id]) { S.map.removeLayer(S.trackLines[t.id]); delete S.trackLines[t.id]; }
    if (!t.visible) return;
    const lines = t.segs.filter(sg => sg.length > 0).map(sg => sg.map(q => [q[1], q[0]]));
    S.trackLines[t.id] = L.polyline(lines, { color: TRACK_COLOR, weight: 4, opacity: .9, interactive: false }).addTo(S.map);
  }
  async function keepAwake() {
    try { if (S.rec && 'wakeLock' in navigator && document.visibilityState === 'visible') S.wake = await navigator.wakeLock.request('screen'); } catch (e) { }
  }
  async function startTrack() {
    if (!S.gps) requestGps(true);
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const t = { id: uid(), name: `Recorrido ${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`, createdAt: Date.now(), endedAt: null, segs: [[]], dist: 0, visible: true };
    S.tracks.push(t); S.rec = { t, saveT: 0 };
    await DB.put('tracks', t);
    keepAwake(); updateRecUi(); drawTrack(t);
    toast('Grabando recorrido. Mantén la app abierta: con la pantalla bloqueada el GPS se pausa.', 5000);
  }
  function addTrackFix(lng, lat, acc, ts) {
    const t = S.rec.t;
    if (acc > 35) return; // descarta lecturas imprecisas
    let sg = t.segs[t.segs.length - 1];
    const last = sg[sg.length - 1];
    lng = Math.round(lng * 1e6) / 1e6; lat = Math.round(lat * 1e6) / 1e6;
    if (last) {
      if (ts - last[2] > 180000) { sg = []; t.segs.push(sg); } // pausa larga: nuevo tramo (sin línea recta inventada)
      else {
        const d = haversine(last, [lng, lat]);
        if (d < Math.max(6, acc * 0.6)) return;
        t.dist += d;
      }
    }
    sg.push([lng, lat, ts, Math.round(acc)]);
    drawTrack(t);
    if (Date.now() - S.rec.saveT > 15000) { S.rec.saveT = Date.now(); DB.put('tracks', t).catch(() => { }); }
    updateRecUi();
  }
  async function stopTrack() {
    if (!S.rec) return;
    const t = S.rec.t;
    if (!confirm(`¿Terminar la grabación? (${fmtKm(t.dist)})`)) return;
    t.endedAt = Date.now(); t.segs = t.segs.filter(sg => sg.length); if (!t.segs.length) t.segs = [[]];
    await DB.put('tracks', t);
    S.rec = null; try { if (S.wake) await S.wake.release(); } catch (e) { } S.wake = null;
    updateRecUi(); drawTrack(t);
    toast(`Recorrido guardado · ${fmtKm(t.dist)} · ${fmtDur(t.endedAt - t.createdAt)}`, 4000);
  }
  function updateRecUi() {
    const on = !!S.rec;
    $('#btnTrack').classList.toggle('rec', on);
    $('#btnTrack').title = $('#btnTrack').ariaLabel = on ? 'Detener recorrido' : 'Grabar recorrido';
    $('#recBar').hidden = !on;
    if (on) {
      const t = S.rec.t, n = t.segs.reduce((a, sg) => a + sg.length, 0);
      $('#recText').textContent = `${fmtKm(t.dist)} · ${fmtDur(Date.now() - t.createdAt)} · ${n} lecturas`;
    }
  }
  function renderTracks() {
    const box = $('#trackList'); box.innerHTML = '';
    const list = S.tracks.slice().sort((a, b) => b.createdAt - a.createdAt);
    if (!list.length) { box.innerHTML = '<p class="empty small">Sin recorridos. Usa el botón de grabar en el mapa.</p>'; return; }
    list.forEach(t => {
      const row = document.createElement('div'); row.className = 'row';
      const live = S.rec && S.rec.t === t;
      row.innerHTML = `<input type="checkbox" ${t.visible ? 'checked' : ''} aria-label="Visible">
        <i class="sw line" style="--c:${TRACK_COLOR}"></i>
        <div class="grow"><b>${esc(t.name)}</b><small>${live ? 'Grabando… · ' : ''}${fmtKm(t.dist)} · ${fmtDur((t.endedAt || Date.now()) - t.createdAt)}</small></div>
        <button class="ico" data-a="zoom" title="Ver en el mapa" aria-label="Ver en el mapa">${ic('zoom')}</button>
        ${live ? '' : `<button class="ico" data-a="del" title="Eliminar" aria-label="Eliminar">${ic('trash')}</button>`}`;
      $('input', row).onchange = async e => { t.visible = e.target.checked; await DB.put('tracks', t); drawTrack(t); };
      $('[data-a=zoom]', row).onclick = () => { const l = S.trackLines[t.id]; if (l && l.getBounds().isValid()) { closeSheets(); S.map.fitBounds(l.getBounds(), { padding: [30, 30], maxZoom: 18 }); } };
      const del = $('[data-a=del]', row);
      if (del) del.onclick = async () => {
        if (!confirm(`¿Eliminar «${t.name}»?`)) return;
        await DB.del('tracks', t.id); S.tracks = S.tracks.filter(x => x !== t); drawTrack({ ...t, visible: false }); renderTracks();
      };
      box.appendChild(row);
    });
  }

  /* ---------- Mapa sin conexión ---------- */
  const OFF_MAX_TILES = 8000;
  function offlineArea() {
    if ($('#offArea').value === 'layers') {
      const vis = S.layers.filter(l => l.visible && l.bbox);
      if (!vis.length) return null;
      const b = vis.reduce((a, l) => [Math.min(a[0], l.bbox[0]), Math.min(a[1], l.bbox[1]), Math.max(a[2], l.bbox[2]), Math.max(a[3], l.bbox[3])], [180, 90, -180, -90]);
      return OfflineMaps.pad(b, 300);
    }
    const bb = S.map.getBounds();
    return [bb.getWest(), bb.getSouth(), bb.getEast(), bb.getNorth()];
  }
  function renderOffline() {
    renderTracks();
    if (!('caches' in window)) { $('#offBox').hidden = true; return; }
    const hasLayers = S.layers.some(l => l.visible && l.bbox);
    $('#offArea').querySelector('[value=layers]').disabled = !hasLayers;
    if (!hasLayers) $('#offArea').value = 'view';
    const bbox = offlineArea(), zmax = +$('#offZoom').value;
    const n = bbox ? OfflineMaps.count(bbox, 12, zmax) : 0;
    const mb = n * OfflineMaps.KB_PER_TILE / 1024;
    const over = n > OFF_MAX_TILES;
    $('#offEstimate').innerHTML = bbox ? `${n.toLocaleString('es-CO')} teselas · aprox. <b>${mb < 1 ? '<1' : Math.round(mb)} MB</b>${over ? '<br><span class="err">Zona demasiado grande: reduce el detalle o el área.</span>' : ''}` : 'Elige un área.';
    $('#btnOffDl').disabled = !bbox || over || !navigator.onLine;
    const zl = OfflineMaps.zones(), box = $('#offZones'); box.innerHTML = '';
    zl.forEach(z => {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<div class="grow"><b>${esc(z.name)}</b><small>${new Date(z.date).toLocaleDateString('es-CO')} · ${z.ok.toLocaleString('es-CO')} teselas · hasta zoom ${z.zmax}${z.fail ? ` · ${z.fail} fallidas` : ''}</small></div>
        <button class="ico" data-a="zoom" title="Ver zona" aria-label="Ver zona">${ic('zoom')}</button>
        <button class="ico" data-a="del" title="Eliminar zona" aria-label="Eliminar zona">${ic('trash')}</button>`;
      $('[data-a=zoom]', row).onclick = () => { closeSheets(); S.map.fitBounds([[z.bbox[1], z.bbox[0]], [z.bbox[3], z.bbox[2]]]); };
      $('[data-a=del]', row).onclick = async () => {
        if (!confirm(`¿Eliminar el mapa descargado «${z.name}»?`)) return;
        busy('Eliminando…'); await OfflineMaps.removeZone(z.id, BASEMAPS.sat.url); unbusy(); renderOffline();
      };
      box.appendChild(row);
    });
  }
  async function downloadOffline() {
    const bbox = offlineArea(); if (!bbox) return;
    const zmax = +$('#offZoom').value;
    const area = $('#offArea').value === 'layers' ? S.layers.filter(l => l.visible).map(l => l.name).join(', ') : 'Vista del mapa';
    S.dl = { cancel: false };
    $('#busyCancel').hidden = false;
    busy('Descargando mapa…', 0);
    const r = await OfflineMaps.download(BASEMAPS.sat.url, bbox, 12, zmax,
      (d, t) => busy(`Descargando mapa… ${d.toLocaleString('es-CO')} de ${t.toLocaleString('es-CO')}`, Math.round(d / t * 100)),
      () => S.dl.cancel);
    $('#busyCancel').hidden = true; unbusy(); S.dl = null;
    if (r.ok) {
      const zl = OfflineMaps.zones();
      zl.push({ id: uid(), name: area.slice(0, 60) || 'Zona', bbox, zmin: 12, zmax, ok: r.ok, fail: r.fail, date: Date.now() });
      OfflineMaps.saveZones(zl);
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
    toast(r.quota ? 'Se llenó el espacio del celular; se guardó lo descargado hasta ese momento.'
      : r.cancelled ? `Descarga detenida: ${r.ok} teselas guardadas`
      : r.fail ? `Listo con ${r.fail} teselas fallidas (puedes repetir para completar)` : `Mapa listo para usar sin señal (${r.ok} teselas)`, 5000);
    renderOffline();
  }

  /* ---------- Ajustes ---------- */
  function renderSettings() {
    $('#sProject').value = S.settings.project;
    $('#sZoom').value = S.settings.zoomMini; $('#sZoomVal').textContent = S.settings.zoomMini;
    $('#sMaxPx').value = String(S.settings.maxPx);
    $('#sWmStyle').value = S.settings.wmStyle;
    $('#sHeading').checked = S.settings.showHeading;
    $('#sCats').value = S.settings.cats;
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
    $('#btnTrack').onclick = () => S.rec ? stopTrack() : startTrack();
    $('#recStop').onclick = stopTrack;
    $('#btnLocate').onclick = () => { if (S.gps) S.map.setView([S.gps.lat, S.gps.lng], Math.max(S.map.getZoom(), 17)); else requestGps(true); };
    $('#btnBase').onclick = () => setBase(S.baseKey === 'sat' ? 'osm' : 'sat');

    $('#inLayer').onchange = e => { const f = Array.from(e.target.files); e.target.value = ''; addLayerFiles(f); };

    $('#fName').oninput = () => { if (S.draft) { S.draft.name = $('#fName').value; persistDraft(); } };
    $('#fName').onchange = renderPhotos;
    $('#fDesc').oninput = () => { if (S.draft) { S.draft.desc = $('#fDesc').value; persistDraft(); } };
    $('#fCat').onchange = () => { if (S.draft) { S.draft.cat = $('#fCat').value; renderPhotos(); persistDraft(); } };
    $$('#fLevel button').forEach(b => b.onclick = () => { if (!S.draft) return; S.draft.level = b.dataset.v || ''; renderLevel(); renderPhotos(); persistDraft(); });
    $('#locGps').onclick = useGps; $('#locCenter').onclick = useCenter; $('#locPick').onclick = startPick;
    $('#pickOk').onclick = () => endPick(true); $('#pickCancel').onclick = () => endPick(false);
    $('#btnCam').onclick = () => { if (S.settings.showHeading) Compass.start(); $('#inCam').click(); };
    $('#btnGal').onclick = () => $('#inGal').click();
    $('#inCam').onchange = e => { const f = Array.from(e.target.files); e.target.value = ''; addPhotos(f, true); };
    $('#inGal').onchange = e => { const f = Array.from(e.target.files); e.target.value = ''; addPhotos(f, false); };
    $('#btnSave').onclick = savePoint; $('#btnCancel').onclick = cancelForm; $('#btnDelete').onclick = deletePoint;

    $('#viewerClose').onclick = () => { $('#viewer').hidden = true; };
    $('#vhFix').onclick = fixHeading;
    $('#vhClear').onclick = () => { const ph = S.draft.photos[$('#viewer')._i]; ph.heading = null; ph.headingSrc = null; renderViewerHeading(); renderPhotos(); persistDraft(true); };
    $('#viewerDel').onclick = () => {
      const v = $('#viewer'); if (!confirm('¿Quitar esta foto?')) return;
      S.draft.photos.splice(v._i, 1); v.hidden = true; renderPhotos(); persistDraft(true);
    };

    $('#btnZip').onclick = buildZip; $('#btnDownload').onclick = downloadZip; $('#btnShare').onclick = shareZip;
    $('#btnWipe').onclick = wipePoints;
    $('#optPending').onchange = () => { S.zip = null; renderExport(); };
    $('#catFilter').onchange = e => { S.filter.cat = e.target.value; renderPoints(); };
    $('#remindGo').onclick = () => { $('#remindBanner').hidden = true; openSheet('sheetExport'); };
    $('#remindX').onclick = () => { $('#remindBanner').hidden = true; localStorage.setItem('campo.remindSnooze', String(Date.now() + 12 * 3600e3)); };
    $('#offArea').onchange = renderOffline; $('#offZoom').onchange = renderOffline;
    $('#btnOffDl').onclick = downloadOffline;
    $('#busyCancel').onclick = () => { if (S.dl) S.dl.cancel = true; $('#busyMsg').textContent = 'Deteniendo…'; };

    $('#sProject').oninput = e => { S.settings.project = e.target.value.trim(); saveSettings(); };
    $('#sZoom').oninput = e => { S.settings.zoomMini = +e.target.value; $('#sZoomVal').textContent = e.target.value; saveSettings(); };
    $('#sMaxPx').onchange = e => { S.settings.maxPx = +e.target.value; saveSettings(); };
    $('#sWmStyle').onchange = e => { S.settings.wmStyle = e.target.value; saveSettings(); };
    $('#sHeading').onchange = e => { S.settings.showHeading = e.target.checked; saveSettings(); if (e.target.checked) Compass.start(); };
    $('#sCats').onchange = e => { S.settings.cats = e.target.value.split('\n').map(x => x.trim()).filter(Boolean).join('\n') || DEFAULT_CATS.join('\n'); e.target.value = S.settings.cats; saveSettings(); };
    $('#sCatsReset').onclick = () => { S.settings.cats = DEFAULT_CATS.join('\n'); $('#sCats').value = S.settings.cats; saveSettings(); };
    $('#btnInstall').onclick = async () => { if (!S.installEvt) return; S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; $('#btnInstall').hidden = true; };
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });

    const net = () => { $('#netChip').hidden = navigator.onLine; if (!$('#sheetLayers').hidden) renderOffline(); };
    window.addEventListener('online', net); window.addEventListener('offline', net); net();
  }

  /* ---------- Arranque ---------- */
  async function init() {
    initMap(); bind();
    try { await DB.open(); } catch (e) { toast('No se pudo abrir el almacenamiento local: ' + e.message, 8000); return; }
    S.layers = await DB.all('layers'); S.layers.sort((a, b) => a.createdAt - b.createdAt);
    S.layers.forEach(drawLayer);
    S.points = await DB.all('points'); refreshMarkers();
    S.tracks = (await DB.all('tracks')).map(trackStats);
    S.tracks.forEach(drawTrack);
    const open = S.tracks.find(t => !t.endedAt); // la app se cerró grabando: se reanuda
    if (open) { S.rec = { t: open, saveT: 0 }; updateRecUi(); toast('Se reanudó la grabación del recorrido', 4000); }
    setInterval(() => { if (S.rec) updateRecUi(); }, 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { keepAwake(); checkReminder(); }
      else if (S.rec) DB.put('tracks', S.rec.t).catch(() => { });
    });
    checkReminder();
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
