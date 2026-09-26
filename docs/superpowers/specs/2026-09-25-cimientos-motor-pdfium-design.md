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

| # | Función actual | Estado | Respaldo en el motor/arquitectura | Test de paridad |
|---|---|---|---|---|
| 1 | Abrir PDF (input + drag&drop) | Conservada | `engine.open` | abre y renderiza |
| 2 | Crear PDF en blanco | Conservada | `FPDF_CreateNewDocument` + `FPDFPage_New` | crea 1 página |
| 3 | Insertar/fusionar otro PDF | Mejorada | `FPDF_ImportPages` | inserta N páginas en posición |
| 4 | Importar Word .docx → PDF | Conservada | docx-preview + importador | abre sin pérdida |
| 5 | Importar imagen → PDF | Conservada | importador + `FPDFPageObj` imagen | imagen incrustada |
| 6 | Visor continuo | Mejorada | render por página visible | páginas visibles pintan |
| 7 | Zoom (in/out, %) | Conservada | `PageGeometry` + render por escala | zoom cambia tamaño |
| 8 | Ajuste al ancho | Mejorada | `PageGeometry` | ajusta al abrir (móvil incl.) |
| 9 | Navegación por página | Conservada | modelo + observer | salta a página |
| 10 | Miniaturas laterales | Conservada | render a escala baja | miniatura por página |
| 11 | Reordenar por drag&drop | Conservada | comando `ReorderPages` | orden persiste al guardar |
| 12 | Editar texto in-place | **Mejorada** (vectorial, fiel) | `EditTextRun` + PDFium (edición en sitio) | editado extraíble; original eliminado; **fuente/tamaño/color/posición idénticos** (§4.1) |
| 13 | Cuadros de texto nuevos | Mejorada | `AddTextObject` | texto nuevo extraíble |
| 14 | Mover/eliminar bloque de texto | Mejorada | `MoveObject`/`DeleteObject` | posición/ausencia en el PDF |
| 15 | Panel de propiedades (fuente/tamaño/color) | Conservada | comando sobre objeto seleccionado | cambia el objeto en edición |
| 16 | Lápiz / resaltador / rectángulo | Conservada | anotaciones o trazos de página | trazo llega al PDF |
| 17 | Borrador | Conservada | `DeleteObject` | quita el trazo |
| 18 | Selector de color (muestras + custom) | Conservada | estado de herramienta | color aplicado |
| 19 | Firma: pad de dibujo | Conservada | imagen → objeto de página | sello incrustado |
| 20 | Firma: subir imagen (quita fondo) | Conservada | transcode + objeto imagen | fondo transparente |
| 21 | Sello interactivo (mover/redimensionar/borrar) | Conservada | objeto + comandos | geometría final correcta |
| 22 | Rotar página (horaria/antihoraria) | **Mejorada** (arregla #7) | rotación en `PageGeometry` + `FPDFPage_SetRotation` | E-012 + anotación bien ubicada tras rotar |
| 23 | Duplicar página | Conservada | `FPDF_ImportPages` | E-007 verde |
| 24 | Eliminar página | Conservada | `FPDFPage_Delete` | página fuera |
| 25 | Filtros (Magic Color / B&N / grises) | Conservada | render + objeto imagen | filtro en el PDF (E-008) |
| 26 | OCR escaneado → texto vivo | Conservada | Tesseract + `EditTextRun` | líneas OCR editables |
| 27 | OCR modal: copiar / .txt | Conservada | extracción | copia y descarga |
| 28 | Exportar/descargar PDF | **Mejorada** (vectorial) | `engine.save` | exportar dos veces = igual (E-005) |
| 29 | Comprimir | Conservada | re-guardado / recompresión | reduce peso sin romper |
| 30 | Dividir por rango | Conservada | `FPDF_ImportPages` a doc nuevo | extrae páginas pedidas |
| 31 | PDF → Markdown | Conservada | extracción con posiciones | md coherente |
| 32 | Markdown → PDF | Conservada | KaTeX/marked + importador | compila y abre |
| 33 | Deshacer/rehacer global | **Mejorada** | CommandBus | E-011 verde + agrupación |
| 34 | Atajos de teclado | Conservada | herramientas | E-017 verde |
| 35 | Cajones móviles / responsive | Conservada | UI | E-015/E-016/E-025/E-026 verdes |
| 36 | Impresión | Conservada | `window.print` | diálogo abre |
| 37 | **Redactar (censura real)** | **Nueva/Mejorada** | `ApplyRedaction` (elimina objetos) | texto bajo la marca no se extrae (cierra E-024) |

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
