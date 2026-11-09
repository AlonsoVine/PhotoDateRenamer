# Revisiones del rediseño «Revelado»

Cada vuelta termina con una revisión adversarial independiente: un agente con contexto limpio que solo recibe las capturas nuevas y las de partida, el código, la salida de las comprobaciones, el inventario de funcionalidades y las secciones LISTÓN y RESTRICCIONES del encargo. No lee este archivo, `DECISIONES.md`, el changelog ni el historial.

Ponderada = 0,4·Diseño + 0,3·Usabilidad + 0,2·Creatividad + 0,1·Contenido. Listón: ponderada ≥ 8,5, Diseño ≥ 8,5, Creatividad ≥ 8,0 y ningún criterio por debajo de 8,0.

| Vuelta | Diseño | Usabilidad | Creatividad | Contenido | Ponderada |
| --- | --- | --- | --- | --- | --- |
| 1 | 7,5 | 6,5 | 7,5 | 7,5 | 7,2 |
| 2 | 8,3 | 7,6 | 8,5 | 7,9 | 8,09 |
| 3 | 8,3 | 7,8 | 8,4 | 7,8 | 8,12 |
| 4 | 8,3 | 7,6 | 8,5 | 8,0 | 8,10 |

---

## Vuelta 1

**Capturas:** `docs/capturas/vuelta-1/` · **Comprobaciones:** `docs/capturas/vuelta-1/checks.txt`

### Cambios de la vuelta

- Rediseño completo «Revelado» (cuarto oscuro), con:
  - héroe con una sola acción;
  - mesa de trabajo con hoja de contactos virtualizada, filtros, búsqueda y lupa;
  - diálogo de confirmación propio;
  - vistas para todos los estados.
- Aplicación por archivo (`apply_plan`) con progreso e informe de fallos parciales y totales.
- Fuentes OFL autoalojadas; CSP sin terceros.
- Comprobaciones:
  - 47 tests de Python y 9 de Node verdes;
  - 0 errores de consola, 0 desbordamientos y 0 violaciones de axe en 34 estados;
  - 60 fps.
- Lighthouse (rendimiento / accesibilidad / buenas prácticas):
  - Escritorio: 95/100/100, frente a 83/92/100 en 0.5.0.
  - Móvil: 100/100/100.

### Defectos señalados por el revisor

| Prioridad | Defecto | Resolución (vuelta 2) |
| --- | --- | --- |
| Bloqueante | En móvil el estado de la carpeta queda debajo del panel de formato, fuera de la vista. | Corregido: en ≤ 960 px la hoja va primero, el formato se pliega en un resumen y el titular se enfoca y se desplaza a la vista. Se añadió una comprobación automática: el titular debe estar visible en cada estado. |
| Bloqueante | La lupa decía «Será…» en archivos que habían fallado. | Corregido: ahora pone «Destino previsto», tachado, con «(no aplicado)» para lectores de pantalla. |
| Bloqueante | Un error de red al confirmar afirmaba «No se aplicó ningún cambio». | Corregido: nuevo estado «Resultado desconocido» que pide volver a analizar. Se captura simulando el corte. |
| Mayor | Deshacer era todo o nada, y su error solo se veía en un aviso flotante de 4 s. | Corregido: `undo_each` por archivo, más el estado persistente «Deshacer incompleto» con lista y «Reintentar deshacer». |
| Mayor | El nombre nuevo se cortaba y la etiqueta de estado era demasiado ancha. | Corregido: elipsis central (fecha y extensión siempre visibles); en estrecho, la etiqueta se reduce a un punto con texto accesible. |
| Mayor | Los conflictos no mostraban con qué nombre chocaban. | Corregido: la fila muestra «⨯ destino · ese nombre ya existe o se repite», y la lupa, «Chocaría con». |
| Mayor | Los atajos de una tecla `O` y `/` incumplían WCAG 2.1.4. | Corregido: ahora son `Alt+O` y `Alt+B`. |
| Mayor | Pasar el puntero cambiaba la selección. | Corregido: el puntero solo previsualiza en la lupa; la selección cambia con clic o teclado. |
| Mayor | Tras un éxito, la acción principal era «Deshacer»; no había aviso de fotos ya fechadas. | Corregido: la principal es «Elegir otra carpeta»; hay etiqueta, filtro y aviso «ya fechada». |
| Menor | El panel de formato seguía activo en los resultados. | Corregido: bloqueado y atenuado, con una nota. |
| Menor | Los siete segmentos eran ambiguos y no agrupaban los miles. | Corregido: segmentos apagados («8») de fondo y agrupación con punto (3.000). |
| Menor | El contador parcial se mostraba en rojo y los titulares estaban duplicados. | Corregido: un solo titular por estado. El rojo se mantiene en parcial y total porque señala fallos; el éxito pasa a verde fijador. |
| Menor | La insignia de privacidad desaparecía por debajo de 380 px. | Corregido: versión corta «Solo en tu equipo». |
| Menor | La etiqueta «Fecha» era ambigua y «Fecha de» aparecía cortada. | Corregido: ahora pone «Formato de fecha» (botones de opción) y «Origen de la fecha». |
| Menor | El favicon y el PNG del héroe pesaban demasiado. | Corregido: héroe en WebP de 30 KB y favicon de 15 KB. |
| Menor | Las comprobaciones tenían poca cobertura. | Corregido: nuevas comprobaciones de titular visible, fps de la animación de revelado, filtro «Ya fechadas», detalle, deshacer incompleto y resultado desconocido. |

