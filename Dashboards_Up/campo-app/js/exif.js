/* Escribe EXIF mínimo (fecha + GPS + rumbo) en un JPEG y lee el rumbo (GPSImgDirection) de la foto original */
const Exif = (() => {
  const enc = new TextEncoder();
  const ascii = s => { const b = new Uint8Array(s.length + 1); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 127; return b; };
  const u32 = v => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v); return b; };
  const rat = arr => { const b = new Uint8Array(arr.length * 8), dv = new DataView(b.buffer); arr.forEach(([n, d], i) => { dv.setUint32(i * 8, n); dv.setUint32(i * 8 + 4, d); }); return b; };
  const ent = (tag, type, count, bytes) => ({ tag, type, count, bytes });
  const ifdSize = es => { let s = 2 + 12 * es.length + 4; es.forEach(e => { if (e.bytes.length > 4) s += e.bytes.length + (e.bytes.length % 2); }); return s; };

  function writeIfd(es, off) {
    es = [...es].sort((a, b) => a.tag - b.tag);
    const out = new Uint8Array(ifdSize(es)), dv = new DataView(out.buffer);
    dv.setUint16(0, es.length);
    let dp = 2 + 12 * es.length + 4;
    es.forEach((e, i) => {
      const p = 2 + 12 * i;
      dv.setUint16(p, e.tag); dv.setUint16(p + 2, e.type); dv.setUint32(p + 4, e.count);
      if (e.bytes.length <= 4) out.set(e.bytes, p + 8);
      else { dv.setUint32(p + 8, off + dp); out.set(e.bytes, dp); dp += e.bytes.length + (e.bytes.length % 2); }
    });
    return out;
  }
  const dms = deg => {
    deg = Math.abs(deg);
    const d = Math.floor(deg), mf = (deg - d) * 60, m = Math.floor(mf), s = (mf - m) * 60;
    return [[d, 1], [m, 1], [Math.round(s * 10000), 10000]];
  };
  const pad = n => String(n).padStart(2, '0');
  const stamp = t => { const d = new Date(t); return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

  function buildApp1({ lat, lng, date, heading }) {
    const dt = ascii(stamp(date));
    const ifd0 = [ent(0x0132, 2, dt.length, dt), ent(0x8769, 4, 1, u32(0)), ent(0x8825, 4, 1, u32(0))];
    const exifIfd = [ent(0x9003, 2, dt.length, dt)];
    const gps = [
      ent(0x0000, 1, 4, new Uint8Array([2, 2, 0, 0])),
      ent(0x0001, 2, 2, ascii(lat >= 0 ? 'N' : 'S')), ent(0x0002, 5, 3, rat(dms(lat))),
      ent(0x0003, 2, 2, ascii(lng >= 0 ? 'E' : 'W')), ent(0x0004, 5, 3, rat(dms(lng)))
    ];
    if (heading != null && isFinite(heading)) // rumbo de la cámara (referencia magnética)
      gps.push(ent(0x0010, 2, 2, ascii('M')), ent(0x0011, 5, 1, rat([[Math.round(heading * 100), 100]])));
    const off0 = 8, offE = off0 + ifdSize(ifd0), offG = offE + ifdSize(exifIfd);
    ifd0[1].bytes = u32(offE); ifd0[2].bytes = u32(offG);
    const parts = [writeIfd(ifd0, off0), writeIfd(exifIfd, offE), writeIfd(gps, offG)];
    const tiffLen = 8 + parts.reduce((a, p) => a + p.length, 0);
    const seg = new Uint8Array(2 + 2 + 6 + tiffLen), dv = new DataView(seg.buffer);
    seg[0] = 0xFF; seg[1] = 0xE1; dv.setUint16(2, 2 + 6 + tiffLen);
    seg.set(enc.encode('Exif'), 4); // + 2 bytes cero
    let p = 10;
    seg[p++] = 0x4D; seg[p++] = 0x4D; dv.setUint16(p, 42); p += 2; dv.setUint32(p, 8); p += 4;
    parts.forEach(b => { seg.set(b, p); p += b.length; });
    return seg;
  }

  async function insert(blob, info) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return blob;
    const app1 = buildApp1(info);
    const out = new Uint8Array(2 + app1.length + buf.length - 2);
    out.set(buf.subarray(0, 2), 0); out.set(app1, 2); out.set(buf.subarray(2), 2 + app1.length);
    return new Blob([out], { type: 'image/jpeg' });
  }
  /* Lee GPSImgDirection de un JPEG (lo escriben el iPhone y algunas cámaras Android) */
  function parseTiff(dv, t) {
    const le = dv.getUint16(t) === 0x4949;
    const u16 = o => dv.getUint16(t + o, le), u32 = o => dv.getUint32(t + o, le);
    const find = (ifd, tag) => { const n = u16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === tag) return e; } return -1; };
    const g = find(u32(4), 0x8825); if (g < 0) return null;
    const gps = u32(g + 8), d = find(gps, 0x0011); if (d < 0) return null;
    const off = u32(d + 8), num = u32(off), den = u32(off + 4);
    if (!den) return null;
    const r = find(gps, 0x0010);
    return { heading: (((num / den) % 360) + 360) % 360, ref: r >= 0 ? String.fromCharCode(dv.getUint8(t + r + 8)) : 'T' };
  }
  async function readHeading(file) {
    try {
      const dv = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
      if (dv.getUint16(0) !== 0xFFD8) return null;
      let p = 2;
      while (p + 10 < dv.byteLength) {
        const m = dv.getUint16(p);
        if ((m & 0xFF00) !== 0xFF00 || m === 0xFFDA) return null;
        if (m === 0xFFE1 && dv.getUint32(p + 4) === 0x45786966) return parseTiff(dv, p + 10);
        p += 2 + dv.getUint16(p + 2);
      }
    } catch (e) { /* EXIF ilegible */ }
    return null;
  }
  return { insert, readHeading };
})();
