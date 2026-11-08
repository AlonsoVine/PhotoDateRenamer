# Decisiones del rediseño «Revelado»

Rama de trabajo: `mejora-ui`, creada desde `main` en el commit `5d2713d` («chore: prepare 0.5.0 release»). No se ha fusionado con `main`.

## 1. Inspección inicial (antes de tocar nada)

| Aspecto | Hallazgo |
| --- | --- |
| Stack | Python ≥ 3.11 (Pillow, defusedxml) con un servidor HTTP propio enlazado solo a `127.0.0.1`, que sirve una interfaz HTML/CSS/JS sin dependencias. Se empaqueta como `.exe` portable con PyInstaller. Existe además una versión web estática independiente en `site/` (File System Access API) publicada en GitHub Pages. |
| Cómo se ejecuta | `python -m photodaterenamer` (o `rename_photos.py`, o el `.exe`): abre `http://127.0.0.1:<puerto>/` en el navegador predeterminado. |
| Lógica de renombrado | `src/photodaterenamer/renamer.py` (`create_preview`, `execute_plan`, `undo_renames`). El adaptador HTTP está en `server.py`; el selector nativo de carpetas, en `folder_picker.py`. |
| Tests | 28 tests `unittest` en Python (motor, servidor, selector, web estática) y 9 tests `node --test` (metadatos y flujo de la web estática). Todos en verde al empezar. |

### Inventario de funcionalidades (versión 0.5.0)

- **Opciones de renombrado**: tres recetas (*Fecha + nombre* → `2024_05_06_IMG.jpg`, *Fecha + título* → `2024_05_06_IMG`, *Nombre + fecha* → `IMG_2024_05_06.jpg`) y un editor *A medida* que concatena piezas: fecha, nombre original con extensión, nombre sin extensión, extensión y texto fijo (máx. 64 caracteres). Las piezas se pueden mover y quitar.
- **Formatos de fecha**: `YYYY_MM_DD`, `YYYY-MM-DD`, `YYYYMMDD`.
- **Origen de la fecha**, por orden: EXIF `DateTimeOriginal`, `DateTimeDigitized`, `DateTime`, XMP; después, última modificación del archivo y, al final, fecha de creación. La vista previa indica el origen usado.
- **Formatos de imagen**: `.jpg`, `.jpeg`, `.png`, `.tif`, `.tiff`, sin distinguir mayúsculas.
- **Subcarpetas**: opcional (desactivado por defecto). Cada archivo se queda en su carpeta.
- **Vista previa**: sí, obligatoria antes de confirmar. Estados: lista, sin cambio, omitida (sin fecha o ilegible) y conflicto (destino existente, repetido o nombre inválido). Paginada de 100 en 100.
- **Confirmación**: `window.confirm` nativo.
- **Deshacer**: sí, del último lote, mientras la aplicación siga abierta.
- **Seguridad**: nunca sobrescribe (en Windows, `rename` falla si existe el destino; en POSIX, `link` + `unlink`). Se revalida cada archivo con su huella. En 0.5.0 el lote era **todo o nada**: al primer fallo se revertían los cambios ya hechos.
- **Progreso y cancelación** del análisis.

### Línea base visual

`docs/capturas/antes/`: 10 estados a 360×720, 1024×768 y 1680×1050, con el script `docs/capturas/capturar_antes.py`. Defectos ya visibles en la línea base:
- Desbordamiento horizontal a 360 px: la página mide 523 px de ancho.
- Los errores muestran rutas de Windows con barras duplicadas (`C:\\Users\\...`).
- El aviso de deshacer de un lote anterior sigue visible al cambiar de carpeta.
- No se distingue entre carpeta vacía y carpeta sin imágenes.
- La confirmación usa el diálogo del sistema.

## 2. Concepto visual: «Revelado»

**Idea.** La aplicación pone fecha a las fotos, igual que el fechador naranja de siete segmentos de las cámaras compactas de los 90 (`'98 7 14` impreso en la esquina de la copia). El concepto convierte la interfaz en un **cuarto oscuro**: una sala negra cálida, la luz roja de seguridad y el grano de la película. Los nombres de archivo se «revelan» como copias sobre una hoja de contactos.