### Ideas propuestas por el revisor

| Idea | Decisión | Motivo |
| --- | --- | --- |
| Miniaturas locales de cada foto | Adoptada | Es lo que más ayuda a reconocer qué se renombra. Se generan en memoria, solo a través de la interfaz local y con token (ADR 0008). |
| Reordenar en móvil y desplazar al titular | Adoptada | Resuelve el bloqueante de móvil. |
| Filas que nunca cortan el nombre nuevo | Adoptada en parte | Elipsis central y nombre completo en la lupa y el detalle. Se descartan las filas de altura variable porque romperían la lista virtual de altura fija a 60 fps. |
| Escena propia por estado y estado de deshacer fallido | Adoptada | Distingue los estados de un vistazo y elimina el aviso flotante efímero. |
| Aviso «ya fechada» | Adoptada | Evita fechas duplicadas sin cambiar el motor de nombres (golden intacto). |
| Atajos conformes a WCAG y puntero separado de la selección | Adoptada | Es accesibilidad obligatoria. |
| Halo que sigue al puntero | Retirado | Era gratuito, según el revisor, y costaba repintados. |

---

## Vuelta 2

**Capturas:** `docs/capturas/vuelta-2/` · **Comprobaciones:** `docs/capturas/vuelta-2/checks.txt`

### Cambios de la vuelta

- Todas las correcciones de la tabla anterior, más:
  - `thumbnails.py` y `/api/thumbnail`;
  - `undo_each`;
  - `helpers.js`, con tests en Node;
  - el panel de formato reconstruido con botones de receta, piezas y fecha (sin `select`);
  - el diálogo de confirmación con tira de película, contador, ejemplo real y aviso de fechadas;
  - imágenes sintéticas de captura con aspecto fotográfico.
- Durante la vuelta se corrigieron:
  - Peticiones de miniaturas de la carpeta anterior que llegaban tras cambiar de carpeta (400 en consola): ahora se abortan.
  - Miniaturas que no cargaban cuando la lista se redibujaba: la deduplicación conservaba la condición de la fila antigua.
- Comprobaciones:
  - 50 tests de Python (1 omitido, solo POSIX) y 11 de Node verdes;
  - 88 capturas, con 0 errores de consola, 0 desbordamientos y 0 violaciones de axe en 41 estados auditados;
  - 59-60 fps al desplazar 3.000 filas y 60 fps durante el revelado.
