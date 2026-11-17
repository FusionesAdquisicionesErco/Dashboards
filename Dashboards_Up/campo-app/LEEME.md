# JMaps M&A · ERCO (PWA)

Creado por jcastillo@erco.energy · Versión 1.3

App web instalable del área de M&A para visitas de campo: carga KMZ/KML/GeoJSON, agrega puntos con hasta 10 fotos
y exporta un ZIP con las fotos ya marcadas (minimapa con capas + fecha + coordenadas + nombre del punto).
No usa servidor: todo se guarda en el celular hasta que descargas el ZIP.

## Actualizar en GitHub (ya publicada)
1. Descomprime este ZIP.
2. En tu repositorio entra a la carpeta `Dashboards_Up/campo-app` → **Add file → Upload files**.
3. Arrastra TODO el contenido de la carpeta `campo-app` (index.html, app.css, sw.js, manifest.json y las carpetas js/, lib/, fonts/, img/, icons/, ejemplo/). Acepta reemplazar los existentes. **Commit changes**.
4. Espera 1–2 minutos. Abre el enlace dos veces (la primera carga la versión guardada). En Ajustes debe decir «Versión 1.3».
5. **Para ver el nuevo nombre e ícono en el celular:** desinstala el ícono anterior de la pantalla de inicio y vuelve a agregarlo (iPhone: Compartir → Agregar a pantalla de inicio; Android: menú ⋮ → Instalar app).

## Identidad de marca aplicada (Brand Identity Guidelines, ago-2024)
- Color: Primary #9ECC14, Yellow #E3DD16, Green #45A824, Gray #F5F5F6, Black #121212. Los complementarios (azul, naranja, rojo) solo se usan en estados y capas.
- Tipografía: Sora (títulos, botones, etiquetas) e Inter (textos), incluidas en la carpeta `fonts/` (licencia OFL), por lo que también funcionan sin conexión.
- Logo: logo completo en la tarjeta de Ajustes e isologo en la barra superior, el ícono de la app y la marca de agua de cada foto.
- Formas: tarjetas con radio de 32 px, botones y etiquetas en píldora, íconos de un solo estilo (trazo regular).

## Uso en campo
1. **Capas → Cargar KMZ/KML/GeoJSON** (hay un archivo de prueba en `ejemplo/`).
2. **Ajustes**: nombre del proyecto/visita (opcional) y zoom del minimapa.
3. **＋ Punto** → nombre, descripción, ubicación (Mi GPS / Centro / En mapa) y fotos (cámara o galería, hasta 10).
4. **Guardar punto** → se aplica la marca de agua con las capas visibles en ese momento.
5. **Exportar → Generar paquete ZIP → Descargar / Compartir**.

El ZIP contiene: `fotos/` (JPG marcados con GPS en EXIF), `puntos.kml`, `puntos.geojson`, `puntos.csv`
(y opcionalmente `puntos.kmz` y `fotos_originales/`).

## Notas
- Los datos viven en el navegador del celular: **descarga el ZIP antes de borrar datos del navegador o desinstalar la app.**
- Sin señal: el minimapa usa las teselas ya vistas; si no hay, muestra solo tus capas.
- Ubicación en iPhone: si no aparece el aviso, toca «Activar» en el aviso negro; la app muestra la guía paso a paso.
- Si agregas o quitas archivos del paquete, sube el número `VERSION` en `sw.js`.
- Los íconos son propios (trazo regular). Si ERCO usa Font Awesome Pro (Regular), se pueden reemplazar por esos.
- El CSV usa `;` como separador y UTF-8 con BOM (abre bien en Excel en español).