Por qué funciona para esta herramienta:
- **Nace del dominio, no es un tema decorativo.** La fecha impresa *es* lo que hace la app. El naranja del fechador se reserva para lo que es fecha o acción principal, así que el color también informa.
- **Da nombre y forma a cada estado**: revelando (analizando), hoja de contactos (vista previa), fijando (aplicando), revelado completo (éxito), revelado con velos (error parcial), película velada (error total), carrete vacío (carpeta vacía).
- **El fondo oscuro deja que el contenido (los nombres) sea la luz.** Contraste alto sin necesidad de gris sobre gris.

Recursos y por qué:
- **Tipografía**:
  - Fraunces (serif variable con ejes `SOFT` y `WONK`) para titulares: blanda y con carácter editorial, alude al papel fotográfico.
  - Instrument Sans para la interfaz: neutra y legible.
  - JetBrains Mono para nombres de archivo: alinea caracteres y distingue `l`/`1`/`I`.
  - DSEG7 para fechas y contadores: es literalmente el dígito del fechador.
- **Color**:
  - Tinta `#0e0b09` y papel `#f2e8d9`.
  - Naranja fechador `#ff9a3c` solo para fechas y la acción primaria.
  - Rojo de seguridad `#ff7a63` solo para conflictos y fallos.
  - Verde fijador `#8be0bd` solo para «hecho» y la garantía de privacidad.
- **Textura y luz**:
  - Grano de película animado (`steps`, solo `transform`, barato de componer).
  - Viñeta y luz roja de seguridad que sigue al ratón con suavidad.
  - La ilustración del héroe se revela como una copia en la cubeta, y el fechador se «enciende» con un parpadeo.
- **Composición**: héroe tipográfico enorme con una única acción; después, mesa de trabajo con columna de ajustes y una hoja de contactos con perforaciones de película a los lados, una «lupa» de detalle y una bandeja de acción.
- **Movimiento**: View Transitions entre el héroe y la mesa, las primeras filas se «revelan» escalonadas, el contador de siete segmentos avanza y aparecen las piezas del formato. Todo se desactiva con `prefers-reduced-motion`: la versión estática conserva el color, la tipografía, las perforaciones y la copia ya revelada.

El arte no estorba:
- La primera pantalla tiene un solo botón principal («Elegir carpeta», tecla `O`) y una línea que explica qué hace la app y que nada cambia sin confirmación.
- La vista previa empieza sola al elegir carpeta y se actualiza sola al cambiar el formato.
- El botón «Renombrar N fotos» siempre está a la vista junto a la hoja: abajo en escritorio, como barra fija en pantallas estrechas.

## 3. Decisiones tomadas ante ambigüedades

1. **Alcance: la aplicación local (`src/photodaterenamer/web/`).** Es la app que se distribuye como `.exe` y la única con tests de extremo a extremo sobre archivos reales en carpetas temporales. La versión estática `site/` comparte inventario funcional pero tiene su propio motor en JS (copiar y borrar). Rediseñarla duplicaría trabajo y riesgo sobre un flujo que borra archivos. Queda sin cambios y como pregunta pendiente.
2. **Política de aplicación por archivo (cambio de flujo).** El listón exige que un archivo bloqueado o de solo lectura se informe *sin abortar el resto*, y 0.5.0 revertía todo el lote. Se añade `apply_plan`:
   - Revalida cada archivo justo antes de moverlo (existe, no cambió, el destino está libre).
   - Lo mueve sin sobrescribir; si falla, anota el motivo y continúa.
   - Devuelve renombrados y fallos, y «Deshacer» revierte los renombrados.
   - `execute_plan` (todo o nada) se conserva intacto por compatibilidad.
   - ADR: `docs/adr/0007-per-file-apply-and-darkroom-interface.md`.
