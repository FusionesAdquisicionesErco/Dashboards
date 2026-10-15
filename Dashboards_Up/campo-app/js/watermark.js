/* Minimapa con capas + marca de agua sobre la foto (identidad ERCO) */
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

  /* o: {minimap(canvas), legend, name, lat, lng, takenAt, project} */
  async function compose(photoBlob, o) {
    await ensureFonts();
    const logo = await getLogo();
    const bmp = await createImageBitmap(photoBlob);
    const W = bmp.width, H = bmp.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();

    const base = Math.min(W, H), pad = Math.round(base * 0.025);
    const mm = Math.round(base * 0.34), bandH = mm + pad * 2, top = H - bandH;

    // Franja negra de marca con filo lima
    ctx.fillStyle = 'rgba(18,18,18,0.80)'; ctx.fillRect(0, top, W, bandH);
    ctx.fillStyle = BRAND.lime; ctx.fillRect(0, top, W, Math.max(3, Math.round(base * 0.005)));

    // Minimapa con esquinas redondeadas
    const mx = pad, my = top + pad, rad = mm * 0.14;
    ctx.save(); rr(ctx, mx, my, mm, mm, rad); ctx.clip(); ctx.drawImage(o.minimap, mx, my, mm, mm); ctx.restore();
    rr(ctx, mx, my, mm, mm, rad); ctx.lineWidth = Math.max(2, base * 0.003); ctx.strokeStyle = '#fff'; ctx.stroke();

    // Isologo (arriba a la derecha de la franja)
    const lg = logo ? Math.round(mm * 0.24) : 0;
    if (logo) ctx.drawImage(logo, W - pad - lg, my, lg, lg);

    const tx = pad * 2 + mm, maxW = W - tx - pad - (lg ? lg + pad : 0);
    let fs = base * 0.036, lines;
    for (let i = 0; i < 10; i++) {
      lines = [];
      const fName = `700 ${fs * 1.3}px ${SORA}`;
      ctx.font = fName;
      wrap(ctx, o.name || '—', maxW, 3).forEach(t => lines.push({ t, f: fName, h: fs * 1.3 * 1.2, c: '#fff' }));
      const fDate = `600 ${fs}px ${SORA}`, f1 = `500 ${fs}px ${INTER}`;
      lines.push({ t: fmtDate(o.takenAt), f: fDate, h: fs * 1.3, c: BRAND.lime });
      lines.push({ t: `Lat: ${o.lat.toFixed(6)}°`, f: f1, h: fs * 1.25, c: '#fff' });
      lines.push({ t: `Lon: ${o.lng.toFixed(6)}°`, f: f1, h: fs * 1.25, c: '#fff' });
      if (o.project) { const fp = `500 ${fs * 0.9}px ${INTER}`; ctx.font = fp; wrap(ctx, o.project, maxW, 1).forEach(t => lines.push({ t, f: fp, h: fs * 1.2, c: '#cfd5d2' })); }
      if (o.legend && o.legend.length) lines.push({ legend: true, f: `500 ${fs * 0.78}px ${INTER}`, h: fs * 1.15 });
      const total = lines.reduce((a, l) => a + l.h, 0);
      if (total <= mm) { lines.total = total; break; }
      fs *= 0.92;
    }
    let y = my + (mm - (lines.total || mm)) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = base * 0.003; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    lines.forEach(l => {
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
        if (rest > 0) { ctx.fillStyle = '#cfd5d2'; ctx.fillText(`+${rest}`, x, y); }
      } else { ctx.fillStyle = l.c; ctx.fillText(l.t, tx, y); }
      y += l.h;
    });
    ctx.restore();

    const blob = await toBlob(cv, 0.88);
    return Exif.insert(blob, { lat: o.lat, lng: o.lng, date: o.takenAt });
  }

  async function resizeImage(file, maxSide, q = 0.9) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
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
