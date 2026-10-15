/* Minimapa con capas + marca de agua sobre la foto */
const BASEMAPS = {
  sat: { name: 'Satélite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxNative: 18, attr: 'Esri, Maxar, Earthstar Geographics' },
  osm: { name: 'Calles', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxNative: 19, attr: '© OpenStreetMap' }
};

const Watermark = (() => {
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const pad2 = n => String(n).padStart(2, '0');
  const fmtDate = t => { const d = new Date(t); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

  const mercX = (lng, z) => (lng + 180) / 360 * 256 * Math.pow(2, z);
  const mercY = (lat, z) => {
    lat = Math.max(-85.0511, Math.min(85.0511, lat));
    const s = Math.sin(lat * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * Math.pow(2, z);
  };

  function loadImage(url, ms = 6000) {
    return new Promise(res => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const t = setTimeout(() => { img.src = ''; res(null); }, ms);
      img.onload = () => { clearTimeout(t); res(img); };
      img.onerror = () => { clearTimeout(t); res(null); };
      img.src = url;
    });
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
    const S = o.size, cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    const bm = BASEMAPS[o.base] || BASEMAPS.sat;
    const z = Math.max(3, Math.min(20, Math.round(o.zoom)));
    const zt = Math.min(z, bm.maxNative), sc = Math.pow(2, z - zt);

    ctx.fillStyle = '#2d3338'; ctx.fillRect(0, 0, S, S);

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
      ctx.fillStyle = '#ffb300'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    });
    ctx.restore();

    // 3) Punto actual
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.034, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.024, 0, Math.PI * 2); ctx.fillStyle = '#e53935'; ctx.fill();
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.007, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();

    // 4) Norte, escala y atribución
    const fs = S * 0.04;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 4;
    ctx.fillStyle = '#fff'; ctx.font = `700 ${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('N', S - S * 0.07, S * 0.075);
    ctx.beginPath(); ctx.moveTo(S - S * 0.07, S * 0.02); ctx.lineTo(S - S * 0.07 - S * 0.022, S * 0.07); ctx.lineTo(S - S * 0.07 + S * 0.022, S * 0.07); ctx.closePath(); ctx.fill();
    // barra de escala
    const mpp = 40075016.686 * Math.cos(o.lat * Math.PI / 180) / (256 * Math.pow(2, z));
    const target = mpp * S * 0.28, steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    let m = steps[0]; steps.forEach(s => { if (s <= target) m = s; });
    const barW = m / mpp, bx = S * 0.04, by = S - S * 0.075;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(3, S * 0.008);
    ctx.beginPath(); ctx.moveTo(bx, by - S * 0.015); ctx.lineTo(bx, by); ctx.lineTo(bx + barW, by); ctx.lineTo(bx + barW, by - S * 0.015); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.font = `600 ${S * 0.036}px ${FONT}`;
    ctx.fillText(m >= 1000 ? `${m / 1000} km` : `${m} m`, bx, by - S * 0.02);
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.font = `${S * 0.026}px ${FONT}`;
    ctx.fillText(bm.attr, S - S * 0.02, S - S * 0.012);
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
    const bmp = await createImageBitmap(photoBlob);
    const W = bmp.width, H = bmp.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0); if (bmp.close) bmp.close();

    const base = Math.min(W, H), pad = Math.round(base * 0.025);
    const mm = Math.round(base * 0.34), bandH = mm + pad * 2, top = H - bandH;
    ctx.fillStyle = 'rgba(0,0,0,0.58)'; ctx.fillRect(0, top, W, bandH);
    ctx.drawImage(o.minimap, pad, top + pad, mm, mm);
    ctx.lineWidth = Math.max(2, base * 0.003); ctx.strokeStyle = '#fff'; ctx.strokeRect(pad, top + pad, mm, mm);

    const tx = pad * 2 + mm, maxW = W - tx - pad;
    let fs = base * 0.036, lines;
    for (let i = 0; i < 10; i++) {
      lines = [];
      ctx.font = `700 ${fs * 1.3}px ${FONT}`;
      wrap(ctx, o.name || '—', maxW, 3).forEach(t => lines.push({ t, f: `700 ${fs * 1.3}px ${FONT}`, h: fs * 1.3 * 1.2 }));
      const f1 = `500 ${fs}px ${FONT}`;
      lines.push({ t: fmtDate(o.takenAt), f: f1, h: fs * 1.25 });
      lines.push({ t: `Lat: ${o.lat.toFixed(6)}°`, f: f1, h: fs * 1.25 });
      lines.push({ t: `Lon: ${o.lng.toFixed(6)}°`, f: f1, h: fs * 1.25 });
      if (o.project) { ctx.font = `500 ${fs * 0.9}px ${FONT}`; wrap(ctx, o.project, maxW, 1).forEach(t => lines.push({ t, f: `500 ${fs * 0.9}px ${FONT}`, h: fs * 1.2, c: '#cfd8dc' })); }
      if (o.legend && o.legend.length) lines.push({ legend: true, f: `500 ${fs * 0.78}px ${FONT}`, h: fs * 1.15 });
      const total = lines.reduce((a, l) => a + l.h, 0);
      if (total <= mm) { lines.total = total; break; }
      fs *= 0.92;
    }
    let y = top + pad + (mm - (lines.total || mm)) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = base * 0.004; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
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
        if (rest > 0) { ctx.fillStyle = '#cfd8dc'; ctx.fillText(`+${rest}`, x, y); }
      } else { ctx.fillStyle = l.c || '#fff'; ctx.fillText(l.t, tx, y); }
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