- Lighthouse: 99/100/100 en móvil y en escritorio.

### Defectos señalados por el revisor

| Prioridad | Defecto | Resolución (vuelta 3) |
| --- | --- | --- |
| Bloqueante | Se perdía la posibilidad de deshacer al salir del resultado («Elegir otra carpeta», «Volver a analizar», logo), aunque el diálogo prometía poder deshacer. | Corregido: barra «Último lote» visible en cualquier vista hasta aplicar otro lote, más `/api/last-run`. Elegir carpeta ya no olvida el lote. Test de servidor y captura `13b-ultimo-lote`. |
| Bloqueante | Con el cursor encima, el preset activo se quedaba sin texto (especificidad CSS). | Corregido: regla explícita `.preset[aria-pressed="true"]:hover`. |
| Mayor | Deshacer no tenía estado ni bloqueo, y un fallo de red afirmaba «No se pudo deshacer». | Corregido: vista «Deshaciendo» que bloquea carpeta, formato y logo. Un 4xx dice que no se tocó nada; un fallo de red lleva a «Resultado desconocido» y recupera el lote pendiente. |
| Mayor | El conflicto no se podía leer: destino truncado y motivo oculto. | Corregido: el destino ocupa toda la línea, «como *otro archivo*» si cabe, y la lupa muestra «Choca con». |
| Mayor | La lupa seguía al cursor mientras la selección marcaba otra fila; `aria-live` duplicaba los anuncios. | Corregido: la lupa sigue solo a la fila seleccionada, el cursor solo resalta y se retira `aria-live`. |
| Mayor | Cambiar el formato reiniciaba filtro y búsqueda y releía toda la carpeta. | Corregido: la hoja se queda atenuada con «Actualizando…», conserva filtro, búsqueda, desplazamiento y fila. El servidor reutiliza las fechas ya leídas (caché por ruta y huella; test de plan idéntico con y sin caché). |
| Mayor | En ≤ 640 px el estado se distinguía solo por color. | Corregido: etiquetas cortas con texto (Cambia, Choque, Omitida, Igual, Hecho, Falló, Pendiente). |
| Mayor | Si el servidor fallaba a mitad de aplicar, lo renombrado no se podía deshacer. | Corregido: `apply_plan(on_renamed=…)` guarda cada movimiento al instante; test que simula el fallo y deshace. |
| Menor | El nombre en «deshacer incompleto» salía en sans y se leía mal. | Corregido: mono. |
| Menor | Puntuación rota en «Resultado desconocido», y los 4xx se trataban como desconocidos. | Corregido: frase completa; un rechazo 4xx dice «No se aplicó ningún cambio». |
| Menor | Filtros redundantes («Todas 8 · Renombradas 8»). | Corregido: se ocultan cuando no aportan nada. |
| Menor | Titular que empezaba en minúscula («*vacia* no tiene archivos»). | Corregido: «La carpeta *vacia* está vacía». |
| Menor | En macOS, Alt+letra escribe caracteres. | Corregido: en macOS los atajos no actúan dentro de campos de texto. |
| Menor | axe solo se pasaba en min y medio. | Corregido: axe en todos los tamaños y en movimiento reducido. |

### Carencias e ideas del revisor

