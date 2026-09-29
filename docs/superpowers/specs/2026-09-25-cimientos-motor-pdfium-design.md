# Diseño · Cimientos del editor: motor PDFium y reconstrucción modular

- **Fecha:** 2026-09-25
- **Estado:** propuesto (pendiente de aprobación del dueño antes del plan de implementación)
- **Ámbito:** subproyecto 1 de la reconstrucción — los cimientos y una rebanada vertical que los demuestre. Las demás áreas (formularios, firma, OCR, conversión, redacción, organización, visor avanzado) son subproyectos posteriores, cada uno con su propio spec.

---

## 1. Contexto y objetivo

El editor debe llegar a hacer **lo mismo o más que Adobe Acrobat / PDF Agile**, priorizando **cimientos de ingeniería sólidos** por encima de avanzar rápido. Destino: **producto / posible SaaS**, pero **con presupuesto cero ahora**, así que todo tiene que ser gratis y de licencia permisiva (compatible con un servicio cerrado el día de mañana). Los cuatro usos importan: editar contenido, rellenar/firmar, organizar/convertir, revisar/anotar.

El editor actual funciona "a medias": su función central —editar el texto que ya trae el PDF— se apoya en **tapar el texto con una imagen** en vez de reescribir el contenido. Consecuencias medidas (2026-09-25, `main` en `82475ea`):

- La exportación escribe píxeles: `drawText`/`embedFont` aparecen **0 veces** en `js/app.js`. Lo editado no es seleccionable, se pixela al ampliar y el original sigue debajo (**E-024**, abierto).
- El estado está disperso entre el DOM (`dataset.meta`, `style.left`), `docState.annotations` y los canvas. De ahí salieron E-007, E-010, E-011, E-013.
- Tres librerías se solapan: pdf.js 3.11 (render/extracción, quedó atrás y motivó el CVE-2024-4367, ya mitigado en E-027), pdf-lib 1.17 (escritura, sin versiones desde 2021) y utilidades.
- Faltan básicos de un visor serio: búsqueda, marcadores, formularios, enlaces.

Lo que **sí** es sólido y se conserva: la suite E2E en Chromium real, las reglas deterministas y `docs/ERRORES-CONOCIDOS.md`. Es la red de seguridad que permite reconstruir sin romper.

### Criterios de éxito del subproyecto

1. Existe una arquitectura modular tipada donde la UI **no** habla con el motor directamente.
2. Editar una línea produce **texto vectorial real** en el PDF guardado: seleccionable, y con el original **eliminado**, no tapado.
3. Deshacer/rehacer coherentes.
4. La app actual sigue funcionando y desplegada hasta el cutover; ninguna función se pierde.
5. `npm run verify` (adaptado al nuevo build) en verde, con tests de paridad y nuevos.

---

## 2. Decisión de motor: PDFium (validada por spike)

**Motor elegido:** PDFium vía `@embedpdf/pdfium` — wrapper **MIT** sobre el motor **BSD** de Chrome, activo (v2.15.1, sept. 2026), compila a WASM. Permisivo: sirve para un SaaS cerrado sin pagar ni abrir el código. Descarta MuPDF (AGPL obliga a abrir el código de un servicio; su comercial cuesta).

**Evidencia (spike desechable, Node, WASM gratis, 2026-09-25):** ciclo completo verificado —
abrir → extraer texto con posiciones → insertar objeto de texto **vectorial** (`FPDFPageObj_NewTextObj` + `FPDFText_SetText` + `FPDFPage_InsertObject`) → `FPDFPage_GenerateContent` → `FPDF_SaveAsCopy` → reabrir. Resultado: PDF válido (863→1745 bytes), conserva el original y **la edición persiste seleccionable, no raster**. El wrapper expone edición y guardado, no solo render (`FPDFPage_RemoveObject`, `FPDF_SaveWithVersion`, `FPDFAnnot_*`, `FPDFText_GetText/GetCharBox`, importar/borrar páginas). Memoria emscripten en `w.pdfium._malloc/_free`; `HEAPU8/setValue/UTF16ToString/addFunction` en `w.pdfium`.

