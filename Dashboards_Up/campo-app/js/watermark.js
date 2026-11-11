/* Minimapa con capas + marca de agua sobre la foto (identidad ERCO): rumbo, categoría y nivel */
const BASEMAPS = {
  sat: { name: 'Satélite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxNative: 18, attr: 'Esri, Maxar, Earthstar Geographics' },
  osm: { name: 'Calles', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxNative: 19, attr: '© OpenStreetMap' }
};

const Watermark = (() => {
  const BRAND = { black: '#121212', gray: '#F5F5F6', lime: '#9ECC14', limeLight: '#BDE732', yellow: '#E3DD16' };
  const SORA = 'Sora, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const INTER = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const pad2 = n => String(n).padStart(2, '0');
  const fmtDate = t => { const d = new Date(t); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

  const mercX = (lng, z) => (lng + 180) / 360 * 256 * Math.pow(2, z);
  const mercY = (lat, z) => {
    lat = Math.max(-85.0511, Math.min(85.0511, lat));
    const s = Math.sin(lat * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z);
  };

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function loadImage(url, ms = 6000, cors = true) {
    return new Promise(res => {
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      const t = setTimeout(() => { img.src = ''; res(null); }, ms);
      img.onload = () => { clearTimeout(t); res(img); };
      img.onerror = () => { clearTimeout(t); res(null); };
      img.src = url;
    });
  }

  let logoP = null;
  const getLogo = () => logoP || (logoP = loadImage('icons/isologo.png', 4000, false));
  async function ensureFonts() {
    try {
      if (!document.fonts) return;
      await Promise.race([
        Promise.all([document.fonts.load('700 24px Sora'), document.fonts.load('400 24px Sora'), document.fonts.load('500 24px Inter'), document.fonts.load('400 24px Inter')]),
        new Promise(r => setTimeout(r, 2500))
      ]);
    } catch (e) { /* usa fuente de respaldo */ }
  }

  function drawFeature(ctx, f, X, Y, color, lw, rp) {
    const g = f.geometry;
    if (g.type === 'Point') {
      ctx.beginPath(); ctx.arc(X(g.coordinates[0]), Y(g.coordinates[1]), rp, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = lw * 0.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    } else if (g.type === 'LineString') {
      ctx.beginPath();
      g.coordinates.forEach((c, i) => i ? ctx.lineTo(X(c[0]), Y(c[1])) : ctx.moveTo(X(c[0]), Y(c[1])));
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke();
    } else if (g.type === 'Polygon') {
      ctx.beginPath();
      g.coordinates.forEach(r => { r.forEach((c, i) => i ? ctx.lineTo(X(c[0]), Y(c[1])) : ctx.moveTo(X(c[0]), Y(c[1]))); ctx.closePath(); });
      ctx.globalAlpha = 0.18; ctx.fillStyle = color; ctx.fill('evenodd'); ctx.globalAlpha = 1;
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke();
    }
  }

  /* o: {lat,lng,zoom,size,base,layers:[{name,color,features}],others:[{lat,lng}]} */
  async function renderMinimap(o) {
    await ensureFonts();
    const S = o.size, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const bm = BASEMAPS[o.base] || BASEMAPS.sat;
    const z = Math.max(3, Math.min(20, Math.round(o.zoom)));
    const zt = Math.min(z, bm.maxNative), sc = Math.pow(2, z - zt);

    ctx.fillStyle = '#2a2f2a'; ctx.fillRect(0, 0, S, S);

    // 1) Teselas del mapa base
    const win = S / sc;
    const tlx = mercX(o.lng, zt) - win / 2, tly = mercY(o.lat, zt) - win / 2;
    const n = Math.pow(2, zt), jobs = [];
    for (let tx = Math.floor(tlx / 256); tx <= Math.floor((tlx + win) / 256); tx++) {
      for (let ty = Math.floor(tly / 256); ty <= Math.floor((tly + win) / 256); ty++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n;
        const url = bm.url.replace('{z}', zt).replace('{x}', wx).replace('{y}', ty);
        jobs.push(loadImage(url).then(img => ({ img, tx, ty })));
      }
    }
    const tiles = await Promise.all(jobs);
    let loaded = 0;
    ctx.imageSmoothingQuality = 'high';
    tiles.forEach(t => {
      if (!t.img) return; loaded++;
      ctx.drawImage(t.img, (t.tx * 256 - tlx) * sc, (t.ty * 256 - tly) * sc, 256 * sc + 0.5, 256 * sc + 0.5);
    });
    if (!loaded) { // sin conexión y sin caché: cuadrícula tenue
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
      for (let i = 0; i <= S; i += S / 8) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke(); }
    }

    // 2) Capas vectoriales (proyectadas a z real)
    const cx = mercX(o.lng, z), cy = mercY(o.lat, z), x0 = cx - S / 2, y0 = cy - S / 2;
    const X = lng => mercX(lng, z) - x0, Y = lat => mercY(lat, z) - y0;
    const lw = Math.max(2.5, S * 0.0065), rp = S * 0.013;
    const hit = [];
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip();
    (o.layers || []).forEach(l => {
      let any = false;
      l.features.forEach(f => {
        const b = f.bbox;
        if (b) {
          const xa = X(b[0]), xb = X(b[2]), ya = Y(b[3]), yb = Y(b[1]);
          if (xb < -4 || xa > S + 4 || yb < -4 || ya > S + 4) return;
        }
        any = true;
        drawFeature(ctx, f, X, Y, l.color, lw, rp);
      });
      if (any) hit.push({ name: l.name, color: l.color });
    });
    // otros puntos del levantamiento
    (o.others || []).forEach(p => {
      const px = X(p.lng), py = Y(p.lat);
      if (px < 0 || px > S || py < 0 || py > S) return;
      ctx.beginPath(); ctx.arc(px, py, S * 0.016, 0, Math.PI * 2);
      ctx.fillStyle = BRAND.yellow; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    });
    ctx.restore();

    // 3) Punto actual (lima de marca con halo negro y blanco para contraste)
    const dot = (r, c) => { ctx.beginPath(); ctx.arc(S / 2, S / 2, S * r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); };
    dot(0.040, BRAND.black); dot(0.034, '#fff'); dot(0.024, BRAND.lime); dot(0.0075, BRAND.black);

    // 4) Norte, escala y atribución
    const fs = S * 0.04;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 4;
    ctx.fillStyle = '#fff'; ctx.font = `700 ${fs}px ${SORA}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('N', S - S * 0.075, S * 0.085);
    ctx.beginPath(); ctx.moveTo(S - S * 0.075, S * 0.03); ctx.lineTo(S - S * 0.075 - S * 0.022, S * 0.08); ctx.lineTo(S - S * 0.075 + S * 0.022, S * 0.08); ctx.closePath(); ctx.fill();
    // barra de escala
    const mpp = 40075016.686 * Math.cos(o.lat * Math.PI / 180) / (256 * Math.pow(2, z));
    const target = mpp * S * 0.28, steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    let m = steps[0]; steps.forEach(s => { if (s <= target) m = s; });
    const barW = m / mpp, bx = S * 0.06, by = S - S * 0.085;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(3, S * 0.008);
    ctx.beginPath(); ctx.moveTo(bx, by - S * 0.015); ctx.lineTo(bx, by); ctx.lineTo(bx + barW, by); ctx.lineTo(bx + barW, by - S * 0.015); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.font = `600 ${S * 0.036}px ${SORA}`;
    ctx.fillText(m >= 1000 ? `${m / 1000} km` : `${m} m`, bx, by - S * 0.02);
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.font = `${S * 0.026}px ${INTER}`;
    ctx.fillText(bm.attr, S - S * 0.15, S - S * 0.02); // margen amplio: la esquina del minimapa es redondeada
    ctx.restore();

    return { canvas: cv, legend: hit, tilesLoaded: loaded };
  }

  /* Copia el minimapa y dibuja el cono de visión de la foto (rumbo) desde el punto central */
  function withHeading(mini, heading) {
    const S = mini.width, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx = cv.getContext('2d'); ctx.drawImage(mini, 0, 0);
    const c = S / 2, r = S * 0.34, a = (heading - 90) * Math.PI / 180, half = 28 * Math.PI / 180;
    const g = ctx.createRadialGradient(c, c, S * 0.03, c, c, r);
    g.addColorStop(0, 'rgba(189,231,50,0.75)'); g.addColorStop(1, 'rgba(189,231,50,0.08)');
    ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, r, a - half, a + half); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(2, S * 0.005); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
    const dot = (rr, col) => { ctx.beginPath(); ctx.arc(c, c, S * rr, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); };
    dot(0.040, BRAND.black); dot(0.034, '#fff'); dot(0.024, BRAND.lime); dot(0.0075, BRAND.black);
    return cv;
  }

  function wrap(ctx, text, maxW, maxLines) {
    const words = text.split(/\s+/), lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      let l = lines[maxLines - 1];
      while (l.length > 1 && ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1);
      lines[maxLines - 1] = l + '…';
    }
    return lines.map(l => { // palabra demasiado larga
      while (l.length > 1 && ctx.measureText(l).width > maxW) l = l.slice(0, -2) + '…';
      return l;
    });
  }

  const toBlob = (cv, q) => new Promise(r => cv.toBlob(r, 'image/jpeg', q));
  // createImageBitmap con respaldo para iPhone con iOS antiguo
  async function toBitmap(blob) {
    try { if (window.createImageBitmap) return await createImageBitmap(blob); } catch (e) { /* respaldo */ }
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(blob), im = new Image();
      im.onload = () => { res(im); URL.revokeObjectURL(u); }; im.onerror = rej; im.src = u;
    });
  }

  /* Arma las líneas de texto y reduce la fuente hasta que quepan en maxH */
  function layoutText(ctx, o, fs0, maxW, maxH) {
    let fs = fs0, lines;
    for (let i = 0; i < 12; i++) {
      lines = [];
      const fName = `700 ${fs * 1.3}px ${SORA}`;
      ctx.font = fName;
      wrap(ctx, o.name || '—', maxW, 2).forEach(t => lines.push({ t, f: fName, h: fs * 1.3 * 1.2, c: '#fff' }));
      const fDate = `600 ${fs}px ${SORA}`, f1 = `500 ${fs}px ${INTER}`;
      lines.push({ t: fmtDate(o.takenAt), f: fDate, h: fs * 1.3, c: BRAND.limeLight });
      lines.push({ t: `Lat: ${o.lat.toFixed(6)}°`, f: f1, h: fs * 1.25, c: '#fff' });
      lines.push({ t: `Lon: ${o.lng.toFixed(6)}°`, f: f1, h: fs * 1.25, c: '#fff' });
      if (o.heading != null) lines.push({ t: `Rumbo: ${Compass.label(o.heading)}`, f: f1, h: fs * 1.25, c: '#fff', arrow: o.heading });
      if (o.tag) lines.push({ t: o.tag, f: `600 ${fs * 0.9}px ${SORA}`, h: fs * 1.3, c: '#fff', dot: o.tagColor || BRAND.lime });
      if (o.project) { const fp = `500 ${fs * 0.9}px ${INTER}`; ctx.font = fp; wrap(ctx, o.project, maxW, 1).forEach(t => lines.push({ t, f: fp, h: fs * 1.2, c: '#dfe4e1' })); }
      if (o.legend && o.legend.length) lines.push({ legend: true, f: `500 ${fs * 0.78}px ${INTER}`, h: fs * 1.15 });
      lines.total = lines.reduce((a, l) => a + l.h, 0);
      if (lines.total <= maxH) break;
      fs *= 0.92;
    }
    // ancho real ocupado (para ajustar la tarjeta al contenido)
    let w = 0;
    lines.forEach(l => {
      ctx.font = l.f;
      if (l.legend) {
        const sq = fs * 0.62; let x = 0;
        for (const it of o.legend) { const iw = ctx.measureText(it.name).width + sq + fs * 0.9; if (x + iw > maxW && x) break; x += iw; }
        w = Math.max(w, Math.min(maxW, x));
      } else w = Math.max(w, ctx.measureText(l.t).width + (l.arrow != null || l.dot ? fs * 1.15 : 0));
    });
    return { lines, fs, width: Math.min(maxW, w) };
  }

  function drawText(ctx, o, L, tx, y, maxW, base) {
    const fs = L.fs;
    ctx.save();
    // sombra más marcada: el fondo ahora es translúcido
    ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = base * 0.006; ctx.shadowOffsetY = base * 0.0012;
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    L.lines.forEach(l => {
      ctx.font = l.f;
      if (l.legend) {
        const sq = fs * 0.62; let x = tx, shown = 0;
        for (const it of o.legend) {
          const w = ctx.measureText(it.name).width + sq + fs * 0.9;
          if (x + w > tx + maxW && shown) break;
          ctx.fillStyle = it.color; ctx.fillRect(x, y + fs * 0.12, sq, sq);
          ctx.fillStyle = '#fff'; ctx.fillText(it.name, x + sq + fs * 0.25, y);
          x += w; shown++;
        }
        const rest = o.legend.length - shown;
        if (rest > 0) { ctx.fillStyle = '#dfe4e1'; ctx.fillText(`+${rest}`, x, y); }
      } else if (l.arrow != null) { // flecha girada según el rumbo
        const s = fs * 0.5, cx = tx + s, cy = y + fs * 0.55;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(l.arrow * Math.PI / 180);
        ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.62, s * 0.8); ctx.lineTo(0, s * 0.38); ctx.lineTo(-s * 0.62, s * 0.8); ctx.closePath();
        ctx.fillStyle = BRAND.limeLight; ctx.fill(); ctx.restore();
        ctx.fillStyle = l.c; ctx.fillText(l.t, tx + fs * 1.15, y);
      } else if (l.dot) { // etiqueta de categoría con el color del nivel
        ctx.beginPath(); ctx.arc(tx + fs * 0.4, y + fs * 0.52, fs * 0.36, 0, Math.PI * 2);
        ctx.fillStyle = l.dot; ctx.fill(); ctx.lineWidth = Math.max(1, fs * 0.08); ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.fillStyle = l.c; ctx.fillText(l.t, tx + fs * 1.15, y);
      } else { ctx.fillStyle = l.c; ctx.fillText(l.t, tx, y); }
      y += l.h;
    });
    ctx.restore();
  }

  function drawMinimap(ctx, mini, mx, my, mm, base) {
    const rad = mm * 0.14;
    ctx.save(); rr(ctx, mx, my, mm, mm, rad); ctx.clip(); ctx.drawImage(mini, mx, my, mm, mm); ctx.restore();
    rr(ctx, mx, my, mm, mm, rad); ctx.lineWidth = Math.max(2, base * 0.003); ctx.strokeStyle = '#fff'; ctx.stroke();
  }

  function drawLogo(ctx, logo, x, y, s, base) {
    if (!logo) return;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = base * 0.008;
    ctx.drawImage(logo, x, y, s, s); ctx.restore();
  }

  /* Estilo «tarjeta» (recomendado): degradado suave abajo + tarjeta compacta en la esquina.
     La foto queda visible en todo el ancho; solo la esquina inferior izquierda lleva datos. */
  function composeCard(ctx, W, H, o, logo) {
    const base = Math.min(W, H), pad = Math.round(base * 0.022);
    const mm = Math.round(base * 0.22), ip = Math.round(base * 0.018); // minimapa e interior de la tarjeta
    const cardH = mm + ip * 2, cy = H - pad - cardH, cx = pad;

    // Degradado sutil para dar contraste sin tapar (transparente → 45 %)
    const gH = Math.round(cardH + pad * 3);
    const g = ctx.createLinearGradient(0, H - gH, 0, H);
    g.addColorStop(0, 'rgba(18,18,18,0)'); g.addColorStop(1, 'rgba(18,18,18,0.45)');
    ctx.fillStyle = g; ctx.fillRect(0, H - gH, W, gH);

    const lg = logo ? Math.round(base * 0.075) : 0;
    const tx0 = cx + ip + mm + ip * 1.2;
    const maxW = Math.min(W * 0.62, W - tx0 - pad * 2 - (lg ? lg + pad : 0));
    const L = layoutText(ctx, o, base * 0.026, maxW, mm);
    const cardW = Math.round(tx0 - cx + L.width + ip * 1.4);

    // Tarjeta translúcida (50 %) con borde lima fino
    rr(ctx, cx, cy, cardW, cardH, mm * 0.18);
    ctx.fillStyle = 'rgba(18,18,18,0.50)'; ctx.fill();
    ctx.lineWidth = Math.max(1.5, base * 0.0022); ctx.strokeStyle = 'rgba(158,204,20,0.85)'; ctx.stroke();

    drawMinimap(ctx, o.minimap, cx + ip, cy + ip, mm, base);
    drawText(ctx, o, L, tx0, cy + ip + (mm - L.lines.total) / 2, maxW, base);
    drawLogo(ctx, logo, W - pad - lg, H - pad - lg, lg, base);
  }

  /* Estilo «franja»: franja de ancho completo, más baja y translúcida (degradado 20 % → 55 %) */
  function composeBand(ctx, W, H, o, logo) {
    const base = Math.min(W, H), pad = Math.round(base * 0.02);
    const mm = Math.round(base * 0.24), bandH = mm + pad * 2, top = H - bandH;

    const g = ctx.createLinearGradient(0, top, 0, H);
    g.addColorStop(0, 'rgba(18,18,18,0.20)'); g.addColorStop(1, 'rgba(18,18,18,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, top, W, bandH);
    ctx.fillStyle = BRAND.lime; ctx.fillRect(0, top, W, Math.max(2, Math.round(base * 0.003)));

    const mx = pad, my = top + pad;
    drawMinimap(ctx, o.minimap, mx, my, mm, base);
    const lg = logo ? Math.round(mm * 0.28) : 0;
    drawLogo(ctx, logo, W - pad - lg, my, lg, base);

    const tx = pad * 2 + mm, maxW = W - tx - pad - (lg ? lg + pad : 0);
    const L = layoutText(ctx, o, base * 0.03, maxW, mm);
    drawText(ctx, o, L, tx, my + (mm - L.lines.total) / 2, maxW, base);
  }

  /* o: {minimap(canvas), legend, name, lat, lng, takenAt, project, style:'card'|'band', heading, tag, tagColor} */
  async function compose(photoBlob, o) {
    await ensureFonts();
    const logo = await getLogo();
    const bmp = await toBitmap(photoBlob);
    const W = bmp.width || bmp.naturalWidth, H = bmp.height || bmp.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();

    if (o.heading != null) o = Object.assign({}, o, { minimap: withHeading(o.minimap, o.heading) });
    if (o.style === 'band') composeBand(ctx, W, H, o, logo);
    else composeCard(ctx, W, H, o, logo);

    const blob = await toBlob(cv, 0.88);
    return Exif.insert(blob, { lat: o.lat, lng: o.lng, date: o.takenAt, heading: o.heading });
  }

  async function resizeImage(file, maxSide, q = 0.9) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); if (!bmp.width) throw 0; }
    catch (e) {
      bmp = await new Promise((res, rej) => {
        const u = URL.createObjectURL(file), im = new Image();
        im.onload = () => { res(im); URL.revokeObjectURL(u); }; im.onerror = rej; im.src = u;
      });
    }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const k = Math.min(1, maxSide / Math.max(w, h));
    const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    if (bmp.close) bmp.close();
    return toBlob(cv, q);
  }

  return { renderMinimap, compose, resizeImage, fmtDate };
})();
