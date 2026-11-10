/* Brújula del celular: rumbo hacia donde apunta la cámara trasera (grados desde el norte magnético) */
const Compass = (() => {
  let on = false, last = null, lastT = 0;
  const subs = new Set();
  const R = Math.PI / 180;
  const norm = h => ((h % 360) + 360) % 360;

  // Rumbo del eje de la cámara trasera (-Z del equipo) a partir de alpha/beta/gamma absolutos (Android)
  function camHeading(a, b, g) {
    a *= R; b *= R; g *= R;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
    const dx = -(ca * sg + sa * sb * cg), dy = ca * sb * cg - sa * sg;
    if (Math.hypot(dx, dy) > 0.35) return norm(Math.atan2(dx, dy) / R);
    return norm(Math.atan2(-sa * cb, ca * cb) / R); // celular casi plano: usa la punta del equipo
  }

  function onEvt(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) h = e.webkitCompassHeading; // iPhone
    else if ((e.absolute || e.type === 'deviceorientationabsolute') && e.alpha != null) h = camHeading(e.alpha, e.beta || 0, e.gamma || 0);
    if (h == null || isNaN(h)) return;
    last = norm(h); lastT = Date.now();
    subs.forEach(f => f(last));
  }

  /* Debe llamarse desde un toque del usuario (iPhone pide permiso) */
  async function start() {
    if (on) return true;
    if (typeof DeviceOrientationEvent === 'undefined') return false;
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return false; }
      catch (e) { return false; }
    }
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onEvt);
    else window.addEventListener('deviceorientation', onEvt);
    on = true;
    return true;
  }

  function circMean(vals) {
    let x = 0, y = 0;
    vals.forEach(v => { x += Math.cos(v * R); y += Math.sin(v * R); });
    return norm(Math.atan2(y, x) / R);
  }

  /* Promedia las lecturas de los próximos ms; null si la brújula no responde */
  function sample(ms = 900) {
    return new Promise(res => {
      const vals = [];
      if (last != null && Date.now() - lastT < 1200) vals.push(last);
      const f = h => vals.push(h);
      subs.add(f);
      setTimeout(() => { subs.delete(f); res(vals.length ? Math.round(circMean(vals)) : null); }, ms);
    });
  }

  const PTS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const cardinal = h => PTS[Math.round(norm(h) / 45) % 8];
  const label = h => `${Math.round(norm(h))}° ${cardinal(h)}`;

  return {
    start, sample, cardinal, label,
    current: () => (last != null && Date.now() - lastT < 3000 ? Math.round(last) : null),
    subscribe: f => { subs.add(f); return () => subs.delete(f); }
  };
})();
