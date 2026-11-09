# Decisiones del rediseño «Revelado»

Rama de trabajo: `mejora-ui`, creada desde `main` en el commit `5d2713d` («chore: prepare 0.5.0 release»). Fusionada con `main` el 2026-11-09 tras el visto bueno explícito, y publicada como 0.6.0.

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
- La primera pantalla tiene un solo botón principal («Elegir carpeta», `Alt+O`) y una línea que explica qué hace la app y que nada cambia sin confirmación.
- La vista previa empieza sola al elegir carpeta y se actualiza sola al cambiar el formato.
- El botón «Renombrar N fotos» siempre está a la vista junto a la hoja: abajo en escritorio, como barra fija en pantallas estrechas.
- En pantallas estrechas (≤ 960 px) la hoja va primero y el formato se pliega en un resumen («Fecha + nombre · 2024_08_14»): el estado de la carpeta es lo primero que se ve.
- Cada estado tiene un solo titular (el de la hoja) y una pequeña tira de película propia: vacía, «documentos» rayados, tira cortada, película velada en rojo o fotogramas verdes de restaurado.

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
11. **Atajos con `Alt`** (vuelta 2): `Alt+O` elige carpeta y `Alt+B` busca. En la vuelta 1 eran `O` y `/` sin modificador, lo que incumple WCAG 2.1.4 (atajos de un solo carácter). No se asignan atajos a «Renombrar» ni a «Deshacer», para no provocar cambios en archivos por accidente.
12. **Capturas y herramientas de auditoría** (`docs/capturas/`): no se empaquetan (`package-data` solo incluye `web/`) ni se despliegan (Pages publica `site/`). El selector nativo no se puede automatizar, así que el script responde a `/api/select-folder` con carpetas sintéticas creadas en una carpeta temporal.
13. **Medición de fluidez**: en Chromium headless sin GPU el scroll a 1680 px medía 36 fps, incluso sin ninguna decoración. Una página trivial daba 60, y con Chromium con GPU daba 60. Las mediciones se hacen con aceleración por GPU (`--use-angle=d3d11`).

