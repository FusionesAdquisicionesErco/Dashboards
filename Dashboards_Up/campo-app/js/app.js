/* JMaps M&A · ERCO — lógica principal
   v1.5: rumbo de la foto, observaciones estructuradas, protección de datos, recorridos GPS y mapa sin conexión
   v1.6: actualización segura entre versiones, autor y consolidación de levantamientos del equipo
   v1.7: cono de orientación en vivo sobre el punto GPS (solo en celulares con brújula)
   v1.8: notas de la visita (texto libre, con hora, autor y ubicación opcional)
   v1.9: varios proyectos en el dispositivo (abrir, crear, descargar y eliminar) */
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
  const DEFAULTS = { project: '', author: '', zoomMini: 17, maxPx: 1600, wmStyle: 'card', showHeading: true, cats: DEFAULT_CATS.join('\n') };
  const APP_VERSION = '1.9';
  // Nivel de la observación (relevancia / riesgo): color del pin y de la etiqueta en la marca de agua
  const LEVELS = { alto: { name: 'Alto', color: '#F53333' }, medio: { name: 'Medio', color: '#F99207' }, bajo: { name: 'Bajo', color: '#45A824' } };
  const TRACK_COLOR = '#00B7D3';
  const REMIND_HOURS = 24;

  const S = {
    map: null, baseKey: localStorage.getItem('campo.base') || 'sat', baseLayer: null,
    layers: [], leaf: {}, points: [], markers: {},
    gps: null, gpsDot: null, gpsCircle: null, firstFix: false, gpsWatch: null, gpsDenied: false,
    settings: loadSettings(), draft: null, urls: [], thumbUrls: [], zip: null, installEvt: null, picking: false,
    tracks: [], trackLines: {}, rec: null, wake: null, filter: { lvl: '', cat: '', author: '' }, dl: null,
    dbReady: false, updateReady: false,
    notes: [], noteMarkers: [], noteEdit: null,
    projects: [], proj: null, projFiles: []
  };
  const projName = () => (S.proj ? S.proj.name : '');
  const draftKey = () => 'draft:' + (S.proj ? S.proj.id : '');
  const noteDraftKey = () => 'noteDraft:' + (S.proj ? S.proj.id : '');
  const authorOf = p => p.author || S.settings.author || '';
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
    if (id === 'sheetNotes') renderNotes();
    if (id === 'sheetProjects') renderProjects();
  }
  function closeSheets() {
    $$('.sheet').forEach(s => { s.hidden = true; });
    $('#scrim').hidden = true;
    document.body.classList.remove('sheet-open');
    $$('#bottomnav button').forEach(b => b.classList.remove('active'));
    setTimeout(() => S.map && S.map.invalidateSize(), 50);
    tryUpdate();
  }
  /* Nueva versión instalada: recarga solo cuando no hay nada a medio hacer */
  function tryUpdate() {
    if (!S.updateReady || S.draft || S.picking || !$('#busy').hidden || !$('#viewer').hidden) return;
    S.updateReady = false;
    toast('Actualizando a la nueva versión…', 1500);
    setTimeout(() => location.reload(), 900);
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
      const cone = `<svg class="gps-cone" viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="gcg" cx="50" cy="50" r="48" gradientUnits="userSpaceOnUse"><stop offset=".12" stop-color="#00B7D3" stop-opacity=".9"/><stop offset="1" stop-color="#00B7D3" stop-opacity="0"/></radialGradient></defs><path d="M50 50 L27 6 A48 48 0 0 1 73 6 Z" fill="url(#gcg)"/></svg>`;
      S.gpsDot = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: `<div class="gps-wrap">${cone}<div class="gps-dot"></div></div>`, iconSize: [120, 120], iconAnchor: [60, 60] }), interactive: false, zIndexOffset: -100 }).addTo(S.map);
      if (S.coneH != null) paintCone();
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

  /* ---------- Orientación en vivo (hacia dónde mira el celular) ---------- */
  let coneRaf = 0, coneT = 0;
  function onHeading(h) {
    // suaviza por el camino más corto (evita el salto 359° → 0°)
    if (S.coneH == null) S.coneH = h;
    else { const d = ((h - S.coneH + 540) % 360) - 180; S.coneH = (S.coneH + d * 0.35 + 360) % 360; }
    coneT = Date.now();
    if (!coneRaf) coneRaf = requestAnimationFrame(() => { coneRaf = 0; paintCone(); });
  }
  function paintCone() {
    const el = S.gpsDot && S.gpsDot.getElement && S.gpsDot.getElement();
    const c = el && el.querySelector('.gps-cone'); if (!c) return;
    // ajuste si la pantalla está girada (horizontal)
    const rot = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    c.style.transform = `rotate(${(S.coneH + rot) % 360}deg)`;
    c.classList.add('on');
  }
  function startOrientation() {
    if (!(matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0)) return; // en PC no aplica
    Compass.subscribe(onHeading);
    const needsTap = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
    if (!needsTap) { Compass.start(); return; }
    // iPhone: el permiso de brújula solo se puede pedir tras un toque
    const once = () => { Compass.start(); document.removeEventListener('touchend', once); document.removeEventListener('click', once); };
    document.addEventListener('touchend', once); document.addEventListener('click', once);
    Compass.start(); // si ya se dio permiso en esta sesión, arranca sin esperar el toque
  }
  // si la brújula deja de responder, el cono se oculta
  setInterval(() => {
    if (!coneT || Date.now() - coneT < 4000) return;
    const c = S.gpsDot && S.gpsDot.getElement && S.gpsDot.getElement().querySelector('.gps-cone');
    if (c) c.classList.remove('on');
    coneT = 0; S.coneH = null;
  }, 2000);

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
          visible: true, features: fc.features, bbox: fc.bbox, createdAt: Date.now(), proj: S.proj.id
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
      if ((f.lvl && (p.level || 'none') !== f.lvl) || (f.cat && p.cat !== f.cat) || (f.author && authorOf(p) !== f.author)) return;
      shown++;
      const ph = p.photos[0]; let url = '';
      if (ph) { url = URL.createObjectURL(ph.marked || ph.orig); S.thumbUrls.push(url); }
      const row = document.createElement('div'); row.className = 'row pt';
      row.innerHTML = `${url ? `<img class="thumb" src="${url}" alt="">` : '<div class="thumb"></div>'}
        <div class="grow"><b><span class="num">${i + 1}</span>${esc(p.name)}</b>
        <small>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} · ${p.photos.length} foto(s)</small>
        <span class="tags">${p.cat ? `<i class="tag">${esc(p.cat)}</i>` : ''}${LEVELS[p.level] ? `<i class="tag lvl" style="--c:${LEVELS[p.level].color}">${LEVELS[p.level].name}</i>` : ''}${isPending(p) ? '<i class="tag pend">Sin exportar</i>' : ''}${multiAuthor() && authorOf(p) ? `<i class="tag who">${esc(authorOf(p))}</i>` : ''}</span></div>
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
    const authors = [...new Set(S.points.map(authorOf).filter(Boolean))];
    const as = $('#authorFilter');
    as.parentElement.hidden = authors.length < 2;
    as.innerHTML = '<option value="">Todas las personas</option>' + authors.map(a => `<option${a === S.filter.author ? ' selected' : ''}>${esc(a)}</option>`).join('');
    if (S.filter.author && !authors.includes(S.filter.author)) S.filter.author = '';
  }
  const multiAuthor = () => new Set(S.points.map(authorOf).filter(Boolean)).size > 1;

  /* ---------- Formulario de punto ---------- */
  const sigOf = d => `${d.name}|${d.lat.toFixed(7)}|${d.lng.toFixed(7)}|${d.cat || ''}|${d.level || ''}`;
  // firma por foto: si cambia el punto o el rumbo de esa foto, se vuelve a marcar
  const photoSig = (d, ph) => `${sigOf(d)}|${S.settings.showHeading && ph.heading != null ? ph.heading : '-'}`;
  const liveDraft = () => ({ ...S.draft, name: $('#fName').value.trim() || S.draft.name });
  let persistT;
  function persistDraft(now) {
    clearTimeout(persistT);
    const run = () => { if (S.draft) DB.put('meta', { k: draftKey(), v: S.draft }).catch(() => { }); };
    if (now) run(); else persistT = setTimeout(run, 400);
  }
  function newPoint() {
    if (S.settings.showHeading) Compass.start(); // toque del usuario: en iPhone pide permiso de brújula
    const loc = S.gps ? { lat: S.gps.lat, lng: S.gps.lng, acc: S.gps.acc, src: 'gps' } : { lat: S.map.getCenter().lat, lng: S.map.getCenter().lng, src: 'center' };
    S.draft = { id: uid(), isNew: true, proj: S.proj.id, name: `Punto ${S.points.length + 1}`, desc: '', cat: '', level: '', author: S.settings.author, createdAt: Date.now(), photos: [], ...loc };
    openForm();
  }
  function openPoint(id) {
    const p = S.points.find(x => x.id === id); if (!p) return;
    if (S.settings.showHeading) Compass.start();
    S.draft = { id: p.id, isNew: false, proj: p.proj || S.proj.id, name: p.name, desc: p.desc, cat: p.cat || '', level: p.level || '', author: p.author || '', exportedAt: p.exportedAt || null, lat: p.lat, lng: p.lng, src: 'saved', createdAt: p.createdAt, photos: p.photos.map(x => ({ ...x })) };
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
        const hd = S.settings.showHeading && (ph.heading != null || Compass.seen()) ? `<span class="hd ${ph.heading == null ? 'none' : ''}">${ph.heading == null ? 'Sin rumbo' : Compass.label(ph.heading)}</span>` : '';
        const st = ph.locked ? ['Sin original', 'lock'] : done ? ['Marcada', 'ok'] : ['Pendiente', ''];
        el.innerHTML = `<img src="${url}" alt="Foto ${i + 1}">${hd}<span class="badge ${st[1]}">${st[0]}</span>`;
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
    $('#vhBox').hidden = !S.settings.showHeading || (ph.heading == null && !Compass.seen());
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
    $('#viewerNote').textContent = ph.locked ? 'Foto importada sin original: conserva la marca de agua con la que llegó'
      : done ? 'Foto con marca de agua' : 'Vista previa sin marca: se aplicará al guardar el punto';
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
    if (!S.dbReady) { toast('El almacenamiento aún no está listo. Cierra otras pestañas o ventanas de la app y vuelve a intentar.', 6000); return; }
    // las fotos importadas sin original no se pueden volver a marcar (quedaría doble marca)
    const locked = d.photos.filter(p => p.locked && p.markedFor !== photoSig(d, p));
    locked.forEach(p => { p.markedFor = photoSig(d, p); });
    const need = d.photos.filter(p => !p.locked && (!p.marked || p.markedFor !== photoSig(d, p)));
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
            project: projName(), style: S.settings.wmStyle, heading, tag, tagColor: lv ? lv.color : null
          });
          ph.markedFor = photoSig(d, ph);
        }
      }
      const rec = {
        id: d.id, proj: d.proj || S.proj.id, name: d.name, desc: d.desc, cat: d.cat || '', level: d.level || '', author: d.author || '', lat: d.lat, lng: d.lng,
        createdAt: d.createdAt, updatedAt: Date.now(), exportedAt: d.exportedAt || null,
        photos: d.photos.map(({ id, takenAt, orig, marked, markedFor, heading, headingSrc, locked }) => ({ id, takenAt, orig, marked, markedFor, heading: heading == null ? null : heading, headingSrc: headingSrc || null, locked: !!locked }))
      };
      await DB.put('points', rec);
      const k = S.points.findIndex(p => p.id === rec.id);
      if (k >= 0) S.points[k] = rec; else S.points.push(rec);
      await DB.del('meta', draftKey());
      S.draft = null; refreshMarkers(); closeSheets();
      toast(locked.length ? `Punto guardado. ${locked.length} foto(s) importada(s) sin original conservan su marca anterior.` : `Punto guardado · ${rec.photos.length} foto(s)`, locked.length ? 5000 : 2800);
    } catch (e) {
      console.error(e); toast('Error al guardar: ' + e.message, 6000);
    }
    unbusy();
  }
  async function cancelForm() {
    const d = S.draft;
    if (d && d.isNew && (d.photos.length || $('#fDesc').value.trim()) && !confirm('¿Descartar este punto sin guardar?')) return;
    S.draft = null; closeSheets(); await DB.del('meta', draftKey()).catch(() => { });
  }
  async function deletePoint() {
    if (!confirm('¿Eliminar este punto y sus fotos?')) return;
    const id = S.draft.id;
    await DB.del('points', id); await DB.del('meta', draftKey());
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
  function exportNotes() {
    const all = S.notes.slice().sort((a, b) => a.createdAt - b.createdAt);
    return $('#optPending').checked ? all.filter(isPending) : all;
  }
  function renderExport() {
    const pend = S.points.filter(isPending).length + S.notes.filter(isPending).length;
    $('#optPendingN').textContent = pend;
    if (!$('#optAuthor').dataset.touched) $('#optAuthor').checked = multiAuthor();
    $('#optPending').disabled = !pend || pend === S.points.length + S.notes.length;
    if ($('#optPending').disabled) $('#optPending').checked = false;
    const set = exportSet();
    const np = set.length, nf = set.reduce((a, x) => a + x.p.photos.length, 0);
    const mb = set.reduce((a, x) => a + x.p.photos.reduce((b, f) => b + (f.marked || f.orig).size, 0), 0) / 1048576;
    const nt = S.tracks.filter(t => t.endedAt && t.segs.some(sg => sg.length > 1)).length;
    const nn = exportNotes().length;
    $('#exportSummary').innerHTML = `<div class="exp-proj">Proyecto: <b>${esc(projName())}</b></div><b>${np}</b> punto(s) · <b>${nf}</b> foto(s) · aprox. <b>${mb.toFixed(1)} MB</b>${nt ? ` · <b>${nt}</b> recorrido(s)` : ''}${nn ? ` · <b>${nn}</b> nota(s)` : ''}
      <div class="pend-line ${pend ? 'warn' : 'ok'}">${pend ? `${pend} punto(s) o nota(s) sin exportar todavía` : 'Todo está exportado'}</div>`;
    $('#btnZip').disabled = !np && !nt && !nn; $('#zipResult').hidden = !S.zip;
    if (S.zip) $('#zipInfo').innerHTML = `<b>${esc(S.zip.name)}</b><br><small>${(S.zip.blob.size / 1048576).toFixed(1)} MB</small>`;
    $('#btnShare').hidden = !(S.zip && navigator.canShare && navigator.canShare({ files: [new File([S.zip.blob], S.zip.name, { type: 'application/zip' })] }));
  }
  const KML_ICON = { alto: 'red-circle', medio: 'orange-circle', bajo: 'grn-circle', '': 'wht-circle' };
  function kmlDoc(set, imgPath, tracks, notes = [], name = '') {
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
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name || 'Visita de campo')}</name>
${styles}
<Style id="trk"><LineStyle><color>ffd3b700</color><width>4</width></LineStyle></Style>
${pm}
${trk}
${notesKml(notes)}
</Document></kml>`;
  }
  function notesKml(notes) {
    const loc = notes.filter(n => n.lat != null);
    if (!loc.length) return '';
    return `<Style id="nota"><IconStyle><scale>0.9</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/ylw-blank.png</href></Icon></IconStyle></Style>
<Folder><name>Notas</name>
${loc.map(n => `<Placemark><name>${esc('Nota ' + Watermark.fmtDate(n.createdAt))}</name><styleUrl>#nota</styleUrl><description><![CDATA[${esc(n.text).replace(/\n/g, '<br>')}]]></description><Point><coordinates>${n.lng},${n.lat},0</coordinates></Point></Placemark>`).join('\n')}
</Folder>`;
  }
  function gpxDoc(tracks) {
    const iso = t => new Date(t).toISOString();
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="JMaps M&amp;A · ERCO" xmlns="http://www.topografix.com/GPX/1/1">
${tracks.map(t => `<trk><name>${esc(t.name)}</name>${t.segs.filter(sg => sg.length > 1).map(sg => `<trkseg>${sg.map(q => `<trkpt lat="${q[1]}" lon="${q[0]}"><time>${iso(q[2])}</time></trkpt>`).join('')}</trkseg>`).join('')}</trk>`).join('\n')}
</gpx>`;
  }
  const doneTracks = list => list.filter(t => t.endedAt && t.segs.some(sg => sg.length > 1)).sort((a, b) => a.createdAt - b.createdAt);
  /* Arma el contenido de un proyecto dentro de zip (raíz o carpeta).
     D = {name, set:[{p,n}], tracks, notes}; o = {orig, kmz, author}; prog(msg, %) */
  async function fillPackage(zip, D, o, prog) {
    const { set, tracks, notes } = D;
    const optOrig = o.orig, optAuthor = o.author, kmz = o.kmz ? new JSZip() : null;
    const csv = [['id', 'nombre', 'categoria', 'nivel', ...(optAuthor ? ['autor'] : []), 'descripcion', 'latitud', 'longitud', 'fecha_hora', 'num_fotos', 'fotos', 'rumbos'].join(';')];
    // manifiesto completo: permite que otra persona importe y consolide este paquete
    const man = { app: 'JMaps M&A', format: 1, version: APP_VERSION, exportedAt: Date.now(), author: S.settings.author, project: D.name, points: [], tracks: [] };
    const geo = { type: 'FeatureCollection', features: [] };
    const fname = (x, k) => `${String(x.n).padStart(2, '0')}_${slug(x.p.name)}_${k + 1}.jpg`;
    const total = set.reduce((a, x) => a + x.p.photos.length, 0); let done = 0;
    {
      for (const x of set) {
        const p = x.p, names = [];
        for (let k = 0; k < p.photos.length; k++) {
          const ph = p.photos[k], n = fname(x, k); names.push(n);
          const data = ph.marked || ph.orig;
          zip.file('fotos/' + n, data, { compression: 'STORE' });
          if (optOrig && !ph.locked) zip.file('fotos_originales/' + n, ph.orig, { compression: 'STORE' });
          if (kmz) kmz.file('files/' + n, data, { compression: 'STORE' });
          prog(`Agregando fotos (${++done}/${total})…`, Math.round(done / Math.max(1, total) * 60));
          if (done % 5 === 0) await sleep(0);
        }
        const when = Watermark.fmtDate(p.photos[0] ? p.photos[0].takenAt : p.createdAt);
        const lv = LEVELS[p.level] ? LEVELS[p.level].name : '';
        const rumbos = p.photos.map((ph, k) => `${k + 1}: ${ph.heading != null ? Compass.label(ph.heading) : '—'}`).join(' | ');
        csv.push([x.n, p.name, p.cat || '', lv, ...(optAuthor ? [authorOf(p)] : []), p.desc, p.lat.toFixed(7), p.lng.toFixed(7), when, names.length, names.join(' | '), rumbos].map(csvCell).join(';'));
        man.points.push({ id: p.id, name: p.name, desc: p.desc, cat: p.cat || '', level: p.level || '', lat: p.lat, lng: p.lng,
          createdAt: p.createdAt, updatedAt: p.updatedAt || p.createdAt, author: authorOf(p),
          photos: p.photos.map((ph, k) => ({ id: ph.id, takenAt: ph.takenAt, heading: ph.heading == null ? null : ph.heading, headingSrc: ph.headingSrc || null,
            file: 'fotos/' + names[k], orig: optOrig && !ph.locked ? 'fotos_originales/' + names[k] : null })) });
        geo.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: {
          id: x.n, nombre: p.name, categoria: p.cat || '', nivel: lv, ...(optAuthor ? { autor: authorOf(p) } : {}), descripcion: p.desc, fecha_hora: when,
          fotos: names.map(n => 'fotos/' + n), rumbos_grados: p.photos.map(ph => ph.heading == null ? null : ph.heading) } });
      }
      tracks.forEach(t => geo.features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: t.segs.filter(sg => sg.length > 1).map(sg => sg.map(q => [q[0], q[1]])) },
        properties: { tipo: 'recorrido', nombre: t.name, distancia_m: Math.round(t.dist), inicio: new Date(t.createdAt).toISOString(), fin: new Date(t.endedAt).toISOString() } }));
      zip.file('puntos.kml', kmlDoc(set, (i, k) => 'fotos/' + fname(set[i], k), tracks, notes, D.name), { compression: 'DEFLATE' });
      zip.file('puntos.geojson', JSON.stringify(geo, null, 1), { compression: 'DEFLATE' });
      man.tracks = tracks.map(t => ({ id: t.id, name: t.name, createdAt: t.createdAt, endedAt: t.endedAt, author: t.author || S.settings.author || '', segs: t.segs }));
      man.notes = notes.map(n => ({ id: n.id, text: n.text, createdAt: n.createdAt, updatedAt: n.updatedAt || n.createdAt, author: authorOf(n), lat: n.lat == null ? null : n.lat, lng: n.lng == null ? null : n.lng }));
      if (notes.length) {
        const ncsv = [['fecha_hora', ...(optAuthor ? ['autor'] : []), 'nota', 'latitud', 'longitud'].join(';')]
          .concat(notes.map(n => [Watermark.fmtDate(n.createdAt), ...(optAuthor ? [authorOf(n)] : []), n.text, n.lat == null ? '' : n.lat.toFixed(7), n.lng == null ? '' : n.lng.toFixed(7)].map(csvCell).join(';')));
        zip.file('notas.csv', '\ufeff' + ncsv.join('\r\n'), { compression: 'DEFLATE' });
        // versión legible (también sirve para pasarla al agente de Copilot)
        const txt = [`NOTAS DE LA VISITA${D.name ? ' · ' + D.name : ''}`, '']
          .concat(notes.map(n => `[${Watermark.fmtDate(n.createdAt)}]${authorOf(n) ? ' ' + authorOf(n) : ''}${n.lat != null ? ` (${n.lat.toFixed(6)}, ${n.lng.toFixed(6)})` : ''}\n${n.text}\n`));
        zip.file('notas.txt', '\ufeff' + txt.join('\r\n').replace(/\r?\n/g, '\r\n'), { compression: 'DEFLATE' });
        notes.filter(n => n.lat != null).forEach(n => geo.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
          properties: { tipo: 'nota', fecha_hora: Watermark.fmtDate(n.createdAt), nota: n.text, ...(optAuthor ? { autor: authorOf(n) } : {}) } }));
      }
      zip.file('puntos.geojson', JSON.stringify(geo, null, 1), { compression: 'DEFLATE' });
      zip.file('levantamiento.json', JSON.stringify(man), { compression: 'DEFLATE' });
      zip.file('puntos.csv', '\ufeff' + csv.join('\r\n'), { compression: 'DEFLATE' });
      if (tracks.length) zip.file('recorridos.gpx', gpxDoc(tracks), { compression: 'DEFLATE' });
      if (kmz) {
        kmz.file('doc.kml', kmlDoc(set, (i, k) => 'files/' + fname(set[i], k), tracks, notes, D.name));
        prog('Generando KMZ…', 65);
        const kb = await kmz.generateAsync({ type: 'blob', compression: 'STORE' });
        zip.file('puntos.kmz', kb, { compression: 'STORE' });
      }
    }
    return { ids: set.map(x => x.p.id), noteIds: notes.map(n => n.id) };
  }
  const zipBlob = (zip, prog) => zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, m => prog('Comprimiendo…', 70 + Math.round(m.percent * 0.3)));
  const zipName = (name, extra = '') => `JMaps_MA_${name ? slug(name) + '_' : ''}${stampName()}${extra}.zip`;
  async function buildZip() {
    const D = { name: projName(), set: exportSet(), tracks: doneTracks(S.tracks), notes: exportNotes() };
    if (!D.set.length && !D.tracks.length && !D.notes.length) return;
    busy('Armando paquete…', 0);
    try {
      const zip = new JSZip();
      const r = await fillPackage(zip, D, { orig: $('#optOrig').checked, kmz: $('#optKmz').checked, author: $('#optAuthor').checked }, busy);
      const blob = await zipBlob(zip, busy);
      S.zip = { blob, name: zipName(D.name, $('#optPending').checked ? '_nuevos' : ''), ...r };
    } catch (e) { console.error(e); toast('No se pudo generar el ZIP: ' + e.message, 6000); }
    unbusy(); renderExport();
  }
  /* Al descargar o compartir, los puntos del ZIP quedan marcados como exportados */
  async function markIds(ids, noteIds) {
    const now = Date.now();
    for (const id of ids || []) {
      const p = S.points.find(x => x.id === id) || await DB.get('points', id); if (!p) continue;
      p.exportedAt = now; await DB.put('points', p);
    }
    for (const id of noteIds || []) {
      const n = S.notes.find(x => x.id === id) || await DB.get('meta', 'note:' + id); if (!n) continue;
      n.exportedAt = now; await DB.put('meta', n);
    }
    localStorage.setItem('campo.lastExport', String(now));
    updatePendingBadge(); renderExport();
    if (!$('#sheetProjects').hidden) renderProjects();
  }
  const markExported = () => S.zip && markIds(S.zip.ids, S.zip.noteIds);
  /* Descarga un archivo; en iPhone la descarga puede quedar solo en vista previa, así que se confirma */
  function saveBlob(blob, name, onSaved) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    if (IS_IOS) setTimeout(() => { if (confirm('¿El ZIP quedó guardado (por ejemplo en Archivos)?\n\nSi no, usa «Compartir» → «Guardar en Archivos».')) onSaved(); }, 1500);
    else onSaved();
  }
  function downloadZip() { if (S.zip) saveBlob(S.zip.blob, S.zip.name, markExported); }
  async function shareZip() {
    try { await navigator.share({ files: [new File([S.zip.blob], S.zip.name, { type: 'application/zip' })], title: S.zip.name }); markExported(); }
    catch (e) { if (e.name !== 'AbortError') toast('No se pudo compartir; usa «Descargar»', 4000); }
  }
  async function wipePoints() {
    if (!S.points.length && !S.notes.length) return;
    const pend = S.points.filter(isPending).length + S.notes.filter(isPending).length;
    const msg = pend
      ? `⚠ Hay ${pend} punto(s) o nota(s) que NUNCA se han exportado. Si los borras se pierden.\n\n¿Borrar de todas formas TODOS los puntos, fotos y notas del proyecto «${projName()}»?`
      : `¿Borrar TODOS los puntos, fotos y notas del proyecto «${projName()}»? (todo ya fue exportado)`;
    if (!confirm(msg)) return;
    for (const p of S.points) await DB.del('points', p.id);
    await DB.del('meta', draftKey());
    for (const n of S.notes) await DB.del('meta', n.k);
    await DB.del('meta', noteDraftKey());
    S.points = []; S.notes = []; S.zip = null; refreshMarkers(); drawNoteMarkers(); renderExport(); toast('Puntos y notas borrados');
  }

  /* ---------- Proyectos ---------- */
  const projRec = name => { const id = uid(); return { k: 'proj:' + id, id, name, createdAt: Date.now(), openedAt: Date.now() }; };
  async function loadAllData() {
    const [layers, points, tracks, meta] = await Promise.all([DB.all('layers'), DB.all('points'), DB.all('tracks'), DB.all('meta')]);
    return { layers, points, tracks, notes: meta.filter(r => r.k && r.k.startsWith('note:')), meta };
  }
  function dataOf(all, pid) {
    const f = r => r.proj === pid;
    return { layers: all.layers.filter(f), points: all.points.filter(f), tracks: all.tracks.filter(f).map(trackStats), notes: all.notes.filter(f) };
  }
  /* Primera vez con la v1.9: todo lo existente pasa a un primer proyecto */
  async function initProjects() {
    const all = await loadAllData();
    S.projects = all.meta.filter(r => r.k && r.k.startsWith('proj:')).sort((a, b) => a.createdAt - b.createdAt);
    if (!S.projects.length) {
      const p = projRec(S.settings.project || 'Proyecto 1');
      await DB.put('meta', p); S.projects = [p];
    }
    const def = S.projects[0];
    for (const [store, list] of [['layers', all.layers], ['points', all.points], ['tracks', all.tracks], ['meta', all.notes]]) {
      for (const r of list) if (!r.proj) { r.proj = def.id; await DB.put(store, r); }
    }
    for (const k of ['draft', 'noteDraft']) { // borradores de versiones anteriores
      const old = all.meta.find(r => r.k === k);
      if (old) { await DB.put('meta', { k: `${k}:${def.id}`, v: old.v }); await DB.del('meta', k); }
    }
    const act = all.meta.find(r => r.k === 'activeProject');
    await loadProject(act && S.projects.some(p => p.id === act.v) ? act.v : def.id, all);
  }
  /* Abre un proyecto: limpia el mapa y carga sus capas, puntos, recorridos y notas */
  async function loadProject(id, all) {
    all = all || await loadAllData();
    const p = S.projects.find(x => x.id === id) || S.projects[0];
    S.proj = p; p.openedAt = Date.now();
    await DB.put('meta', p); await DB.put('meta', { k: 'activeProject', v: p.id });
    S.layers.forEach(l => { if (S.leaf[l.id]) { S.map.removeLayer(S.leaf[l.id]); delete S.leaf[l.id]; } });
    Object.keys(S.trackLines).forEach(k => { S.map.removeLayer(S.trackLines[k]); delete S.trackLines[k]; });
    const D = dataOf(all, p.id);
    S.layers = D.layers.sort((a, b) => a.createdAt - b.createdAt); S.layers.forEach(drawLayer);
    S.points = D.points; S.tracks = D.tracks; S.notes = D.notes;
    refreshMarkers(); S.tracks.forEach(drawTrack); drawNoteMarkers();
    S.zip = null; S.noteEdit = null; S.filter = { lvl: '', cat: '', author: '' };
    const nd = await DB.get('meta', 'noteDraft:' + p.id);
    $('#noteText').value = nd && nd.v ? nd.v : '';
    $('#projName').textContent = p.name;
    document.title = `${p.name} · JMaps M&A`;
    updatePendingBadge();
    if (S.layers.some(l => l.visible)) fitAll();
    else if (S.points.length) S.map.setView([S.points[0].lat, S.points[0].lng], 16);
  }
  async function switchProject(id) {
    if (S.rec) { toast('Detén la grabación del recorrido antes de cambiar de proyecto', 4500); return false; }
    busy('Abriendo proyecto…'); await loadProject(id); unbusy();
    toast(`Proyecto abierto: ${projName()}`);
    return true;
  }
  async function newProject(name) {
    if (S.rec) { toast('Detén la grabación del recorrido antes de crear otro proyecto', 4500); return null; }
    if (name == null) {
      const pend = S.points.filter(isPending).length + S.notes.filter(isPending).length;
      if (pend && !confirm(`«${projName()}» tiene ${pend} punto(s) o nota(s) sin exportar.\n\nRecomendado: descarga primero su paquete en Exportar. Nada se borra: el proyecto queda guardado y puedes volver a él cuando quieras.\n\n¿Crear el proyecto nuevo de todas formas?`)) {
        openSheet('sheetExport'); return null;
      }
      name = (prompt('Nombre del nuevo proyecto (aparece en la marca de agua):', '') || '').trim();
      if (!name) return null;
    }
    const p = projRec(name);
    await DB.put('meta', p); S.projects.push(p);
    await switchProject(p.id);
    return p;
  }
  async function deleteProject(id) {
    const p = S.projects.find(x => x.id === id); if (!p) return;
    if (S.rec && S.proj.id === id) { toast('Detén la grabación del recorrido antes de eliminar este proyecto', 4500); return; }
    const all = await loadAllData(), D = dataOf(all, id);
    const pend = D.points.filter(isPending).length + D.notes.filter(isPending).length;
    const what = `${D.points.length} punto(s), ${D.notes.length} nota(s), ${D.tracks.length} recorrido(s) y ${D.layers.length} capa(s)`;
    if (!confirm(pend ? `⚠ «${p.name}» tiene ${pend} punto(s) o nota(s) que NUNCA se han exportado. Se perderán.\n\n¿Eliminar el proyecto con ${what}?`
      : `¿Eliminar el proyecto «${p.name}» con ${what}?\n\nEsta acción no se puede deshacer.`)) return;
    if (pend && prompt(`Para confirmar, escribe ELIMINAR`) !== 'ELIMINAR') { toast('No se eliminó'); return; }
    busy('Eliminando proyecto…');
    for (const r of D.layers) await DB.del('layers', r.id);
    for (const r of D.points) await DB.del('points', r.id);
    for (const r of D.tracks) await DB.del('tracks', r.id);
    for (const r of D.notes) await DB.del('meta', r.k);
    for (const k of ['draft:', 'noteDraft:', 'proj:']) await DB.del('meta', k + id);
    S.projects = S.projects.filter(x => x.id !== id);
    if (!S.projects.length) { const np = projRec('Proyecto 1'); await DB.put('meta', np); S.projects = [np]; }
    if (S.proj.id === id) await loadProject(S.projects.slice().sort((a, b) => b.openedAt - a.openedAt)[0].id);
    unbusy(); toast(`Proyecto «${p.name}» eliminado`); renderProjects();
  }
  async function renderProjects() {
    const all = await loadAllData();
    $('#projRename').value = projName();
    const box = $('#projList'); box.innerHTML = '';
    const list = S.projects.slice().sort((a, b) => (b.id === S.proj.id) - (a.id === S.proj.id) || b.openedAt - a.openedAt);
    const sel = new Set($$('#projList input[type=checkbox]:checked').map(c => c.value));
    list.forEach(p => {
      const D = dataOf(all, p.id), act = p.id === S.proj.id;
      const nf = D.points.reduce((a, x) => a + x.photos.length, 0);
      const mb = D.points.reduce((a, x) => a + x.photos.reduce((b, f) => b + (f.orig ? f.orig.size : 0) + (f.marked && f.marked !== f.orig ? f.marked.size : 0), 0), 0) / 1048576;
      const pend = D.points.filter(isPending).length + D.notes.filter(isPending).length;
      const last = Math.max(p.openedAt || 0, ...D.points.map(x => x.updatedAt || x.createdAt), ...D.notes.map(x => x.updatedAt || x.createdAt));
      const row = document.createElement('div'); row.className = 'row proj' + (act ? ' active' : '');
      row.innerHTML = `<input type="checkbox" value="${p.id}" aria-label="Seleccionar para descargar" ${sel.has(p.id) ? 'checked' : ''}>
        <div class="grow"><b>${esc(p.name)}</b>
          <small>${D.points.length} punto(s) · ${nf} foto(s) · ${D.notes.length} nota(s)${D.tracks.length ? ` · ${D.tracks.length} recorrido(s)` : ''} · ${mb < 0.1 ? '<0,1' : mb.toFixed(1).replace('.', ',')} MB</small>
          <small>Último uso: ${new Date(last).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}</small>
          <span class="tags">${act ? '<i class="tag open">Abierto</i>' : ''}${pend ? `<i class="tag pend">${pend} sin exportar</i>` : (D.points.length || D.notes.length ? '<i class="tag okk">Exportado</i>' : '')}</span></div>
        ${act ? '' : `<button data-a="open">Abrir</button>`}
        <button class="ico" data-a="del" title="Eliminar proyecto" aria-label="Eliminar proyecto">${ic('trash')}</button>`;
      const o = $('[data-a=open]', row); if (o) o.onclick = async () => { if (await switchProject(p.id)) closeSheets(); };
      $('[data-a=del]', row).onclick = () => deleteProject(p.id);
      $('input', row).onchange = updateProjDl;
      box.appendChild(row);
    });
    updateProjDl(); renderProjFiles();
  }
  function updateProjDl() {
    const n = $$('#projList input:checked').length;
    $('#btnProjDl').disabled = !n;
    $('#btnProjDl').lastChild.textContent = n ? `Descargar ${n} proyecto(s)` : 'Marca los proyectos a descargar';
  }
  function renderProjFiles() {
    const box = $('#projFiles'); box.innerHTML = '';
    S.projFiles.forEach(f => {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<div class="grow"><b>${esc(f.name)}</b><small>${(f.blob.size / 1048576).toFixed(1)} MB${f.saved ? ' · descargado' : ''}</small></div>
        <button class="${f.saved ? '' : 'primary'}" data-a="dl">${ic('download')}Descargar</button>`;
      $('[data-a=dl]', row).onclick = () => saveBlob(f.blob, f.name, async () => { f.saved = true; await markIds(f.ids, f.noteIds); renderProjFiles(); });
      box.appendChild(row);
    });
  }
  /* Descarga varios proyectos: un ZIP con una carpeta por proyecto, o un ZIP por proyecto */
  async function exportProjects() {
    const ids = $$('#projList input:checked').map(c => c.value); if (!ids.length) return;
    const mode = $('#projMode').value, orig = $('#projOrig').checked;
    const all = await loadAllData();
    const pack = id => {
      const p = S.projects.find(x => x.id === id), D = dataOf(all, id);
      const set = D.points.slice().sort((a, b) => a.createdAt - b.createdAt).map((x, i) => ({ p: x, n: i + 1 }));
      const multi = new Set(D.points.map(authorOf).concat(D.notes.map(authorOf)).filter(Boolean)).size > 1;
      return { D: { name: p.name, set, tracks: doneTracks(D.tracks), notes: D.notes.slice().sort((a, b) => a.createdAt - b.createdAt) }, o: { orig, kmz: false, author: multi } };
    };
    S.projFiles = [];
    try {
      if (mode === 'folders') {
        const zip = new JSZip(), used = new Set(); let ids2 = [], nids = [];
        for (let i = 0; i < ids.length; i++) {
          const { D, o } = pack(ids[i]);
          let folder = slug(D.name) || 'proyecto'; while (used.has(folder)) folder += '_'; used.add(folder);
          const r = await fillPackage(zip.folder(folder), D, o, (m, pc) => busy(`${D.name}: ${m}`, Math.round((i + pc / 100) / ids.length * 70)));
          ids2 = ids2.concat(r.ids); nids = nids.concat(r.noteIds);
        }
        const blob = await zipBlob(zip, busy);
        S.projFiles = [{ name: zipName(ids.length === 1 ? S.projects.find(x => x.id === ids[0]).name : 'proyectos'), blob, ids: ids2, noteIds: nids }];
      } else {
        for (let i = 0; i < ids.length; i++) {
          const { D, o } = pack(ids[i]); const zip = new JSZip();
          const r = await fillPackage(zip, D, o, (m, pc) => busy(`${D.name} (${i + 1}/${ids.length}): ${m}`, pc * 0.7));
          const blob = await zipBlob(zip, (m, pc) => busy(`${D.name} (${i + 1}/${ids.length}): ${m}`, pc));
          S.projFiles.push({ name: zipName(D.name), blob, ...r });
        }
      }
    } catch (e) { console.error(e); toast('No se pudo generar: ' + e.message, 6000); }
    unbusy(); renderProjFiles();
    if (S.projFiles.length) toast(S.projFiles.length > 1 ? `${S.projFiles.length} archivos listos: descárgalos uno por uno abajo` : 'Paquete listo: tócalo para descargar', 4000);
  }
  /* Pregunta a qué proyecto va un ZIP importado. Devuelve el id, o null si se cancela */
  function pickProject(fileName, suggested) {
    return new Promise(res => {
      const sel = $('#ppSel');
      sel.innerHTML = S.projects.map(p => `<option value="${p.id}"${p.id === S.proj.id ? ' selected' : ''}>${esc(p.name)}${p.id === S.proj.id ? ' (abierto)' : ''}</option>`).join('')
        + `<option value="__new">➕ Nuevo proyecto…</option>`;
      $('#ppFile').textContent = fileName;
      $('#ppNew').value = suggested || '';
      const sync = () => { $('#ppNewRow').hidden = sel.value !== '__new'; };
      sel.onchange = sync; sync();
      $('#projPick').hidden = false;
      const done = async v => {
        $('#projPick').hidden = true;
        if (v === '__new') {
          const name = $('#ppNew').value.trim() || suggested || 'Proyecto importado';
          const p = await newProject(name); res(p ? p.id : null);
        } else res(v);
      };
      $('#ppOk').onclick = () => done(sel.value);
      $('#ppCancel').onclick = () => { $('#projPick').hidden = true; res(null); };
    });
  }

  /* ---------- Notas de la visita ---------- */
  function renderNotes() {
    const box = $('#noteList'); box.innerHTML = '';
    const ed = S.noteEdit;
    $('#noteTitle').textContent = ed ? 'Editando nota' : 'Nueva nota';
    $('#btnNoteSave').textContent = ed ? 'Guardar cambios' : 'Agregar nota';
    $('#btnNoteCancel').hidden = !ed;
    $('#noteLocRow').hidden = !!ed;
    const gps = S.gps && Date.now() - S.gps.t < 120000;
    $('#noteLocTxt').textContent = gps ? `Guardar con mi ubicación (GPS ±${Math.round(S.gps.acc)} m)` : 'Guardar con mi ubicación (sin GPS ahora)';
    $('#noteLoc').disabled = !gps; if (!gps) $('#noteLoc').checked = false;
    const list = S.notes.slice().sort((a, b) => b.createdAt - a.createdAt);
    $('#noteCount').textContent = list.length ? `(${list.length})` : '';
    if (!list.length) { box.innerHTML = '<p class="empty">Sin notas todavía. Úsalas para lo que no va en un punto: asistentes, acuerdos, clima, pendientes, impresiones generales.</p>'; return; }
    const many = new Set(list.map(authorOf).filter(Boolean)).size > 1;
    let day = '';
    list.forEach(n => {
      const d = new Date(n.createdAt), dk = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
      if (dk !== day) { day = dk; const h = document.createElement('div'); h.className = 'note-day'; h.textContent = dk; box.appendChild(h); }
      const el = document.createElement('article'); el.className = 'note' + (ed && ed.id === n.id ? ' editing' : '');
      const hhmm = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
      el.innerHTML = `<header><span class="meta"><b>${hhmm}</b>${many && authorOf(n) ? `<i class="tag who">${esc(authorOf(n))}</i>` : ''}${isPending(n) ? '<i class="tag pend">Sin exportar</i>' : ''}
          ${n.updatedAt && n.updatedAt - n.createdAt > 60000 ? '<small>editada</small>' : ''}</span>
          <span class="acts">${n.lat != null ? `<button class="ico" data-a="map" title="Ver en el mapa" aria-label="Ver en el mapa">${ic('pin')}</button>` : ''}
          <button class="ico" data-a="edit" title="Editar" aria-label="Editar">${ic('edit')}</button>
          <button class="ico" data-a="del" title="Eliminar" aria-label="Eliminar">${ic('trash')}</button></span></header>
        <p></p>`;
      $('p', el).textContent = n.text;
      const m = $('[data-a=map]', el);
      if (m) m.onclick = () => { closeSheets(); S.map.setView([n.lat, n.lng], Math.max(S.map.getZoom(), 17)); const mk = S.noteMarkers.find(x => x._id === n.id); if (mk) mk.openPopup(); };
      $('[data-a=edit]', el).onclick = () => { S.noteEdit = n; $('#noteText').value = n.text; renderNotes(); $('#noteText').focus(); $('#sheetNotes .sheet-body').scrollTop = 0; };
      $('[data-a=del]', el).onclick = async () => {
        if (!confirm('¿Eliminar esta nota?')) return;
        await DB.del('meta', n.k); S.notes = S.notes.filter(x => x !== n);
        if (S.noteEdit === n) { S.noteEdit = null; $('#noteText').value = ''; }
        drawNoteMarkers(); updatePendingBadge(); renderNotes();
      };
      box.appendChild(el);
    });
  }
  async function saveNote() {
    const text = $('#noteText').value.trim();
    if (!text) { toast('Escribe la nota'); $('#noteText').focus(); return; }
    if (!S.dbReady) { toast('El almacenamiento aún no está listo. Cierra otras pestañas o ventanas de la app.', 5000); return; }
    let n = S.noteEdit;
    if (n) { n.text = text; n.updatedAt = Date.now(); }
    else {
      const id = uid(), loc = $('#noteLoc').checked && S.gps ? S.gps : null;
      n = { k: 'note:' + id, id, proj: S.proj.id, text, createdAt: Date.now(), updatedAt: Date.now(), author: S.settings.author, lat: loc ? loc.lat : null, lng: loc ? loc.lng : null, exportedAt: null };
      S.notes.push(n);
    }
    await DB.put('meta', n);
    await DB.del('meta', noteDraftKey()).catch(() => { });
    toast(S.noteEdit ? 'Nota actualizada' : 'Nota guardada');
    S.noteEdit = null; $('#noteText').value = '';
    drawNoteMarkers(); updatePendingBadge(); renderNotes();
  }
  let noteDraftT = 0;
  function persistNoteDraft() { // lo que se está escribiendo no se pierde si se cierra la app
    clearTimeout(noteDraftT);
    noteDraftT = setTimeout(() => { if (!S.noteEdit) DB.put('meta', { k: noteDraftKey(), v: $('#noteText').value }).catch(() => { }); }, 600);
  }
  function drawNoteMarkers() {
    S.noteMarkers.forEach(m => S.map.removeLayer(m)); S.noteMarkers = [];
    S.notes.filter(n => n.lat != null).forEach(n => {
      const icon = L.divIcon({ className: '', html: `<div class="note-pin">${ic('note')}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
      const mk = L.marker([n.lat, n.lng], { icon, zIndexOffset: -50 }).addTo(S.map);
      const txt = n.text.length > 220 ? n.text.slice(0, 220) + '…' : n.text;
      mk.bindPopup(`<div class="note-pop"><small>${Watermark.fmtDate(n.createdAt)}${authorOf(n) ? ' · ' + esc(authorOf(n)) : ''}</small><p>${esc(txt).replace(/\n/g, '<br>')}</p></div>`);
      mk._id = n.id; S.noteMarkers.push(mk);
    });
  }

  /* ---------- Consolidar: importar el ZIP de otra persona ---------- */
  const LVL_BY_NAME = { alto: 'alto', medio: 'medio', bajo: 'bajo' };
  function parseFecha(t) { // "dd/mm/aaaa hh:mm" (paquetes v1.5)
    const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/.exec(t || '');
    return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).getTime() : Date.now();
  }
  function hashId(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return 'imp' + (h >>> 0).toString(36); }
  // paquetes exportados con la v1.5 (sin levantamiento.json): se reconstruyen desde puntos.geojson
  function legacyManifest(geo) {
    const man = { author: '', points: [], tracks: [] };
    (geo.features || []).forEach(f => {
      const pr = f.properties || {}, g = f.geometry || {};
      if (g.type === 'Point') {
        const t = parseFecha(pr.fecha_hora), [lng, lat] = g.coordinates;
        const hd = pr.rumbos_grados || [];
        man.points.push({ id: hashId(`${pr.nombre}|${lat}|${lng}|${pr.fecha_hora}`), name: pr.nombre || 'Punto', desc: pr.descripcion || '',
          cat: pr.categoria || '', level: LVL_BY_NAME[(pr.nivel || '').toLowerCase()] || '', lat, lng, createdAt: t, updatedAt: t, author: pr.autor || '',
          photos: (pr.fotos || []).map((fp, k) => ({ id: uid(), takenAt: t, heading: hd[k] == null ? null : hd[k], headingSrc: hd[k] == null ? null : 'exif', file: fp, orig: fp.replace(/^fotos\//, 'fotos_originales/') })) });
      } else if (g.type === 'MultiLineString' && pr.tipo === 'recorrido') {
        const t0 = Date.parse(pr.inicio) || Date.now(), t1 = Date.parse(pr.fin) || t0;
        man.tracks.push({ id: hashId(`${pr.nombre}|${pr.inicio}`), name: pr.nombre || 'Recorrido', createdAt: t0, endedAt: t1, author: '', segs: g.coordinates.map(sg => sg.map(c => [c[0], c[1], t0, 0])) });
      }
    });
    return man;
  }
  const jpg = async f => new Blob([await f.async('arraybuffer')], { type: 'image/jpeg' });
  async function importZip(file) {
    busy(`Leyendo ${file.name}…`, 0);
    try {
      const zip = await JSZip.loadAsync(file);
      let man;
      if (zip.file('levantamiento.json')) man = JSON.parse(await zip.file('levantamiento.json').async('string'));
      else if (zip.file('puntos.geojson')) man = legacyManifest(JSON.parse(await zip.file('puntos.geojson').async('string')));
      else throw new Error('no parece un paquete de JMaps (falta levantamiento.json o puntos.geojson)');
      unbusy();
      const target = await pickProject(file.name, man.project || file.name.replace(/\.zip$/i, '').replace(/^JMaps_MA_/, ''));
      if (!target) { toast('Importación cancelada'); return; }
      if (target !== S.proj.id && !(await switchProject(target))) return;
      let who = man.author || '';
      if (!who || man.points.some(p => !p.author)) {
        who = (prompt(`¿De quién es el levantamiento «${file.name}»?\n(nombre que aparecerá como autor)`, who) || who || 'Sin nombre').trim();
      }
      let add = 0, upd = 0, same = 0, noOrig = 0, done = 0;
      const total = man.points.length;
      for (const ip of man.points) {
        busy(`Importando puntos (${++done}/${total})…`, Math.round(done / Math.max(1, total) * 100));
        const ex = S.points.find(p => p.id === ip.id);
        if (ex && (ex.updatedAt || ex.createdAt) >= (ip.updatedAt || ip.createdAt)) { same++; continue; }
        const photos = [];
        for (const ph of ip.photos || []) {
          const mf = ph.file && zip.file(ph.file), of = ph.orig && zip.file(ph.orig);
          if (!mf && !of) continue;
          const marked = mf ? await jpg(mf) : null, orig = of ? await jpg(of) : null;
          if (!orig) noOrig++;
          photos.push({ id: ph.id || uid(), takenAt: ph.takenAt || ip.createdAt, heading: ph.heading == null ? null : ph.heading, headingSrc: ph.headingSrc || null,
            orig: orig || marked, marked, markedFor: null, locked: !orig });
        }
        let pid = ip.id; // el mismo ZIP importado en otro proyecto: se copia con id nuevo
        if (!ex) { const other = await DB.get('points', pid); if (other && other.proj !== S.proj.id) pid = uid(); }
        const rec = { id: pid, proj: S.proj.id, name: ip.name, desc: ip.desc || '', cat: ip.cat || '', level: ip.level || '', lat: ip.lat, lng: ip.lng,
          createdAt: ip.createdAt, updatedAt: ip.updatedAt || ip.createdAt, author: ip.author || who, exportedAt: null, photos };
        // la marca que trae cada foto se da por válida mientras no se edite el punto
        rec.photos.forEach(ph => { if (ph.marked) ph.markedFor = photoSig(rec, ph); });
        await DB.put('points', rec);
        const k = S.points.findIndex(p => p.id === rec.id);
        if (k >= 0) { S.points[k] = rec; upd++; } else { S.points.push(rec); add++; }
        if (done % 3 === 0) await sleep(0);
      }
      let nt = 0;
      for (const it of man.tracks || []) {
        if (S.tracks.some(t => t.id === it.id)) continue;
        const otherT = await DB.get('tracks', it.id);
        const t = trackStats({ id: otherT ? uid() : it.id, proj: S.proj.id, name: `${it.name} (${it.author || who})`, createdAt: it.createdAt, endedAt: it.endedAt || it.createdAt, author: it.author || who, segs: it.segs, visible: true, dist: 0 });
        await DB.put('tracks', t); S.tracks.push(t); drawTrack(t); nt++;
      }
      let nn = 0;
      for (const n of man.notes || []) {
        const ex = S.notes.find(x => x.id === n.id);
        if (ex && (ex.updatedAt || ex.createdAt) >= (n.updatedAt || n.createdAt)) continue;
        let nid = n.id;
        if (!ex) { const other = await DB.get('meta', 'note:' + nid); if (other && other.proj !== S.proj.id) nid = uid(); }
        const rec = { k: 'note:' + nid, id: nid, proj: S.proj.id, text: n.text || '', createdAt: n.createdAt, updatedAt: n.updatedAt || n.createdAt, author: n.author || who, lat: n.lat == null ? null : n.lat, lng: n.lng == null ? null : n.lng, exportedAt: null };
        await DB.put('meta', rec);
        const k = S.notes.findIndex(x => x.id === rec.id); if (k >= 0) S.notes[k] = rec; else S.notes.push(rec);
        nn++;
      }
      drawNoteMarkers();
      unbusy(); refreshMarkers(); renderExport();
      const parts = [add && `${add} punto(s) nuevo(s)`, upd && `${upd} actualizado(s)`, same && `${same} punto(s) sin cambios`, nt && `${nt} recorrido(s)`, nn && `${nn} nota(s)`].filter(Boolean).join(', ') || 'nada nuevo';
      toast(`Importado a «${projName()}» de ${who}: ${parts}.${noOrig ? ` ${noOrig} foto(s) llegaron sin original.` : ''}`, 6000);
    } catch (e) {
      unbusy(); console.error(e); toast(`No se pudo importar ${file.name}: ${e.message}`, 6000);
    }
  }

  /* ---------- Protección de datos ---------- */
  function updatePendingBadge() {
    const n = S.points.filter(isPending).length + S.notes.filter(isPending).length, b = $('#expBadge');
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
  async function checkReminder() {
    if (!S.dbReady) return;
    const all = await loadAllData();
    const pend = all.points.filter(isPending).concat(all.notes.filter(isPending));
    if (!pend.length) { $('#remindBanner').hidden = true; return; }
    const oldest = Math.min(...pend.map(p => p.updatedAt || p.createdAt));
    const snooze = +localStorage.getItem('campo.remindSnooze') || 0;
    if (Date.now() - oldest < REMIND_HOURS * 3600e3 || Date.now() < snooze) return;
    const days = Math.max(1, Math.round((Date.now() - oldest) / 86400e3));
    const np = new Set(pend.map(r => r.proj)).size;
    $('#remindText').textContent = `Tienes ${pend.length} punto(s) o nota(s) sin exportar${np > 1 ? ` en ${np} proyectos` : ''} desde hace ${days} día(s). Descarga el paquete para no perderlos.`;
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
    const t = { id: uid(), name: `Recorrido ${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`, createdAt: Date.now(), endedAt: null, segs: [[]], dist: 0, visible: true, author: S.settings.author, proj: S.proj.id };
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
    $('#sProject').value = projName();
    $('#sAuthor').value = S.settings.author;
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
    $('#btnNoteSave').onclick = saveNote;
    $('#btnNoteCancel').onclick = () => { S.noteEdit = null; $('#noteText').value = ''; renderNotes(); };
    $('#noteText').oninput = persistNoteDraft;
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
    $('#optOrig').onchange = () => { S.zip = null; renderExport(); };
    $('#catFilter').onchange = e => { S.filter.cat = e.target.value; renderPoints(); };
    $('#remindGo').onclick = () => { $('#remindBanner').hidden = true; openSheet('sheetProjects'); };
    $('#remindX').onclick = () => { $('#remindBanner').hidden = true; localStorage.setItem('campo.remindSnooze', String(Date.now() + 12 * 3600e3)); };
    $('#offArea').onchange = renderOffline; $('#offZoom').onchange = renderOffline;
    $('#btnOffDl').onclick = downloadOffline;
    $('#busyCancel').onclick = () => { if (S.dl) S.dl.cancel = true; $('#busyMsg').textContent = 'Deteniendo…'; };

    const rename = async v => { v = v.trim(); if (!v || !S.proj) return; S.proj.name = v; await DB.put('meta', S.proj); $('#projName').textContent = v; document.title = `${v} · JMaps M&A`; };
    $('#sProject').onchange = e => rename(e.target.value);
    $('#projRename').onchange = async e => { await rename(e.target.value); renderProjects(); };
    $('#btnProj').onclick = () => openSheet('sheetProjects');
    $('#btnProjNew').onclick = async () => { if (await newProject()) closeSheets(); };
    $('#btnProjDl').onclick = exportProjects;
    $('#projMode').onchange = () => { S.projFiles = []; renderProjFiles(); };
    $('#sAuthor').oninput = e => { S.settings.author = e.target.value.trim(); saveSettings(); };
    $('#optAuthor').onchange = e => { e.target.dataset.touched = '1'; S.zip = null; renderExport(); };
    $('#authorFilter').onchange = e => { S.filter.author = e.target.value; renderPoints(); };
    $('#inImport').onchange = async e => { const fs = Array.from(e.target.files); e.target.value = ''; for (const f of fs) await importZip(f); };
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
    DB.hooks.blocked = () => { $('#blockBanner').hidden = false; };
    DB.hooks.closed = () => { S.dbReady = false; S.updateReady = true; tryUpdate(); };
    if ('serviceWorker' in navigator) {
      const had = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => { });
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) { S.updateReady = true; tryUpdate(); } });
    }
    try { await DB.open(); } catch (e) { toast('No se pudo abrir el almacenamiento local: ' + e.message, 8000); return; }
    S.dbReady = true; $('#blockBanner').hidden = true;
    await initProjects();
    const open = S.tracks.find(t => !t.endedAt); // la app se cerró grabando: se reanuda
    if (open) { S.rec = { t: open, saveT: 0 }; updateRecUi(); toast('Se reanudó la grabación del recorrido', 4000); }
    setInterval(() => { if (S.rec) updateRecUi(); }, 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { keepAwake(); checkReminder(); }
      else if (S.rec) DB.put('tracks', S.rec.t).catch(() => { });
    });
    checkReminder();
    startGps(); startOrientation();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
    // recuperar un punto sin guardar (p. ej. si el navegador se recargó al volver de la cámara)
    const m = await DB.get('meta', draftKey());
    if (m && m.v && m.v.photos) { S.draft = m.v; toast('Se recuperó un punto sin guardar'); openForm(); }
  }
  init();
  window.__campo = S; // útil para depuración
})();