3. **Nombres demasiado largos → conflicto en la vista previa (corrección de error).** En 0.5.0 un nombre de más de 255 caracteres aparecía como «lista» y fallaba al aplicar. Ahora se marca como conflicto antes de confirmar: más de 255 unidades UTF-16 en Windows, más de 255 bytes UTF-8 en el resto. Test: `test_long_names_are_renamed_and_overlong_results_are_conflicts`. Los nombres propuestos no cambian (test de regresión golden).
4. **Mensajes de error legibles.** Las imágenes ilegibles dicen «el archivo no es una imagen reconocible» en lugar de volcar la excepción de Pillow con la ruta escapada. Los fallos del sistema operativo usan `strerror`.
5. **Resultados esperados ya no son errores HTTP.** Cancelar un análisis devuelve `200 {"cancelled": true}`, y cancelar uno ya terminado, `200 {"cancelled": false}`. Antes eran 409, y Chrome registraba cada cancelación como error de consola. Se añade `/api/check-folder` para validar la ruta antes de analizar, por el mismo motivo.
6. **Puerto fijo opcional** (`PHOTODATERENAMER_PORT`), siempre en `127.0.0.1`, para poder dejar la app lanzada en una URL estable. En Windows se desactiva `SO_REUSEADDR`, porque permitía enlazar un puerto ya ocupado por otro proceso (se detectó al lanzar en 8765).
7. **Vista previa automática.** Elegir carpeta lanza el análisis, y cambiar receta, piezas, fecha o subcarpetas lo relanza con 320 ms de espera, cancelando el anterior. Leer metadatos no modifica nada. Aplicar sigue exigiendo el diálogo de confirmación.
8. **Selección cancelada**: mensaje neutro en el héroe, o aviso flotante en la mesa; nunca se trata como error.
9. **Ruta escrita a mano**: se mantiene el campo («o pega la ruta») porque el selector nativo no está disponible en todos los entornos.
10. **Lista virtualizada** en lugar de paginación: solo se pintan las filas visibles más un margen (unas 20-25 de 3000), con `role="listbox"`, `aria-activedescendant`, `aria-setsize` y `aria-posinset`. Se recorre con flechas, RePág, AvPág, Inicio y Fin. Intro abre el detalle en pantallas donde la lupa no cabe.
11. **Atajos**: `O` (elegir carpeta) y `/` (buscar). No se asignan atajos a «Renombrar» ni a «Deshacer», para no provocar cambios en archivos por accidente.
12. **Capturas y herramientas de auditoría** (`docs/capturas/`): no se empaquetan (`package-data` solo incluye `web/`) ni se despliegan (Pages publica `site/`). El selector nativo no se puede automatizar, así que el script responde a `/api/select-folder` con carpetas sintéticas creadas en una carpeta temporal.
13. **Medición de fluidez**: en Chromium headless sin GPU el scroll a 1680 px medía 36 fps, incluso sin ninguna decoración. Una página trivial daba 60, y con Chromium con GPU daba 60. Las mediciones se hacen con aceleración por GPU (`--use-angle=d3d11`).

## 4. Dependencias

No hay dependencias nuevas de ejecución, ni Python ni JavaScript: animación con CSS, Web Animations API y View Transitions nativas, y lista virtual propia. Se añaden recursos autoalojados con licencia SIL OFL 1.1 (texto completo en `src/photodaterenamer/web/fonts/OFL-*.txt`), con versiones fijadas y comprobadas como vigentes en npm el 2026-11-08:

| Recurso | Versión | Uso |
| --- | --- | --- |
| Fraunces (`@fontsource-variable/fraunces`) | 5.3.0 | Titulares |
| Instrument Sans (`@fontsource-variable/instrument-sans`) | 5.3.0 | Interfaz |
| JetBrains Mono (`@fontsource-variable/jetbrains-mono`) | 5.3.0 | Nombres de archivo |
| DSEG7 Classic Bold (`dseg`) | 0.46.0 | Fechas y contadores |

Herramientas de desarrollo, que no se empaquetan ni se versionan: Playwright 1.64.1 (ya instalado) y axe-core 4.14.0 para auditar accesibilidad desde el script de capturas.

## 5. Preguntas pendientes

1. **Archivos ocultos.** Hoy se renombran como cualquier otra foto: `.oculta.jpg` y archivos con atributo oculto de Windows (el atributo se conserva). ¿Prefieres excluirlos por defecto?
2. **Deshacer persistente.** Deshacer solo vale mientras la app sigue abierta; no hay diario en disco. ¿Quieres un registro persistente que permita deshacer tras reiniciar?
3. **Política ante fallos.** Ahora un fallo no detiene el lote y el resto se aplica, con «Deshacer» disponible. ¿Prefieres ofrecer también el modo «todo o nada» de 0.5.0 como opción?
4. **Versión web estática (`site/`).** No se ha rediseñado en esta rama. ¿Quieres llevar «Revelado» también a la versión de GitHub Pages?