14. **Miniaturas locales** (vuelta 2). La hoja y la lupa muestran la foto real para que el usuario reconozca qué está renombrando. `thumbnails.py` genera un JPEG de 96 o 360 px en memoria con Pillow (ya era dependencia), abriendo el archivo solo para leer. `/api/thumbnail` exige el token y solo sirve rutas que estén en la última carpeta analizada; cualquier otra ruta da 400. El navegador las recibe como `blob:` (la CSP añade `img-src blob:`), con 4 peticiones simultáneas como máximo y una caché de 500 entradas. Al cambiar de carpeta se abortan las pendientes. Nada sale del equipo.
15. **Deshacer por archivo** (vuelta 2). `undo_each` revierte en orden inverso, sin sobrescribir nunca, y si un archivo está bloqueado lo anota y sigue. La interfaz muestra un estado «Deshacer incompleto» persistente con la lista de pendientes y «Reintentar deshacer», en lugar de un aviso flotante de 4 s. `undo_renames` (todo o nada) se conserva.
16. **Error de red al aplicar → «Resultado desconocido»** (vuelta 2). Si la petición de confirmar falla, la app no puede saber cuántos archivos cambiaron. En la vuelta 1 decía «No se aplicó ningún cambio», una afirmación potencialmente falsa. Ahora pide volver a analizar para ver el estado real.
17. **Aviso «ya fechada»** (vuelta 2). Si un nombre original ya empieza por una fecha (`2024_08_14`, `2024-08-14` o `20240814`), la fila lleva la etiqueta «ya fechada», hay un filtro propio y el diálogo de confirmación lo advierte. No cambia los nombres propuestos: es solo información, porque el motor de 0.5.0 se mantiene intacto (golden).
18. **Nombres sin cortar a ciegas** (vuelta 2). Los nombres largos se acortan por el centro (`helpers.js`, con tests en Node) para que siempre se vean la fecha y la extensión. Los conflictos muestran el nombre con el que chocarían. La lupa y el detalle muestran el nombre completo. Se descartó que las filas crecieran en altura, porque la lista virtual necesita una altura fija para seguir a 60 fps con miles de filas.
19. **Formato bloqueado en los resultados** (vuelta 2). Tras renombrar, el panel de formato queda atenuado y deshabilitado, con la nota «Pulsa Volver a analizar…». Cambiarlo ahí no tendría efecto y confundía.
20. **Tras un éxito, la acción principal es «Elegir otra carpeta»** (vuelta 2). «Deshacer» pasa a secundaria: es una red de seguridad, no el siguiente paso esperado.
21. **Ejemplo fijo `2024_08_14`** (vuelta 2), en lugar de la fecha de hoy. Así el ejemplo del formato y el del héroe coinciden. En cuanto hay vista previa, el ejemplo usa una foto real de la carpeta.
22. **Sin halo que sigue al puntero** (vuelta 2). Era decorativo, costaba repintados y no aportaba a la tarea. La luz de seguridad es ahora estática.
23. **«Último lote» siempre a mano** (vuelta 3). Elegir otra carpeta o volver a analizar ya no hace perder el deshacer: una barra bajo la cabecera muestra el último lote renombrado («8 fotos en *mixta* · Deshacer») en cualquier vista, hasta que se aplica otro lote. El servidor guarda cada movimiento en cuanto ocurre (`apply_plan(on_renamed=…)`), así que incluso un lote interrumpido por un fallo inesperado se puede deshacer. `/api/last-run` permite recuperarlo tras un «resultado desconocido».
24. **Caché de fechas al cambiar el formato** (vuelta 3). Las fechas no dependen del formato. `create_preview` acepta una caché indexada por ruta y huella del archivo (dispositivo, inodo, tamaño, mtime, ctime): si el archivo cambió, se vuelve a leer. Los nombres propuestos son idénticos con y sin caché (test). La hoja se actualiza en su sitio, atenuada, sin perder filtro, búsqueda, desplazamiento ni fila seleccionada. La caché se descarta al cambiar de carpeta y tiene un tope de 200.000 entradas.
25. **Fecha del archivo marcada** (vuelta 3). Cuando la foto no guarda fecha de captura y se usa la del archivo, la miniatura lleva un sello «MOD» o «CREA» con borde discontinuo, hay un filtro «Fecha del archivo», la lupa lo explica y la confirmación lo advierte. El héroe lo anticipa en una frase.
26. **Estado nunca solo por color** (vuelta 3). En pantallas estrechas las etiquetas se abrevian con texto (Cambia, Choque, Omitida…) en lugar de quedarse en un punto de color (WCAG 1.4.1).
27. **Receta «Fecha, sin extensión»** (vuelta 3). Sustituye a «Fecha + título», que no decía qué hacía. Es la misma receta: los nombres no cambian.
28. **Errores de deshacer y aplicar, sin afirmaciones falsas** (vuelta 3). Un rechazo del servidor (4xx) ocurre antes de tocar archivos, y la interfaz lo dice. Un fallo de red o de servidor lleva a «Resultado desconocido», con el lote recuperable. Mientras se deshace, una vista «Deshaciendo» bloquea las acciones que podrían cruzarse.
29. **Un lote que no renombra nada no sustituye al anterior** (vuelta 4). El servidor cambia de «último lote» al renombrar el primer archivo del nuevo, y la confirmación avisa de la sustitución.
30. **Nombre nuevo en dos líneas por debajo de 1280 px** (vuelta 4). Allí no hay lupa, y el nombre nuevo es lo que el usuario revisa. Las filas pasan a 84 px fijos, así que la virtualización no cambia.
31. **Rótulo literal y titular metafórico** (vuelta 4). El rótulo pequeño dice lo que pasa, para quien no conoce el cuarto oscuro; el titular conserva la metáfora. La carpeta se escribe entre comillas angulares.
32. **De negativo a positivo** (vuelta 4). Al terminar de renombrar, las miniaturas de las fotos renombradas se «fijan»: pasan de negativo a positivo en 1,1 s, escalonadas. Con movimiento reducido no hay animación.
33. **Aviso de nombres sin extensión** (tras la revisión de la vuelta 4). La receta «Fecha, sin extensión» se mantiene igual que en 0.5.0, pero la confirmación avisa de cuántas fotos quedarán sin extensión.
34. **Respuesta explícita ante errores imprevistos** (tras la revisión de la vuelta 4). El servidor responde 500 con un mensaje en lugar de cortar la conexión, así la interfaz no confunde un error con una aplicación cerrada.

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
5. **Tests de interfaz en el proyecto.** Los estados de la interfaz se recorren con Playwright en el script de capturas, que no forma parte de `unittest`. ¿Quieres añadir Playwright como dependencia de desarrollo y convertir ese recorrido en tests?
6. **Diseño estrecho.** En móvil, la carpeta y el formato van debajo del botón de confirmar. La revisión final propone un resumen fijo del formato que abra una hoja inferior. ¿Lo hago en una iteración aparte?
7. **Excluir fotos.** ¿Quieres poder apartar una foto o el grupo «Ya fechadas» antes de confirmar? Cambia el contrato de `/api/confirm`, aunque no el motor de nombres.
8. **Versión de Pillow.** `pyproject.toml` pide `Pillow>=13.0`. ¿La fijo a una versión exacta, como pide el encargo para dependencias nuevas?
9. **Dos pestañas a la vez.** El servidor no impide deshacer dos veces en paralelo, ni deshacer mientras se confirma desde otra pestaña. ¿Añado esa exclusión mutua?