| Idea o carencia | Decisión | Motivo |
| --- | --- | --- |
| Lote deshacible persistente (barra y `/api/last-run`) | Adoptada | Cumple la promesa del diálogo y cubre el fallo a mitad de aplicar. |
| Origen de la fecha visible en la hoja | Adoptada | Sello «MOD» o «CREA» con borde discontinuo en la miniatura, filtro «Fecha del archivo», aviso en la confirmación y en la lupa. Recupera la información de 0.5.0 sin otra columna. |
| Fila de conflicto en dos niveles con salto al archivo | Adoptada en parte | El destino ocupa toda la línea y se nombra el archivo con el que choca. Se descarta el ajuste a dos líneas porque rompe la altura fija de la lista virtual. |
| Separar seleccionar de previsualizar | Adoptada | Corrige el defecto de la lupa. |
| Cambiar formato sin perder el sitio, reutilizando fechas | Adoptada | Caché de fechas en el servidor; los nombres no cambian (test). |
| Escenas que llenen el lienzo en grande y capturas con hover y axe ampliado | Adoptada | Escenas a 760 px desde 1280 px y axe en todas las variantes. El hover del preset se ve en `11-formato-cambiado`. |
| Tests de interfaz del controlador | Descartada en esta vuelta | Exigiría un navegador como dependencia de los tests del proyecto. El script de capturas recorre todos los estados con Playwright y falla si alguno no se alcanza. Queda como pregunta pendiente. |

---

## Vuelta 3

**Capturas:** `docs/capturas/vuelta-3/` · **Comprobaciones:** `docs/capturas/vuelta-3/checks.txt`

### Cambios de la vuelta

- Todas las correcciones y las ideas adoptadas de la tabla de la vuelta 2.
- Nuevas capturas:
  - `11b-formato-vacio`;
  - `13b-ultimo-lote` (barra visible tras cambiar de carpeta, y deshacer desde ella);
  - `16b-deshaciendo`.
- Axe se pasa ahora en los tres tamaños y en movimiento reducido.
- Durante la vuelta se corrigieron:
  - La anchura de carácter se medía antes de cargar JetBrains Mono, lo que causaba una doble elipsis en 360 px.
  - La elipsis central partía la fecha inicial; ahora la conserva entera (test en Node).
  - La vista «Deshaciendo» mostraba un contador congelado y la barra del lote que se estaba deshaciendo.
- Comprobaciones:
  - 55 tests de Python (1 omitido, solo POSIX) y 13 de Node verdes;
  - 100 capturas, con 0 errores de consola, 0 desbordamientos, 0 violaciones de axe en 88 estados auditados y todos los titulares dentro de la primera vista;
  - 60 fps al desplazar 3.000 filas y durante el revelado.
- Lighthouse: 99/100/100 en móvil y en escritorio.

### Defectos señalados por el revisor

No señaló bloqueantes. La mejora frente a la vuelta 2 fue de 0,03, por debajo de 0,2. Es la primera vuelta con una mejora tan pequeña, así que la regla de parada (dos seguidas) aún no se cumple y queda una vuelta más, la 4, que es el máximo.

| Prioridad | Defecto | Resolución (vuelta 4) |
| --- | --- | --- |
| Mayor | Aplicar un lote nuevo borraba el deshacer del anterior aunque el nuevo no renombrase nada. | Corregido: el lote anterior solo se sustituye cuando el nuevo renombra su primer archivo. El diálogo de confirmación avisa de que el lote anterior dejará de poder deshacerse. Test `test_a_batch_that_renames_nothing_keeps_the_previous_batch_undoable`. |
| Mayor | En 1024 y 360 px el nombre nuevo se cortaba por el centro. | Corregido: por debajo de 1280 px las filas miden 84 px y el nombre nuevo usa dos líneas. En 360 px las etiquetas pasan bajo la miniatura y el nombre ocupa todo el ancho. |
| Mayor | Tras deshacer desde la barra, el panel mostraba otra carpeta. | Corregido: deshacer fija la carpeta del lote. |
| Mayor | Quitar la última pieza durante un análisis mostraba «Análisis cancelado». | Corregido: se invalida la generación del análisis antes de cancelarlo. |
| Mayor | Filtros encima del resumen de resultados; contador en rojo para lo que salió bien. | Corregido: resumen, después filtros y después lista. El contador es verde para lo hecho y rojo solo si no cambió nada. |
| Menor | El error total culpaba a archivos «de solo lectura», que sí se renombran. | Corregido: «abierto en otro programa o carpeta sin permiso de escritura». |
| Menor | «Todos los nombres se aplicaron» con archivos sin tocar. | Corregido: «Todos los cambios previstos», más el número de archivos que siguen igual. |
| Menor | El nombre de carpeta en el titular se leía como palabra («La carpeta vacia está vacía»). | Corregido: la carpeta va entre comillas angulares, «vacia». |
| Menor | Al volver al inicio no aparecía la barra del último lote. | Corregido: `setMode` también la pinta. |
| Menor | El conflicto repetía el nombre («como X» igual al destino). | Corregido: «ya existe (fotograma 0001)» o «también lo pide el 0008». El número de fotograma es fijo por foto, aunque haya filtros. |
| Menor | El diálogo de confirmar no cabía en 360×720. | Corregido: versión compacta en ventanas de menos de 760 px de alto y desplazamiento al inicio. |
| Menor | Muestras 2025 frente a 2024, la versión «v0.6» inventada y etiquetas distintas para el mismo estado. | Corregido: la muestra es 2024_08_14 en todas partes, se retira la versión y las etiquetas cortas son «Renombra» y «Conflicto». |
| Menor | El origen de la fecha no se veía de un vistazo. | Corregido: desde 1280 px cada fila indica EXIF, XMP o Archivo. |
| Menor | La salida de `checks.txt` aparecía mezclada con el registro del servidor. | Corregido: los tests se ejecutan con `-b`. |

