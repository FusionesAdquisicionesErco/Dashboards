# Campo – Visitas (PWA)

App web instalable para visitas a campo: carga KMZ/KML/GeoJSON, agrega puntos con hasta 10 fotos y exporta un ZIP
con las fotos ya marcadas (minimapa con capas + fecha + coordenadas + nombre del punto).
No usa servidor: todo se guarda en el celular hasta que descargas el ZIP.

## 1. Publicar en GitHub Pages (una sola vez)
1. Crea una cuenta en https://github.com (si no tienes).
2. **New repository** → nombre `campo-app` → *Public* → Create repository.
   (GitHub Pages gratis requiere repositorio público. El repositorio solo contiene el código de la app, nunca tus datos ni fotos.)
3. En el repositorio: **Add file → Upload files**. Descomprime este ZIP y arrastra TODO su contenido
   (index.html, app.css, sw.js, manifest.json, .nojekyll y las carpetas js/, lib/, icons/, ejemplo/). **Commit changes**.
4. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `/ (root)` → Save**.
5. En 1–2 minutos aparece el enlace: `https://TU_USUARIO.github.io/campo-app/`

## 2. Instalar en el celular
- **Android (Chrome):** abre el enlace → menú ⋮ → *Instalar app* / *Agregar a pantalla de inicio*.
- **iPhone (Safari):** abre el enlace → botón Compartir → *Agregar a pantalla de inicio*.
Abre la app una vez con internet para que quede guardada; después abre sin conexión (los mapas ya vistos quedan en caché).
Acepta los permisos de **ubicación** y **cámara**.

## 3. Uso en campo
1. **Capas → Cargar KMZ/KML/GeoJSON** (hay un archivo de prueba en `ejemplo/`). Activa/desactiva capas y cambia su color.
2. **Ajustes**: escribe el nombre del proyecto/visita (opcional) y elige el zoom del minimapa.
3. **＋ Punto** → nombre, descripción, ubicación (Mi GPS / Centro del mapa / Elegir en mapa) y fotos (📷 cámara o 🖼️ galería, hasta 10).
4. **Guardar punto** → se aplica la marca de agua con las capas que estén visibles en ese momento.
5. **Exportar → Generar paquete ZIP → Descargar / Compartir**.

El ZIP contiene: `fotos/` (JPG marcados con GPS en EXIF), `puntos.kml`, `puntos.geojson`, `puntos.csv`
(y opcionalmente `puntos.kmz` y `fotos_originales/`). Descomprímelo manteniendo las carpetas para ver las fotos en Google Earth.

## 4. Notas importantes
- Los datos viven en el navegador del celular: **descarga el ZIP antes de borrar datos del navegador o desinstalar la app**.
- Sin señal: el minimapa usa las teselas ya vistas en el mapa; si no hay, muestra solo tus capas sobre fondo oscuro.
- Mapas: Esri World Imagery (satélite) y OpenStreetMap (calles). Revisa sus condiciones de uso para uso corporativo intensivo.
- Si actualizas archivos en GitHub: la app toma la versión nueva al abrirla por segunda vez. Si agregas/quitas archivos, sube el número `VERSION` en `sw.js`.
- El CSV usa `;` como separador y UTF-8 con BOM (abre bien en Excel en español).
