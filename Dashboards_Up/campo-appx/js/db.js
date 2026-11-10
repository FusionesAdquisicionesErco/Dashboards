/* Almacenamiento local (IndexedDB): capas, puntos con fotos, recorridos y borrador */
const DB = (() => {
  let db;
  function open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('campo-app', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        const mk = (n, k) => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: k }); };
        mk('layers', 'id'); mk('points', 'id'); mk('meta', 'k');
        mk('tracks', 'id'); // v2: recorridos GPS
      };
      r.onsuccess = () => { db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  }
  function tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  return {
    open,
    all: s => tx(s, 'readonly', st => st.getAll()),
    get: (s, k) => tx(s, 'readonly', st => st.get(k)),
    put: (s, v) => tx(s, 'readwrite', st => st.put(v)),
    del: (s, k) => tx(s, 'readwrite', st => st.delete(k)),
    clear: s => tx(s, 'readwrite', st => st.clear())
  };
})();