### Ideas del revisor

| Idea | Decisión | Motivo |
| --- | --- | --- |
| Nombre nuevo legible siempre | Adoptada | Dos líneas por debajo de 1280 px; la lista virtual sigue con altura fija (84 px). |
| Revelado real: de negativo a positivo al aplicar | Adoptada | Las miniaturas renombradas pasan de negativo a positivo, escalonadas. Con movimiento reducido el resultado es estático. |
| Deshacer a prueba de lotes | Adoptada | Corrige M1, M3 y m4. |
| Semántica de color y orden en los resultados | Adoptada | Corrige M5. |
| Revisión de textos: rótulo literal y titular en metáfora | Adoptada | Rótulos como «Analizando la carpeta», «Renombrando», «Resultado: 2 fallos», «Ningún archivo cambió» y «Resultado sin confirmar», sin primera persona. |
| Conflicto que salta a la fila con la que choca | Adoptada en parte | Se nombra el fotograma. El salto por enlace se descarta: un control dentro de una opción de `listbox` no es accesible. |
| Grafismo propio por estado | Descartada en esta vuelta | Prioridad menor que los defectos mayores; las tiras actuales ya distinguen los estados por forma y color. |

## Vuelta 4: verificación propia antes de la revisión

- **360 px:** en la primera captura de la vuelta 4, las etiquetas de estado desbordaban su columna de 66 px y tapaban la segunda línea del nombre nuevo. Ahora van bajo los nombres, en una sola línea, y el nombre usa todo el ancho.
- **Desde 1280 px:** con la tira ajustada a sus filas quedaba un hueco negro entre la tira y la lupa. La fila de la rejilla también se ajusta (`minmax(0, var(--content-h))`), y la lupa va justo después de la tira.
- **Fluidez:** la primera medición en 1680 px dio 38 fps. Para descartar una regresión, se compararon el código de la vuelta 3 y el de la vuelta 4 en el mismo equipo, alternándolos:
  - el código de la vuelta 4 dio 49–60 fps, sin tareas largas;
  - el perfil de CPU atribuye a JavaScript menos del 5 % del tiempo;
  - los 38 fps se debían a carga del equipo durante la captura, no al código.

### Puntuación y defectos señalados por el revisor (vuelta 4)

La ponderada fue 8,10: Diseño 8,3, Usabilidad 7,6, Creatividad 8,5 y Contenido 8,0. **No se alcanza el listón**: faltan Diseño ≥ 8,5, Usabilidad ≥ 8,0 y ponderada ≥ 8,5.