**Respaldo** si en implementación algo lo tumbara: pdf.js (render/extracción, Apache) + pdf-lib/@cantoo (escritura, MIT) + editor de flujo de contenido propio. La capa de abstracción hace este cambio localizado.

---

## 3. Arquitectura

Dependencias hacia abajo; **la UI nunca llama a `FPDF_*`**:

```
UI (visor, ribbon, paneles)        TS + módulos; refleja el modelo, despacha comandos
  ↓
Comandos (do/undo por acción)      cada acción del usuario = 1 Command; CommandBus
  ↓
Modelo de documento (estado único) páginas, objetos, anotaciones, selección
  ↓
Puerto de motor  interface PdfEngine   contrato estable; PdfiumEngine lo implementa
  ↓
Shell + build (Vite, wasm vendorizado) salida estática; Vercel la sirve; cero backend
```

Transversales:

- **`PageGeometry` (coordenadas tipadas):** único lugar con aritmética entre unidades y con el volteo de eje Y y la rotación.
- **Arnés de pruebas:** la suite E2E actual como contrato de paridad, más unitarios ya posibles.

### Estructura de carpetas (orientativa)

```
src/
  engine/
    PdfEngine.ts        interfaz (puerto)
    pdfium/             implementación con @embedpdf/pdfium
    coords/             PageGeometry y tipos branded
  model/                modelo de documento y tipos
  commands/             un fichero por comando
  ui/                   viewer/ ribbon/ panels/ modals/
  app.ts                arranque
tests/e2e/              suite actual, conservada como contrato de paridad
tests/unit/             coordenadas, puerto de motor, comandos
```

---

## 4. Modelo de documento y coordenadas

**Autoridad:** PDFium es la autoridad del PDF real; el **modelo** es una proyección tipada y observable, más la cola de ediciones. Los comandos aplican al motor y actualizan el modelo; el modelo emite eventos; la UI se repinta.

```ts
DocumentModel { id; pages: PageModel[]; selection; dirty }
PageModel { index; sizePt: SizePt; rotation: 0|90|180|270; runs: TextRun[]; annotations: Annot[] }
TextRun  { objIndex; text; boxPt: RectPt; font; sizePt }   // ligado al objeto REAL de PDFium
```

Cada línea editable apunta a su **objeto real** en la página; editar modifica ese objeto, no pinta un parche.

**Deshacer/rehacer — híbrido:** operación inversa por comando (barato, preciso); snapshot de bytes como respaldo para operaciones complejas de página. Sustituye al `switch` de ~250 líneas y cierra E-011.

**Coordenadas — tipos branded que no se pueden mezclar:**

```ts
type Pt       = number & { u: 'pdf-pt' }    // espacio PDF, origen abajo-izq, Y arriba
type DevicePx = number & { u: 'device-px' } // píxeles del bitmap renderizado
type CssPx    = number & { u: 'css-px' }     // píxeles de maquetación
```

