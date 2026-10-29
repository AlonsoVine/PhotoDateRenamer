# PhotoDateRenamer

PhotoDateRenamer organiza fotografías anteponiendo a sus nombres una fecha encontrada en los metadatos de la imagen o, como último recurso, en las fechas del archivo. La aplicación funciona localmente: las imágenes no se suben ni se envían a servicios externos.

La versión actual incluye una interfaz web servida por una aplicación local de Python. El navegador permite elegir una carpeta, preparar una vista previa, personalizar el nombre y confirmar o deshacer el cambio.

## Funcionalidades

- Lee fechas EXIF (`DateTimeOriginal`, `DateTimeDigitized` y `DateTime`) y fechas XMP en JPEG, PNG y TIFF.
- Si no encuentra fechas en los metadatos, recurre primero a la última modificación y después a la fecha de creación del archivo; la vista previa indica cuál se usó.
- Muestra los nombres propuestos y marca archivos sin fecha o con conflictos antes de cambiar nada.
- Incluye los formatos `YYYY_MM_DD`, `YYYY-MM-DD` y `YYYYMMDD`.
- Ofrece recetas de nombre y un editor para concatenar fecha, nombre original, título sin extensión, extensión y texto fijo.
- Requiere confirmación explícita para renombrar y permite deshacer el último lote mientras la aplicación siga abierta.
- El servicio HTTP escucha únicamente en `127.0.0.1`.

La fecha se busca en este orden: EXIF de captura, EXIF de digitalización, EXIF general, XMP, última modificación del archivo y, al final, creación del archivo. Las fechas del sistema de archivos pueden corresponder a una copia o edición y no a la captura; por eso la tabla muestra la fuente empleada para cada fotografía. Los destinos existentes, nombres duplicados y nombres inválidos se señalan como conflictos; esos elementos no se renombran.

## Uso del ejecutable portable en Windows

Para probar una compilación reciente, abre una ejecución completada del workflow **CI** en GitHub Actions y descarga el artefacto `PhotoDateRenamer-windows`. Ese artefacto de CI es temporal y no equivale a una publicación de GitHub Releases.

Las versiones se distribuyen en [GitHub Releases](https://github.com/AlonsoVine/PhotoDateRenamer/releases). Al publicar una etiqueta `v*` (por ejemplo, `v0.3.0`), el workflow **Release** ejecuta las pruebas, construye el `.exe` para Windows y publica el ejecutable junto con `LICENSE`. Para ejecutar la aplicación, abre `PhotoDateRenamer.exe`; se iniciará la interfaz en el navegador predeterminado. Si no se abre automáticamente, usa la URL que aparece en la consola.

Selecciona una carpeta con **Explorar** o escribe su ruta. Elige un formato, revisa la vista previa y pulsa **Confirmar renombrado** solo cuando los cambios sean correctos. La opción **Deshacer** restaura el último lote mientras la ventana del programa continúe abierta.

## Ejecución desde el código

Requiere Python 3.10 o posterior.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
python rename_photos.py
```

También se puede usar el comando instalado:

```powershell
photo-date-renamer
```

## Compilar el `.exe` para Windows

En Windows, con Python 3.10 o posterior:

```powershell
.\scripts\build_windows.cmd
```

El ejecutable portable se genera siempre en `dist\PhotoDateRenamer.exe`. Cada compilación sustituye esa versión y elimina los ejecutables anteriores con sufijo de versión para mantener una única entrega actual. La compilación incluye Pillow, el lector seguro XMP y los recursos web; no requiere instalar Python en el equipo que lo ejecuta. El artefacto está pensado para Windows y no es una compilación para macOS.

## Licencia

PhotoDateRenamer se distribuye bajo una licencia propietaria de uso personal y no comercial. Permite ejecutar y modificar una copia para uso personal; prohíbe el uso comercial y la redistribución del código, los binarios y las versiones derivadas. Todos los demás derechos quedan reservados. Para solicitar permisos adicionales o comerciales, contacta con [Alonso Viñé a través de su portfolio](https://alonsovine.github.io/portfolioR/). Consulta [LICENSE](LICENSE) para los términos completos. Las dependencias de terceros mantienen sus propias licencias.

## Desarrollo y pruebas

```powershell
python -m pip install -e ".[dev]"
python -m unittest discover -s tests -v
```

Los tests construyen imágenes temporales con metadatos de prueba y no modifican fotografías del repositorio. La integración continua prueba el motor en Windows, Linux y macOS; el trabajo de compilación produce el `.exe` de Windows.

## Estructura

```text
src/photodaterenamer/
  app.py                 Arranque y apertura del navegador
  renamer.py             Lectura EXIF/XMP/archivo, vista previa, renombrado y deshacer
  server.py              HTTP local y operaciones de la interfaz
  web/                   Interfaz y recursos estáticos (ilustración e icono)
tests/                   Pruebas del motor de nombres
docs/adr/                Decisiones arquitectónicas
AGENTS.md                Reglas para agentes y contribuidores
scripts/                 Automatización de compilación
```

## Evolución a otras plataformas

El motor de nombres y el formato de componentes no dependen de la interfaz ni del empaquetador. Para macOS se deberá añadir un empaquetado y selector de carpetas apropiados. Para Docker, la persona usuaria tendrá que montar explícitamente las carpetas de fotos; el contenedor no podrá acceder de forma implícita a todo el sistema de archivos anfitrión.

## Decisiones de arquitectura

- [ADR 0001: Aplicación web local](docs/adr/0001-local-browser-application.md)
- [ADR 0002: Vista previa antes de renombrar](docs/adr/0002-preview-before-rename.md)
- [ADR 0003: Nombres personalizados por componentes](docs/adr/0003-custom-name-components.md)
- [ADR 0004: Prioridad de fuentes para la fecha de las fotos](docs/adr/0004-photo-date-source-priority.md)

Consulta [AGENTS.md](AGENTS.md) para las convenciones del proyecto y las actualizaciones requeridas en cada iteración.
Las instrucciones para contribuir y el formato de commits están en [CONTRIBUTING.md](CONTRIBUTING.md).