| Prioridad | Defecto | Resolución |
| --- | --- | --- |
| Bloqueante | En ventanas de 960 px o menos, la fila de la rejilla crecía hasta `--content-h`, que equivale a todas las filas, y dejaba un hueco de unos 250.000 px con 3.000 fotos. Lo introdujo el ajuste de la tira de esta misma vuelta. | Corregido: en el diseño estrecho y en ventanas bajas, la rejilla usa `auto` y la tira conserva su altura máxima. Sonda: con 2.000 fotos la página mide 1.183 px a 360×720, 857 px a 900×600 y 909 px a 1280×600. |
| Mayor | En dos líneas, el navegador cortaba en los espacios y `line-clamp` se comía la extensión. | Corregido: `word-break: break-all` llena las dos líneas, y el nombre se ve completo, con la extensión. |
| Mayor | Ningún aviso cuando el formato deja las fotos sin extensión. | Corregido: la confirmación avisa de cuántas fotos quedarán sin extensión y de que el sistema podría no abrirlas. El comportamiento de renombrado no cambia. |
| Mayor | «Resultado sin confirmar» prometía deshacer desde «Último lote» aunque la aplicación se hubiera cerrado. Además, un error imprevisto cortaba la conexión. | Corregido: el texto distingue si la aplicación sigue abierta. El servidor responde 500 con mensaje ante cualquier error imprevisto (test `test_an_unexpected_server_error_answers_500_instead_of_dropping_the_connection`). |
| Mayor | En móvil, la carpeta y el formato quedan después del botón de confirmar. | Pendiente. Requiere rediseñar el diseño estrecho (resumen fijo del formato y hoja inferior), y no queda vuelta de revisión para validarlo. El resumen de la caja Aplicar y la confirmación siguen mostrando la receta y un ejemplo. |
| Menor | No hay exclusión mutua entre dos deshacer, ni entre deshacer y confirmar. | Pendiente. Solo ocurre con dos pestañas a la vez; se anota como pregunta pendiente. |
| Menor | Contadores que repiten el titular o se contradicen con él (13, 16, 17b). | Pendiente. |
| Menor | Panel de ajustes cortado a 1024×768 sin indicar que se puede desplazar. | Pendiente. |
| Menor | En móvil, el buscador aparece antes del resumen del resultado. | Pendiente. |
| Menor | Los estados de espera tienen poco contenido, y deshacer no muestra progreso. | Pendiente. |
| Menor | Pillow sin versión fijada (`>=13.0`). | Pendiente: fijarla es una decisión de empaquetado que conviene tomar contigo, porque cambia lo que se instala. |

### Ideas del revisor (vuelta 4)

| Idea | Decisión | Motivo |
| --- | --- | --- |
| Formato fijo en móvil como hoja inferior | Pendiente | Es el cambio que más subiría la Usabilidad, pero rediseña el diseño estrecho y no queda ninguna vuelta de revisión. |
| Excluir fotos por grupo y por fila | Pendiente | Cambia el contrato de `/api/confirm`; conviene decidirlo contigo. |
| Resultado con tiras que se fijan en lugar del contador grande | Pendiente | Mismo motivo: mejora creativa sin vuelta de validación. |
| Avisos de riesgo con la misma voz que el resto | Adoptada en parte | Se adopta el aviso «sin extensión». La traducción de los errores del sistema queda pendiente. |
| Arte distinto por estado | Pendiente | Prioridad menor que los defectos. |
| Medir la altura de página en las capturas | Adoptada como sonda | Se midió aparte (ver arriba). Pasarlo a `capturar.py` queda pendiente. |

## Cierre del bucle

La vuelta 4 era la última permitida (máximo 4). Además, se cumple la regla de parada: la vuelta 3 mejoró 0,03 y la vuelta 4 bajó 0,02, dos vueltas seguidas con menos de 0,2 de mejora. **El listón no se alcanza**: la nota final es 8,10, con Diseño 8,3 y Usabilidad 7,6. Los arreglos posteriores a la revisión (el bloqueante y tres mayores) no tienen nota propia, porque no queda vuelta para puntuarlos.