Conversiones (incluido Y-flip y rotación) solo en `PageGeometry`, que conoce `alturaPt`, `escalaRender`, `dpr`. Este módulo elimina por diseño E-001, E-002, E-009 y el bug de rotación (issue #7).

**Consecuencia:** con PDFium para render + extracción + edición hay **un solo motor y un solo sistema de coordenadas**; se **retira pdf.js y pdf-lib del núcleo**. Menos código, una sola fuente geométrica, y desaparece el pdf.js 3.11 del CVE.

### 4.1 Fidelidad de edición (requisito central)

El editor anterior, al tocar una línea, cambiaba el tipo de letra, el fondo y la maquetación, porque tapaba con una imagen y re-escribía con una fuente por defecto. **Aquí no.** Regla de diseño dura, verificada por spike (2026-09-26):

> Editar una línea modifica el **objeto de texto existente en sitio** con `FPDFText_SetText(obj, …)`, que **conserva su fuente, tamaño, color y matriz de posición**. Nunca se crea un objeto nuevo con fuente por defecto para una edición, ni se rasteriza.

Evidencia del spike: una línea Times-Roman 18pt roja en (40,150) → tras editarla, guardar y reabrir → fuente `Times-Roman`, tamaño `18`, color `[217,26,26,255]` y posición `[40,150]` **idénticos**; solo cambió el texto, y las demás líneas quedaron intactas. Las propiedades se leen con `FPDFTextObj_GetFont/GetFontSize`, `FPDFFont_GetBaseFontName`, `FPDFPageObj_GetFillColor/GetMatrix`.

Casos que el spec del comando `EditTextRun` debe cubrir en su plan:
- **Texto que no cabe en el ancho original:** conservar fuente/tamaño; el reflujo de párrafo fino es trabajo posterior, pero la línea editada no debe pisar a la vecina.
- **Glifos ausentes en un subconjunto de fuente incrustada:** si la fuente incrustada no trae el carácter tecleado, detectarlo y avisar/derivar a una estrategia definida (no sustituir la fuente en silencio).
- **Insertar texto nuevo** (no editar): reutilizar un recurso de fuente de la página cuando exista; solo si no hay, incrustar una fuente elegida — decisión explícita, nunca un Helvetica accidental.
- **Redacción:** eliminar el objeto (`FPDFPage_RemoveObject`), no taparlo.

---

## 5. Comandos y enlace con la UI

```ts
interface Command { id; label; execute(ctx): void; undo(ctx): void; coalesceKey?: string }
// ctx = { engine, model }
```

**`CommandBus`:** ejecuta, apila en deshacer, limpia rehacer, emite eventos. `coalesceKey` agrupa (teclear = un paso de deshacer). Los comandos son la **costura de test** (unitario contra motor/modelo en memoria).

La UI despacha comandos y escucha eventos; **nunca** muta el modelo:

```
gesto/tecla → Herramienta (UI) → Command → CommandBus → modelo cambia/emite → re-render de la página afectada
```

**Render y rendimiento:** solo páginas visibles (con el `IntersectionObserver` existente), a escala consciente del `devicePixelRatio`, re-render solo al ensuciarse el modelo o cambiar el zoom. Corrige por diseño #12 (render anticipado + recarga total por operación) y #11 (guardar depende del motor, no de que el DOM esté pintado). Las asas de selección van en capa superpuesta, en `CssPx`, vía `PageGeometry`.

---

## 6. Build, tests y reglas

**Build:** Vite + TypeScript. Dev-server de Vite en desarrollo; `vite build` genera estáticos para Vercel (sigue sin backend). Se **vendorizan** `pdfium.wasm` y los assets de Tesseract (hoy en CDN) — mejora privacidad y offline. Librerías de función (Tesseract/OCR, docx-preview/Word, KaTeX·marked·highlight/Markdown) se conservan como módulos empaquetados.

**Reglas deterministas — se migran, no se tiran.** `no-codigo-muerto`, `versiones-coherentes`, `build:check` asumen la estructura actual; su *intención* (cada una nació de un `E-0NN`) se reescribe para el nuevo build, con su test, en el mismo PR (AGENTS.md §6). Reglas nuevas que el modelo habilita: "la UI no importa `FPDF_*`", "no hay aritmética entre unidades fuera de `PageGeometry`".

**Continuidad de tests — contrato de paridad.** La suite E2E se conserva; el código nuevo debe pasarla. Los tests que asertan el *mecanismo viejo* (E-001/E-002, en torno al parche raster) **se refuerzan**: pasan a asertar la conducta mejor —"el texto editado es extraíble y el original ya no está" (cierre de E-024)— documentándolo en `ERRORES-CONOCIDOS.md`. Se añaden unitarios de coordenadas, puerto de motor y comandos.

---

## 7. Primera rebanada vertical (alcance del plan de implementación)

Atraviesa **todas** las capas en una función real:

1. Esqueleto Vite + TS + `pdfium.wasm` vendorizado; la app arranca; salida estática para Vercel.
2. Puerto `PdfEngine` + `PdfiumEngine`: `open`, `pageCount`, `pageSize`, `renderPage→bitmap`, `getPageText→runs con cajas`, `editTextRun`, `save→bytes`.
3. Modelo + `PageGeometry` (coordenadas tipadas).
4. Visor mínimo usable: render de páginas visibles, capa de texto superpuesta, zoom + ajuste al ancho, navegación.
5. Una herramienta: clic en línea → editar in-place → confirmar → comando `EditTextRun` con deshacer/rehacer y escritura agrupada.
6. Guardar/descargar PDF vectorial.
7. Tests: E2E de paridad (flujo "editar una línea"); E2E reforzado (texto editado extraíble, original ausente); unitarios de coordenadas y del comando.

**Fuera de esta rebanada** (subproyectos posteriores): OCR, importaciones Word/imagen/Markdown, compresión, dividir, firmas/sellos, dibujo, filtros, miniaturas, cajones móviles, fusionar, búsqueda, marcadores, formularios, redacción avanzada.

**Definición de "hecho":** abrir un PDF real, editar una línea, guardar, reabrir y comprobar que (a) el texto editado es seleccionable y el original desapareció, y (b) **fuente, tamaño, color y posición se conservan idénticos** — solo cambió el texto (§4.1); deshacer/rehacer coherentes; `npm run verify` (adaptado) en verde con tests nuevos y de paridad.

---

## 8. Modelo de entrega: coexistencia y cutover

Reconstrucción **completa sin perder funcionalidad**: la app nueva crece en `src/` y se construye aparte; **la app actual sigue intacta y desplegada** hasta que la nueva alcance paridad. El **cutover** ocurre solo cuando la tabla de migración (§9) está entera en verde. En ningún momento hay usuarios sin funciones. La suite E2E actual sigue siendo la referencia y se mantiene verde hasta el cutover.

---

## 9. Checklist de migración (ninguna función se queda fuera)

Estado: **Conservada** (misma función, nueva base) · **Mejorada** (además corrige un defecto o límite actual).

**App nueva** (columna añadida tras el lote A "visor y documento"; verificada contra `src/` y `tests/e2e/next/`, no copiada del punto de partida sin comprobar): ✅ hecha · 🟡 parcial (qué falta) · ⬜ falta.

| # | Función actual | Estado | Respaldo en el motor/arquitectura | Test de paridad | App nueva |
|---|---|---|---|---|---|
| 1 | Abrir PDF (input + drag&drop) | Conservada | `engine.open` | abre y renderiza | ✅ hecha — input (`#file-input`) ya existía; drag&drop de PDF/imagen sobre `#app` añadido en el lote A (`tests/e2e/next/soltar-fichero.spec.ts`) |
| 2 | Crear PDF en blanco | Conservada | `FPDF_CreateNewDocument` + `FPDFPage_New` | crea 1 página | ✅ hecha — `PdfiumEngine.createBlank` + `#btn-new` (lote A; `tests/e2e/next/nuevo.spec.ts`, `tests/unit/PdfiumEngine.createblank.test.ts`) |
| 3 | Insertar/fusionar otro PDF | Mejorada | `FPDF_ImportPages` | inserta N páginas en posición | ✅ hecha — `InsertPdfCmd` + `#btn-insert-pdf` (`tests/e2e/next/combinar.spec.ts`) |
| 4 | Importar Word .docx → PDF | Conservada | docx-preview + importador | abre sin pérdida | ⬜ falta — sin importador docx en `src/` |
| 5 | Importar imagen → PDF | Conservada | importador + `FPDFPageObj` imagen | imagen incrustada | ✅ hecha — `engine.imageToPdf` + `#btn-open-image` (`tests/e2e/next/imagen-a-pdf.spec.ts`) |
| 6 | Visor continuo | Mejorada | render por página visible | páginas visibles pintan | ✅ hecha — `Viewer` + `visiblePageIndices` (IntersectionObserver + overscan) |
| 7 | Zoom (in/out, %) | Conservada | `PageGeometry` + render por escala | zoom cambia tamaño | ✅ hecha — `#btn-zoom-in`/`#btn-zoom-out` (`tests/e2e/next/color-zoom.spec.ts`) |
| 8 | Ajuste al ancho | Mejorada | `PageGeometry` | ajusta al abrir (móvil incl.) | ✅ hecha — `App.fitWidth` + `#btn-fit-width`, también al abrir un documento en cualquier tamaño de ventana, no solo móvil (lote A; `tests/e2e/next/ajuste-ancho.spec.ts`) |
| 9 | Navegación por página | Conservada | modelo + observer | salta a página | ✅ hecha — `App.goToPage` + `#btn-prev`/`#btn-next`/miniatura/marcador (`tests/e2e/next/navegacion.spec.ts`, `pagina-actual.spec.ts`) |
| 10 | Miniaturas laterales | Conservada | render a escala baja | miniatura por página | ✅ hecha — `App.buildThumbnails` (`tests/e2e/next/navegacion.spec.ts`) |
| 11 | Reordenar por drag&drop | Conservada | comando `MovePageCmd` | orden persiste al guardar | ✅ hecha — `#btn-page-up`/`#btn-page-down` (`tests/e2e/next/reordenar.spec.ts`) y arrastrar miniaturas con pointer events, indicador de inserción y Escape para cancelar (`App.beginThumbDrag`, `tests/e2e/next/arrastrar-miniaturas.spec.ts`) |
| 12 | Editar texto in-place | **Mejorada** (vectorial, fiel) | `EditTextRun` + PDFium (edición en sitio) | editado extraíble; original eliminado; **fuente/tamaño/color/posición idénticos** (§4.1) | ✅ hecha — `EditTextRunCmd` (`tests/e2e/next/edicion-fiel.spec.ts`, `linea-base-edicion.spec.ts`, `fidelidad-reposo.spec.ts`) |
| 13 | Cuadros de texto nuevos | Mejorada | `AddTextObject` | texto nuevo extraíble | ✅ hecha — `InsertTextCmd` + modo insertar (`#btn-insert`) (`tests/e2e/next/redaccion-insercion.spec.ts`) |
| 14 | Mover/eliminar bloque de texto | Mejorada | `MoveObject`/`DeleteObject` | posición/ausencia en el PDF | ✅ hecha — `MoveRunCmd` (tirador) + `DeleteRunCmd` (`#btn-delete`) (`tests/e2e/next/mover.spec.ts`, `redaccion-insercion.spec.ts`) |
| 15 | Panel de propiedades (fuente/tamaño/color) | Conservada | comando sobre objeto seleccionado | cambia el objeto en edición | ✅ hecha — `#props-panel` (`SetRunFontCmd`/`SetRunFontSizeCmd`/`SetColorCmd`) (`tests/e2e/next/propiedades.spec.ts`) |
| 16 | Lápiz / resaltador / rectángulo | Conservada | anotaciones o trazos de página | trazo llega al PDF | ✅ hecha — lápiz (`#btn-pen` → `DrawStrokeCmd`), resaltador (`#btn-highlight` → `HighlightRunCmd`) y rectángulo (`#btn-rect` → `drawRect`/`DrawRectCmd`, vista previa discontinua mientras se arrastra) (`tests/e2e/next/pluma.spec.ts`, `resaltar.spec.ts`, `herramientas.spec.ts`) |
| 17 | Borrador | Conservada | `deleteObject` + selección por proximidad real a la arista (`listPathObjects`/`getPathSegments`/`pathMasCercano`) | quita el trazo | ✅ hecha — `#btn-eraser`: clic sobre un trazo de pluma o un rectángulo (paths con trazo) lo borra (`DeleteObjectCmd`); un clic en el hueco interior de un rectángulo grande no borra nada, porque la selección es por distancia a la arista, no por caja envolvente (`tests/e2e/next/herramientas.spec.ts`, `tests/unit/toolGeometry.test.ts`) |
| 18 | Selector de color (muestras + custom) | Conservada | `App.toolColor`, único para pluma/rectángulo/resaltado | color aplicado | ✅ hecha — `#swatches` (8 muestras) + `#tool-color` personalizado fijan `toolColor`; `#btn-color` (color del TEXTO ya en el documento, seleccionado) es un control aparte y sigue igual (`tests/e2e/next/color-zoom.spec.ts`, `herramientas.spec.ts`) |
| 19 | Firma: pad de dibujo | Conservada | imagen → objeto de página | sello incrustado | ✅ hecha — `SignaturePad` + `#btn-sign` → `InsertImageCmd` (`tests/e2e/next/firma.spec.ts`) |
| 20 | Firma: subir imagen (quita fondo) | Conservada | transcode + objeto imagen | fondo transparente | ✅ hecha — `#btn-sign-upload` → `quitarFondo` (umbral 235 + borde suave) → `InsertImageCmd` con alfa real (el motor ya conservaba el canal alfa, ver `PdfiumEngine.insertImage`); queda seleccionada para reposicionarla (`tests/unit/quitarFondo.test.ts`, `tests/e2e/next/sello.spec.ts`) |
| 21 | Sello interactivo (mover/redimensionar/borrar) | Conservada | objeto + comandos | geometría final correcta | ✅ hecha — `ImageLayer` (marco `.image-box` con 4 tiradores `.image-handle`): clic selecciona, arrastrar el marco mueve (`SetObjectRectCmd`), arrastrar una esquina redimensiona conservando proporción por defecto (Mayús la libera), Suprimir/Retroceso borra (`DeleteObjectCmd`, snapshot) — todo con deshacer (`tests/unit/PdfiumEngine.imageobjects.test.ts`, `SetObjectRect.test.ts`, `DeleteObject.test.ts`, `tests/e2e/next/sello.spec.ts`) |
| 22 | Rotar página (horaria/antihoraria) | **Mejorada** (arregla #7) | rotación en `PageGeometry` + `FPDFPage_SetRotation` | E-012 + anotación bien ubicada tras rotar | ✅ hecha — `RotatePageCmd` + `#btn-rotate` (`tests/e2e/next/paginas.spec.ts`) |
| 23 | Duplicar página | Conservada | `FPDF_ImportPages` | E-007 verde | ✅ hecha — `DuplicatePageCmd` + `#btn-duplicate` (`tests/e2e/next/duplicar.spec.ts`) |
| 24 | Eliminar página | Conservada | `FPDFPage_Delete` | página fuera | ✅ hecha — `DeletePageCmd` + `#btn-delete-page` (`tests/e2e/next/paginas.spec.ts`) |
| 25 | Filtros (Magic Color / B&N / grises) | **Mejorada** (solo imágenes, el texto queda vectorial) | `getImagePixels`/`replaceImagePixels` + `src/image/filtros.ts` | filtro en el PDF, texto intacto | ✅ hecha — `#filter-select` + `#btn-filter` → `FiltrarPaginaCmd`, actúa SOLO sobre los objetos imagen de la página (a diferencia de la app vieja, que rasteriza la página entera): el texto y los vectores siguen seleccionables y nítidos. Blanco y negro usa umbral de Otsu real (`otsuThreshold`), no un valor fijo (`tests/unit/filtros.test.ts`, `PdfiumEngine.imagepixels.test.ts`, `FiltrarPagina.test.ts`, `tests/e2e/next/filtros-comprimir.spec.ts`) |
| 26 | OCR escaneado → texto vivo | Conservada | Tesseract + `EditTextRun` | líneas OCR editables | ✅ hecha — `OcrPageCmd` + `TesseractOcr` + `#btn-ocr`, inserta texto invisible buscable/editable (`tests/e2e/next/ocr.spec.ts`) |
| 27 | OCR modal: copiar / .txt | Conservada | extracción | copia y descarga | 🟡 parcial: el texto reconocido queda en el PDF (extraíble con `getPageText`, buscable con `#btn-search`); no hay modal de resultado con botón de copiar ni descarga `.txt` |
| 28 | Exportar/descargar PDF | **Mejorada** (vectorial) | `engine.save` | exportar dos veces = igual (E-005) | ✅ hecha — `#btn-save` (`tests/unit/save.idempotente.test.ts`) |
| 29 | Comprimir | **Mejorada** (solo imágenes, el texto queda vectorial) | `replaceImageJpeg`/`replaceImagePixels` + `src/image/comprimir.ts` | reduce peso sin romper, texto intacto | ✅ hecha — `#btn-compress` (calidad + dpi máximo) → `ComprimirDocumentoCmd`: para cada imagen, si su dpi efectivo excede el máximo se reescala, y si no tiene transparencia se recodifica a JPEG (se conserva la original si el JPEG saldría más pesado); las imágenes con alfa real (SMask) nunca pasan a JPEG. El texto y los vectores no se tocan (a diferencia de la app vieja, que rasteriza cada página completa). Reduce ≥40% en el E2E con una imagen fotográfica de prueba (`tests/unit/comprimir.test.ts`, `ComprimirDocumento.test.ts`, `tests/e2e/next/filtros-comprimir.spec.ts`) |
| 30 | Dividir por rango | Conservada | `FPDF_ImportPages` a doc nuevo | extrae páginas pedidas | ✅ hecha — `engine.extractPages` + `#btn-split`/`#btn-range` (`tests/e2e/next/dividir.spec.ts`, `extraer.spec.ts`) |
| 31 | PDF → Markdown | Conservada | extracción con posiciones | md coherente | ⬜ falta — sin exportador Markdown en `src/` |
| 32 | Markdown → PDF | Conservada | KaTeX/marked + importador | compila y abre | ⬜ falta — sin importador Markdown en `src/` |
| 33 | Deshacer/rehacer global | **Mejorada** | CommandBus | E-011 verde + agrupación | ✅ hecha — `CommandBus` + `#btn-undo`/`#btn-redo`/Ctrl+Z/Ctrl+Y (numerosos tests, p. ej. `propiedades.spec.ts`) |
| 34 | Atajos de teclado | Conservada | herramientas | E-017 verde | 🟡 parcial: solo Ctrl+Z/Ctrl+Y globales (`App` constructor) + Enter/Escape dentro de una línea en edición (`TextLayer`); la app vieja cubre bastantes más atajos (E-017) |
| 35 | Cajones móviles / responsive | Conservada | UI | E-015/E-016/E-025/E-026 verdes | 🟡 parcial: el visor se ajusta al ancho también en móvil (fila 8), pero la barra lateral (miniaturas/marcadores) es un panel fijo de 150px, no un cajón deslizante que se pueda ocultar en pantallas estrechas |
| 36 | Impresión | Conservada | `window.print` | diálogo abre | ✅ hecha — `#btn-print`: genera el PDF vectorial actual y lo imprime vía un `<iframe>` oculto con blob: (no `window.print()` a secas, que solo pintaría el DOM) (lote A; `tests/e2e/next/imprimir.spec.ts`) |
| 37 | **Redactar (censura real)** | **Nueva/Mejorada** | `ApplyRedaction` (elimina objetos) | texto bajo la marca no se extrae (cierra E-024) | ✅ hecha — `DeleteRunCmd` elimina el objeto de texto (no lo tapa) (`tests/e2e/next/redaccion-insercion.spec.ts`) |

**Conteo:** 28 hechas (1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28, 30, 33, 36, 37) · 4 parciales (11, 27, 34, 35) · 5 faltan (4, 25, 29, 31, 32). (Actualizado tras el lote D: 16/17/18 pasan de parciales a hechas; de paso se corrige el arrastre de 20/21, que ya estaban hechas desde el PR #55 pero el conteo no se había actualizado.)

### Añadidas en la app nueva (no estaban en la vieja)

- Notas adhesivas (`AddNoteCmd`, `#btn-note`).
- Formularios AcroForm completos: texto, casilla, radio, combo y lista, con apariencia regenerada (`SetFormText/Checked/Choice/RadioCmd`, `tests/e2e/next/formulario.spec.ts`, `formulario-fase2.spec.ts`).
- Marcadores (outline): árbol de lectura y navegación (`getOutline`, `tests/e2e/next/marcadores.spec.ts`).
- Subrayar y tachar como anotaciones reales, además de resaltar (`UnderlineRunCmd`, `StrikethroughRunCmd`, `tests/e2e/next/subrayar-tachar.spec.ts`).
- Búsqueda de texto en el documento, con resaltado de coincidencias (`engine.findText`, `#btn-search`, `tests/e2e/next/busqueda.spec.ts`).
- Sustitución de fuente cuando faltan glifos (`ReplaceRunFontCmd`) y cambio de fuente/tamaño elegido por el usuario desde el panel de propiedades (`SetRunFontCmd`/`SetRunFontSizeCmd`).
- Capa de OCR invisible y buscable: el texto reconocido se inserta como texto PDF real en modo de render invisible (`insertText({ invisible: true })`), no como una capa aparte — queda seleccionable/buscable sin alterar el aspecto de la página escaneada.

---

## 10. Relación con las issues abiertas

- #7 (rotación) → corregido por diseño (§4, autoridad única de coordenadas); su entrada será **E-028**.
- #8 y #9 (E-024) → superados: la redacción real (fila 37) los cierra de raíz.
- #10 (SRI/CDN) → vendorizar el motor y empaquetar las librerías disuelve el grueso; la CSP sigue siendo decisión del dueño (AGENTS.md §5).
- #11 (exportación depende del render) y #12 (render anticipado) → corregidos por diseño (§5).
- #13 (README ≠ código) → la tabla §9 es la fuente de verdad; el README se actualiza en el cutover.
- #14 (peso muerto: jszip, deps falsas) → desaparece con el nuevo build.
- E-027 (CVE-2024-4367) → ya mitigado; retirar pdf.js del núcleo lo elimina de raíz.

---

## 11. Riesgos y mitigaciones

- **Peso del `.wasm` de PDFium** (varios MB): carga diferida y cacheado; aceptable para una app de escritorio-en-navegador. Medir en la rebanada.
- **Edición de texto con reflow real** (kerning, subconjuntos de fuente): la rebanada valida el caso de línea; el reflujo fino de párrafo es trabajo posterior, acotado en su propio spec.
- **`vercel.json`**: pasar a build tocará su parte de build/output. **No** se tocan CSP ni cabeceras sin permiso explícito (AGENTS.md §5).
- **Migración de reglas**: cada regla migrada lleva su test en el mismo PR; el guard no puede quedar en rojo ni con exenciones nuevas.
- **Alcance**: cada área fuera de la rebanada es su propio spec/plan; no se mezclan.

---

## 12. Fuera de alcance de este spec

Formularios (AcroForm/XFA), firma digital criptográfica, búsqueda a texto completo, marcadores/esquema, enlaces, accesibilidad/etiquetado, y el reflujo de párrafo avanzado. Cada uno se diseña como subproyecto sobre estos cimientos.
