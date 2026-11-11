# JMaps M&A · ERCO (PWA)

Creado por jcastillo@erco.energy · Versión 1.8

App web instalable del área de M&A para visitas de campo: carga KMZ/KML/GeoJSON, agrega puntos con hasta 10 fotos
y exporta un ZIP con las fotos ya marcadas (minimapa con capas + fecha + coordenadas + nombre del punto).
No usa servidor: todo se guarda en el celular hasta que descargas el ZIP.

## Actualizar en GitHub (ya publicada)
1. Descomprime este ZIP.
2. En tu repositorio entra a la carpeta `Dashboards_Up/campo-app` → **Add file → Upload files**.
3. Arrastra TODO el contenido de la carpeta `campo-app` (index.html, app.css, sw.js, manifest.json y las carpetas js/, lib/, fonts/, img/, icons/, ejemplo/). En la v1.5 hay dos archivos nuevos: `js/compass.js` y `js/offline.js`. Acepta reemplazar los existentes. **Commit changes**.
4. Espera 1–2 minutos. Abre el enlace dos veces (la primera carga la versión guardada). En Ajustes debe decir «Versión 1.8».
5. **Para ver el nuevo nombre e ícono en el celular:** desinstala el ícono anterior de la pantalla de inicio y vuelve a agregarlo (iPhone: Compartir → Agregar a pantalla de inicio; Android: menú ⋮ → Instalar app).

## Identidad de marca aplicada (Brand Identity Guidelines, ago-2024)
- Color: Primary #9ECC14, Yellow #E3DD16, Green #45A824, Gray #F5F5F6, Black #121212. Los complementarios (azul, naranja, rojo) solo se usan en estados y capas.
- Tipografía: Sora (títulos, botones, etiquetas) e Inter (textos), incluidas en la carpeta `fonts/` (licencia OFL), por lo que también funcionan sin conexión.
- Logo: logo completo en la tarjeta de Ajustes e isologo en la barra superior, el ícono de la app y la marca de agua de cada foto.
- Formas: tarjetas con radio de 32 px, botones y etiquetas en píldora, íconos de un solo estilo (trazo regular).

## Novedades v1.8
- **Notas de la visita**: nueva pestaña «Notas» para lo que no va en un punto (asistentes, acuerdos, clima, pendientes). Cada nota guarda hora, autor y, si quieres, tu ubicación (aparece como un ícono amarillo en el mapa). Se pueden editar y eliminar; lo que se está escribiendo se guarda solo.
- Se exportan en el ZIP como `notas.txt` (legible, útil para Copilot) y `notas.csv`, y en el KML/GeoJSON las que tienen ubicación. Cuentan como pendientes de exportar y se consolidan al importar el ZIP de un compañero.

## Novedades v1.7
- **Hacia dónde miras**: en el celular, el punto azul del GPS muestra un cono que gira con la brújula (como en Google Maps). En PC no aparece. En iPhone se activa tras el primer toque en la pantalla, cuando aceptas el permiso de movimiento y orientación.
- Si el cono apunta mal, calibra la brújula moviendo el celular en forma de 8 y aléjate de carros, rejas o estructuras metálicas.

## Novedades v1.6
- **Actualización segura**: si queda abierta otra pestaña o la app instalada con una versión anterior, la app lo avisa en lugar de fallar al guardar. Las nuevas versiones se instalan solas y la app se recarga cuando no hay nada a medio hacer (ya no hace falta abrirla dos veces).
- **Consolidar en equipo**: Exportar → «Importar ZIP de un compañero». Suma puntos, fotos y recorridos con el nombre del autor; los puntos importados se pueden editar. Reimportar el mismo ZIP no duplica (actualiza si viene una versión más nueva). Acepta también ZIP exportados con la v1.5.
- **Autor**: en Ajustes → «Tu nombre». Al exportar, la casilla «Incluir columna de autor en el CSV» es opcional (se marca sola si hay puntos de varias personas).
- Para poder rehacer la marca de agua al editar puntos de otra persona, esa persona debe exportar con «Incluir fotos originales». Si no, sus fotos conservan la marca con la que llegaron.

## Novedades v1.5
- **Rumbo de la foto**: se toma del EXIF de la foto si lo trae; si no, de la brújula del celular justo al volver de la cámara. Se puede corregir tocando la foto → «Fijar con brújula». Aparece en la marca de agua (cono en el minimapa + «Rumbo: 245° SO»), en el EXIF de la foto marcada y en el CSV/KML. Es rumbo magnético, con un margen típico de ±10–15°.
- **Observaciones estructuradas**: categoría (editable en Ajustes) y nivel Alto/Medio/Bajo. El pin del mapa toma el color del nivel; la lista de puntos se puede filtrar; la etiqueta sale en la marca de agua y en CSV, KML y GeoJSON.
- **Protección de datos**: cada punto sabe si ya se exportó (se marca al Descargar o Compartir el ZIP). Contador naranja en «Exportar», aviso si hay puntos sin exportar hace más de 24 h, opción «Exportar solo los nuevos», estado del almacenamiento y advertencia reforzada al borrar.
- **Recorrido GPS**: botón de ruta en el mapa. Graba el trayecto mientras la app está abierta (mantiene la pantalla encendida). Se exporta en `recorridos.gpx`, en el KML y en el GeoJSON, y se dibuja en el minimapa.
- **Mapa sin conexión**: en Capas → «Mapa sin conexión» se descarga el satélite de la zona (capas visibles o vista actual) antes de la visita.

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
- Sin señal: el mapa y el minimapa usan las zonas descargadas y las teselas ya vistas; si no hay, muestran solo tus capas.
- Recorrido: si se bloquea la pantalla o cambias de app, el navegador pausa el GPS; al volver se crea un tramo nuevo (no se inventa una línea recta).
- Ubicación en iPhone: si no aparece el aviso, toca «Activar» en el aviso negro; la app muestra la guía paso a paso.
- Si agregas o quitas archivos del paquete, sube el número `VERSION` en `sw.js`.
- Los íconos son propios (trazo regular). Si ERCO usa Font Awesome Pro (Regular), se pueden reemplazar por esos.
- El CSV usa `;` como separador y UTF-8 con BOM (abre bien en Excel en español).
