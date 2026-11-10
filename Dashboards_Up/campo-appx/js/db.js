/* Almacenamiento local (IndexedDB): capas, puntos con fotos, recorridos y borrador */
const DB = (() => {
  const VERSION = 2;
  let db = null, ready = null;
  const hooks = { blocked: () => { }, closed: () => { } };

  /* Abre (o reutiliza) la conexión. Todas las operaciones esperan a que esté lista. */
  function open() {
    if (ready) return ready;
    ready = new Promise((res, rej) => {
      const r = indexedDB.open('campo-app', VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        const mk = (n, k) => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: k }); };
        mk('layers', 'id'); mk('points', 'id'); mk('meta', 'k');
        mk('tracks', 'id'); // v2: recorridos GPS
      };
      // otra pestaña/ventana con una versión anterior de la app impide actualizar la base
      r.onblocked = () => hooks.blocked();
      r.onsuccess = () => {
        db = r.result;
        // si una versión más nueva de la app (en otra pestaña) necesita actualizar, esta cede la conexión
        db.onversionchange = () => { db.close(); db = null; ready = null; hooks.closed(); };
        db.onclose = () => { db = null; ready = null; };
        res();
      };
      r.onerror = () => { ready = null; rej(r.error); };
    });
    return ready;
  }
  async function tx(store, mode, fn) {
    if (!db) await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  return {
    open, hooks,
    all: s => tx(s, 'readonly', st => st.getAll()),
    get: (s, k) => tx(s, 'readonly', st => st.get(k)),
    put: (s, v) => tx(s, 'readwrite', st => st.put(v)),
    del: (s, k) => tx(s, 'readwrite', st => st.delete(k)),
    clear: s => tx(s, 'readwrite', st => st.clear())
  };
})();
