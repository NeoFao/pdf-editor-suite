# Cimientos · Rebanada vertical — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (ejecución nativa elegida) para implementar tarea por tarea. Los pasos usan checkbox (`- [ ]`).

**Goal:** Construir los cimientos (motor PDFium tras una interfaz, modelo de documento, coordenadas tipadas, comandos y visor mínimo) y demostrarlos editando una línea de texto de forma **fiel** —solo cambia el texto— y guardándola como PDF vectorial.

**Architecture:** App nueva en `src/` (Vite + TypeScript), en paralelo a la app actual (`index.html` + `js/`), que queda intacta hasta el cutover. La UI habla con un puerto `PdfEngine`; lo implementa `PdfiumEngine` sobre `@embedpdf/pdfium`. Estado en un `DocumentModel`; acciones como `Command` con do/undo; coordenadas solo en `PageGeometry`.

**Tech Stack:** Vite 5, TypeScript 5 (strict), `@embedpdf/pdfium` (MIT/BSD, WASM), Vitest (unitarios de `src/`), Playwright (E2E, ya presente). ESLint con typescript-eslint.

**Spec:** `docs/superpowers/specs/2026-09-25-cimientos-motor-pdfium-design.md`

## Global Constraints

- Motor: solo `@embedpdf/pdfium` (MIT/BSD). Prohibido MuPDF/AGPL o motores de pago.
- Sin backend: `vite build` produce estáticos; Vercel los sirve. Ningún PDF sale del equipo.
- **No** tocar la CSP, las cabeceras de seguridad ni la parte de headers de `vercel.json` sin permiso explícito del dueño (AGENTS.md §5). Este plan **no** los toca.
- **Fidelidad (§4.1 del spec):** editar SIEMPRE el objeto de texto existente en sitio con `FPDFText_SetText`; conservar fuente, tamaño, color y matriz. NUNCA crear un objeto con fuente por defecto para una edición. NUNCA rasterizar para editar.
- La app actual (`index.html`, `js/`, `css/`, `server.js`) permanece intacta y desplegada. El código nuevo vive en `src/`. `npm run verify` (el actual) debe seguir verde en cada PR.
- Ramas + PR (nunca push directo a `main`). Commits conventional. Sin líneas de atribución de IA (AGENTS.md §4).
- TypeScript en modo `strict`. Sin `any` salvo en fronteras del WASM, encapsulado en `engine/pdfium/`.

## Review Focus

Entradas/fallos que el spec implica y que la ruta feliz no ejercita; cada uno se fija en la tarea indicada:

1. **Texto editado más largo que el original** → la línea editada no debe solaparse con la vecina ni desbordar la página. (Task 5, test `editar-texto-mas-largo-no-pisa-vecina`.)
2. **PDF escaneado sin capa de texto** → `getPageText` devuelve `[]` y la UI no rompe (queda la vía OCR posterior). (Task 4, test `pagina-sin-texto-devuelve-vacio`.)
3. **Glifo ausente en la fuente incrustada** al teclear un carácter que la fuente no tiene → se detecta y se informa; no se sustituye la fuente en silencio. (Task 5, test `glifo-ausente-se-detecta`.)
4. **Guardar dos veces** → resultado idéntico; no se duplican ediciones. (Task 11, test `guardar-dos-veces-es-idempotente`.)
5. **Documento de muchas páginas** → solo se renderizan las visibles; no se instancia un canvas por página. (Task 9, test `solo-renderiza-paginas-visibles`.)

---

## Estructura de ficheros

```
src/
  engine/
    PdfEngine.ts          # interfaz (puerto) + tipos de datos (TextRun, PageInfo…)
    pdfium/
      loadEngine.ts       # inicializa el WASM una vez; expone el módulo tipado
      PdfiumEngine.ts     # implementa PdfEngine con @embedpdf/pdfium
      mem.ts              # helpers de memoria (malloc/copia/lectura de out-params)
  coords/
    units.ts              # tipos branded Pt/CssPx/DevicePx + constructores
    PageGeometry.ts       # conversiones (incl. Y-flip y rotación), única autoridad
  model/
    DocumentModel.ts      # estado observable (páginas, selección) + emisor de eventos
    types.ts              # PageModel, Selection…
  commands/
    Command.ts            # interfaz Command + CommandBus (undo/redo, coalescing)
    EditTextRun.ts        # comando de edición fiel de una línea
  ui/
    Viewer.ts             # render de páginas visibles, zoom, navegación
    TextLayer.ts          # capa de bloques editables + herramienta de edición
    App.ts                # cablea engine+model+bus+ui
  main.ts                 # punto de entrada (monta App en #app)
index.next.html           # página de arranque de la app nueva (Vite)
vite.config.ts
tsconfig.json
vitest.config.ts
tests/
  unit/                   # Vitest: engine, coords, model, commands
  e2e/
    next/                 # Playwright: paridad y fidelidad de la app nueva
      edicion-fiel.spec.ts
tests/fixtures/generar-fixtures.mjs   # (existente) se amplía con un PDF de fuentes conocidas
```

Ficheros existentes que se **modifican** (sin romper la app actual):
- `package.json` — nuevos devDeps y scripts `dev:next`, `build:next`, `preview:next`, `typecheck`, `test:unit:src`. No se alteran los scripts actuales.
- `eslint.config.mjs` — añadir bloque para `src/**/*.ts` con typescript-eslint; el resto igual.
- `playwright.config.js` — añadir proyecto `next` con su `webServer` (vite preview) y `testMatch` a `tests/e2e/next/`.
- `tests/fixtures/generar-fixtures.mjs` — añadir `fuentes.pdf` (Times-Roman/Helvetica, tamaños y colores conocidos) para los tests de fidelidad.
- `.gitignore` — añadir `dist-next/` y `node_modules` (ya está).

---

### Task 1: Andamiaje Vite + TypeScript en paralelo (no rompe la app actual)

**Files:**
- Create: `vite.config.ts`, `tsconfig.json`, `index.next.html`, `src/main.ts`
- Modify: `package.json` (devDeps + scripts), `eslint.config.mjs`
- Test: arranque manual + `npm run verify` (actual) sigue verde

**Interfaces:**
- Produces: `npm run dev:next` (servidor Vite), `npm run build:next` (estáticos en `dist-next/`), `npm run typecheck`.

- [ ] **Step 1: Instalar devDeps** (justificadas: build y tipos de la app nueva)

```bash
npm install -D vite@^5 typescript@^5 @embedpdf/pdfium@^2.15.1 vitest@^2 typescript-eslint@^8 @types/node
```

- [ ] **Step 2: `tsconfig.json`** (strict)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src", "tests/unit"]
}
```

- [ ] **Step 3: `vite.config.ts`** (raíz = repo; entrada = index.next.html; salida dist-next)

```ts
import { defineConfig } from 'vite';
export default defineConfig({
  build: { outDir: 'dist-next', rollupOptions: { input: 'index.next.html' } },
  server: { port: 5173 },
  // El .wasm de @embedpdf/pdfium se sirve como asset; se importa con ?url en loadEngine.ts
  assetsInclude: ['**/*.wasm'],
});
```

- [ ] **Step 4: `index.next.html` + `src/main.ts`** (arranque mínimo visible)

```html
<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>PDF Editor (nueva base)</title></head>
<body><div id="app">Cargando motor…</div><script type="module" src="/src/main.ts"></script></body></html>
```

```ts
// src/main.ts
const el = document.getElementById('app')!;
el.textContent = 'Base nueva lista (Vite + TS).';
```

- [ ] **Step 5: Scripts en `package.json`** (añadir, sin tocar los existentes)

```json
"dev:next": "vite",
"build:next": "vite build",
"preview:next": "vite preview --port 4173",
"typecheck": "tsc --noEmit",
"test:unit:src": "vitest run"
```

- [ ] **Step 6: ESLint para TS** — en `eslint.config.mjs`, añadir al array exportado:

```js
import tseslint from 'typescript-eslint';
// …dentro del array de config, tras las reglas actuales:
...tseslint.configs.recommended.map(c => ({ ...c, files: ['src/**/*.ts', 'tests/unit/**/*.ts'] })),
```

- [ ] **Step 7: Verificar que nada se rompió**

Run: `npm run typecheck && npm run dev:next` (abrir http://localhost:5173/index.next.html → muestra el texto) y `npm run verify`
Expected: typecheck OK; página muestra "Base nueva lista"; `verify` (app actual) sigue en verde.

- [ ] **Step 8: Commit**

```bash
git add vite.config.ts tsconfig.json index.next.html src/main.ts package.json package-lock.json eslint.config.mjs
git commit -m "build: andamiaje Vite + TypeScript en paralelo a la app actual"
```

---

### Task 2: Cargar el motor WASM una vez

**Files:**
- Create: `src/engine/pdfium/loadEngine.ts`, `src/engine/pdfium/mem.ts`
- Test: `tests/unit/loadEngine.test.ts`

**Interfaces:**
- Produces: `loadEngine(): Promise<Pdfium>` donde `Pdfium = Awaited<ReturnType<typeof init>>`; se inicializa `FPDF_InitLibrary()` una sola vez (memoizado). `mem.ts` exporta `makeMem(p: Pdfium)` → `{ copyIn(bytes): ptr, wide(str): ptr, readU16(ptr): string, readFloat(ptr): number, malloc, free, HEAPU8, setValue, getValue, UTF8ToString, addFunction }`.

- [ ] **Step 1: Test de arranque**

```ts
// tests/unit/loadEngine.test.ts
import { test, expect } from 'vitest';
import { loadEngine } from '../../src/engine/pdfium/loadEngine';
test('el motor arranca y expone FPDF', async () => {
  const p = await loadEngine();
  expect(typeof p.FPDF_GetPageCount).toBe('function');
});
```

- [ ] **Step 2: Ejecutar y ver fallar** — `npm run test:unit:src` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `loadEngine.ts`** (memoizado; wasm por ?url)

```ts
import { init } from '@embedpdf/pdfium';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';

export type Pdfium = Awaited<ReturnType<typeof init>>;
let cached: Promise<Pdfium> | null = null;

export function loadEngine(): Promise<Pdfium> {
  if (cached) return cached;
  cached = (async () => {
    const wasmBinary = new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
    const p = await init({ wasmBinary });
    p.FPDF_InitLibrary();
    return p;
  })();
  return cached;
}
```

- [ ] **Step 4: Implementar `mem.ts`** (helpers de memoria emscripten — validados en spike)

```ts
import type { Pdfium } from './loadEngine';
export function makeMem(p: Pdfium) {
  const m = (p as any).pdfium;
  return {
    HEAPU8: m.HEAPU8 as Uint8Array,
    malloc: (n: number): number => m._malloc(n),
    free: (ptr: number): void => m._free(ptr),
    setValue: (ptr: number, v: number, t: string): void => m.setValue(ptr, v, t),
    getValue: (ptr: number, t: string): number => m.getValue(ptr, t),
    UTF8ToString: (ptr: number): string => m.UTF8ToString(ptr),
    addFunction: (fn: (...a: number[]) => number, sig: string): number => m.addFunction(fn, sig),
    copyIn(bytes: Uint8Array): number { const ptr = m._malloc(bytes.length); m.HEAPU8.set(bytes, ptr); return ptr; },
    wide(s: string): number {
      const b = new Uint8Array((s.length + 1) * 2);
      for (let i = 0; i < s.length; i++) { b[i*2] = s.charCodeAt(i) & 0xff; b[i*2+1] = s.charCodeAt(i) >> 8; }
      const ptr = m._malloc(b.length); m.HEAPU8.set(b, ptr); return ptr;
    },
    readU16(ptr: number): string { return m.UTF16ToString(ptr); },
  };
}
```

- [ ] **Step 5: Ejecutar y ver pasar** — `npm run test:unit:src` → PASS. (Vitest usa entorno node; `fetch` de un file URL: usar `environment: 'node'` y en el test de arranque cargar el wasm por fs si `fetch` de `?url` no resuelve en node — ver vitest.config abajo.)

- [ ] **Step 6: `vitest.config.ts`** — resolver `?url` a ruta de fichero en node:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node' } });
```

Nota de implementación: en node, `import '...pdfium.wasm?url'` con Vitest devuelve una ruta; `loadEngine` hace `fetch(wasmUrl)`. Si `fetch` de ruta local falla en el runner, `loadEngine` cae a `fs.readFile` cuando `typeof window === 'undefined'`. Añadir esa rama en el Step 3.

- [ ] **Step 7: Commit**

```bash
git add src/engine/pdfium/loadEngine.ts src/engine/pdfium/mem.ts tests/unit/loadEngine.test.ts vitest.config.ts
git commit -m "feat(engine): carga memoizada del WASM de PDFium con helpers de memoria"
```

---

### Task 3: Puerto `PdfEngine` + abrir/contar/tamaño/guardar

**Files:**
- Create: `src/engine/PdfEngine.ts`, `src/engine/pdfium/PdfiumEngine.ts`
- Test: `tests/unit/PdfiumEngine.roundtrip.test.ts`

**Interfaces:**
- Produces:
```ts
export interface SizePt { widthPt: number; heightPt: number }
export interface PdfEngine {
  open(bytes: Uint8Array): Promise<DocHandle>;
  pageCount(doc: DocHandle): number;
  pageSize(doc: DocHandle, pageIndex: number): SizePt;
  getPageText(doc: DocHandle, pageIndex: number): TextRun[];   // Task 4
  editTextRun(doc: DocHandle, pageIndex: number, runId: number, newText: string): EditResult; // Task 5
  save(doc: DocHandle): Uint8Array;
  close(doc: DocHandle): void;
}
export type DocHandle = number;  // puntero PDFium
```

- [ ] **Step 1: Test de round-trip** (abrir un PDF hecho con pdf-lib, contar, guardar, reabrir)

```ts
import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function pdfDe(texto: string) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.TimesRoman);
  const p = d.addPage([320, 200]);
  p.drawText(texto, { x: 40, y: 150, size: 18, font: f, color: rgb(0.85,0.1,0.1) });
  return d.save();
}
test('abre, cuenta, mide y guarda un PDF válido', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await pdfDe('HOLA'));
  expect(eng.pageCount(doc)).toBe(1);
  const s = eng.pageSize(doc, 0);
  expect(Math.round(s.widthPt)).toBe(320);
  const out = eng.save(doc);
  expect(new TextDecoder().decode(out.subarray(0,5))).toBe('%PDF-');
  eng.close(doc);
});
```

- [ ] **Step 2: Ejecutar y ver fallar.**

- [ ] **Step 3: Implementar `PdfiumEngine` (open/count/size/save/close).** `save` usa el patrón WriteBlock del spike (`FPDF_SaveAsCopy` + `addFunction('iiii')`). `pageSize` usa `FPDF_GetPageSizeByIndexF` (out struct de 2 floats) o carga la página y `FPDF_GetPageWidthF/HeightF`. Código base (validado en spike) en `scratchpad/engine-spike/spike.mjs`; portar a TS con `makeMem`.

- [ ] **Step 4: Ejecutar y ver pasar.**

- [ ] **Step 5: Commit** `feat(engine): PdfiumEngine abre, mide y guarda (round-trip)`.

---

### Task 4: Extraer texto con posiciones → `TextRun[]`

**Files:** Modify `PdfiumEngine.ts`; Create test `tests/unit/PdfiumEngine.text.test.ts`

**Interfaces:**
- Produces:
```ts
export interface RectPt { xPt: number; yPt: number; wPt: number; hPt: number }
export interface TextRun { runId: number; text: string; boxPt: RectPt; fontName: string; sizePt: number; color: [number,number,number,number] }
```
`runId` = índice del objeto de texto en la página (`FPDFPage_GetObject`). `getPageText` recorre objetos, filtra tipo texto (`FPDFPageObj_GetType===1`), y para cada uno lee texto, fuente, tamaño, color y caja (`FPDFPageObj_GetBounds`).

- [ ] **Step 1: Test feliz** — el PDF de 'HOLA' Times-18-rojo devuelve un run con `fontName` "Times-Roman", `sizePt` 18, color rojo, y `text` "HOLA".
- [ ] **Step 2 (Review Focus #2): Test `pagina-sin-texto-devuelve-vacio`** — un PDF de solo un rectángulo (sin texto) → `getPageText` devuelve `[]` sin lanzar.
- [ ] **Step 3: Ver fallar.**
- [ ] **Step 4: Implementar** (lecturas validadas en `scratchpad/engine-spike/fidelidad.mjs`: `FPDFTextObj_GetText/GetFont/GetFontSize`, `FPDFFont_GetBaseFontName`, `FPDFPageObj_GetFillColor`; caja con `FPDFPageObj_GetBounds(obj,&l,&b,&r,&t)`).
- [ ] **Step 5: Ver pasar.**
- [ ] **Step 6: Commit** `feat(engine): getPageText devuelve runs con fuente, tamaño, color y caja`.

---

### Task 5: Editar una línea EN SITIO, con fidelidad (núcleo del producto)

**Files:** Modify `PdfiumEngine.ts`; Create test `tests/unit/PdfiumEngine.edit.test.ts`

**Interfaces:**
- Produces: `editTextRun(doc, pageIndex, runId, newText): EditResult` donde
```ts
export type EditResult = { ok: true } | { ok: false; reason: 'glyph-missing' | 'not-a-text-run' };
```
Modifica el objeto existente con `FPDFText_SetText(obj, wide(newText))` y `FPDFPage_GenerateContent(page)`. **No** crea objeto nuevo. Si la fuente incrustada carece de un glifo de `newText`, devuelve `{ok:false, reason:'glyph-missing'}` sin aplicar (comprobación con `FPDFFont_GetGlyphWidth`/mapa de caracteres; si no hay API fiable, comparar `FPDFText_CountChars` esperado vs. real tras un intento en copia).

- [ ] **Step 1 (fidelidad): Test `editar-conserva-fuente-tamano-color-posicion`** — editar el run y, tras `save`+reabrir, `fontName/sizePt/color/pos` idénticos y `text` nuevo. (Réplica del spike `fidelidad.mjs`.)
- [ ] **Step 2 (Review Focus #1): Test `editar-texto-mas-largo-no-pisa-vecina`** — un PDF de dos líneas; editar la primera con un texto más largo; tras reabrir, la caja de la segunda línea no se solapa verticalmente con la primera (sus rangos `yPt` no se cruzan). (Documenta el límite: no hay reflujo, pero no se pisan.)
- [ ] **Step 3 (Review Focus #3): Test `glifo-ausente-se-detecta`** — con una fuente incrustada de subconjunto limitado, editar introduciendo un carácter fuera del subconjunto → `{ok:false, reason:'glyph-missing'}` y el texto original intacto.
- [ ] **Step 4: Ver fallar los tres.**
- [ ] **Step 5: Implementar** `editTextRun` con la comprobación de glifos y la edición en sitio.
- [ ] **Step 6: Ver pasar.**
- [ ] **Step 7: Commit** `feat(engine): edición fiel de una línea en sitio (conserva fuente/tamaño/color/posición)`.

---

### Task 6: Coordenadas tipadas y `PageGeometry`

**Files:** Create `src/coords/units.ts`, `src/coords/PageGeometry.ts`; Test `tests/unit/PageGeometry.test.ts`

**Interfaces:**
- Produces:
```ts
export type Pt = number & { readonly u: 'pt' };
export type CssPx = number & { readonly u: 'css' };
export const pt = (n: number) => n as Pt; export const css = (n: number) => n as CssPx;
export class PageGeometry {
  constructor(readonly heightPt: number, readonly scale: number, readonly rotation: 0|90|180|270) {}
  ptToCssX(x: Pt): CssPx; ptToCssY(y: Pt): CssPx;   // aplica escala, Y-flip y rotación
  cssToPtX(x: CssPx): Pt;  cssToPtY(y: CssPx): Pt;
  rectPtToCss(r: RectPt): { left: CssPx; top: CssPx; width: CssPx; height: CssPx };
}
```

- [ ] **Step 1: Tests** — sin rotación: `ptToCssY(heightPt)` = 0 (origen arriba); ida y vuelta `cssToPtY(ptToCssY(y))≈y`; con `rotation=90`, un punto conocido cae donde toca (tabla de valores esperados).
- [ ] **Step 2: Ver fallar.**
- [ ] **Step 3: Implementar** las conversiones (única aritmética entre unidades; Y-flip = `heightPt - y`; rotación por casos 0/90/180/270).
- [ ] **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** `feat(coords): tipos branded y PageGeometry (única autoridad de coordenadas)`.

---

### Task 7: Modelo de documento observable

**Files:** Create `src/model/types.ts`, `src/model/DocumentModel.ts`; Test `tests/unit/DocumentModel.test.ts`

**Interfaces:**
- Produces:
```ts
export interface PageModel { index: number; sizePt: SizePt; rotation: 0|90|180|270; runs: TextRun[] }
export class DocumentModel {
  readonly pages: PageModel[];
  selection: { pageIndex: number; runId: number } | null;
  on(ev: 'change', cb: (pageIndex: number) => void): () => void;  // devuelve desuscriptor
  updateRunText(pageIndex: number, runId: number, text: string): void;  // actualiza proyección + emite 'change'
}
```

- [ ] **Step 1: Test** — `updateRunText` cambia el run y notifica con el `pageIndex` correcto; el desuscriptor detiene las notificaciones.
- [ ] **Step 2: Ver fallar. Step 3: Implementar (emisor simple). Step 4: Ver pasar.**
- [ ] **Step 5: Commit** `feat(model): DocumentModel observable con proyección de runs`.

---

### Task 8: Comandos y `CommandBus`

**Files:** Create `src/commands/Command.ts`, `src/commands/EditTextRun.ts`; Test `tests/unit/EditTextRun.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Ctx { engine: PdfEngine; model: DocumentModel; doc: DocHandle }
export interface Command { id: string; label: string; coalesceKey?: string; execute(c: Ctx): void; undo(c: Ctx): void }
export class CommandBus {
  constructor(private ctx: Ctx) {}
  execute(cmd: Command): void; undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean;
}
export class EditTextRunCmd implements Command { constructor(pageIndex:number, runId:number, newText:string, oldText:string){} /* … */ }
```
`EditTextRunCmd.execute` llama a `engine.editTextRun` y `model.updateRunText`; `undo` restaura `oldText` por la misma vía. `CommandBus.execute` con `coalesceKey` fusiona con el comando previo si comparten clave (tecleo → un solo paso de deshacer).

- [ ] **Step 1: Test** — ejecutar dos `EditTextRunCmd` con el mismo `coalesceKey` deja UN paso de deshacer; `undo` restaura el texto original en modelo y motor; `redo` lo reaplica.
- [ ] **Step 2: Ver fallar. Step 3: Implementar. Step 4: Ver pasar** (usa un `PdfEngine` real sobre un PDF de prueba).
- [ ] **Step 5: Commit** `feat(commands): CommandBus con deshacer/rehacer y EditTextRun con coalescing`.

---

### Task 9: Visor — render de páginas visibles

**Files:** Create `src/ui/Viewer.ts`; Modify `src/ui/App.ts`, `src/main.ts`; Test `tests/unit/Viewer.visible.test.ts`

**Interfaces:**
- Produces: `class Viewer { constructor(root: HTMLElement, engine, doc, geomFor) ; renderVisible(): void ; setZoom(z:number): void }`. Render con `FPDF_RenderPageBitmap` → `ImageData` → `<canvas>`. Solo páginas intersecando el viewport (IntersectionObserver); las no visibles no instancian canvas de contenido.

- [ ] **Step 1 (Review Focus #5): Test `solo-renderiza-paginas-visibles`** — con un doc de 20 páginas en un viewport que muestra ~2, el nº de canvas con bitmap dibujado ≤ 4. (Test de unidad sobre la lógica de "qué páginas render", inyectando un stub de visibilidad; el render real se prueba en E2E.)
- [ ] **Step 2: Ver fallar. Step 3: Implementar. Step 4: Ver pasar.**
- [ ] **Step 5: Commit** `feat(ui): visor que solo renderiza páginas visibles`.

---

### Task 10: Capa de texto y herramienta de edición

**Files:** Create `src/ui/TextLayer.ts`; Modify `src/ui/App.ts`; (sin test unitario nuevo — se cubre en E2E Task 12)

**Interfaces:**
- Produces: `class TextLayer { constructor(pageEl, page: PageModel, geom: PageGeometry, bus: CommandBus) }`. Dibuja un bloque posicionado por `geom.rectPtToCss(run.boxPt)` por cada run; clic → `contenteditable`; al confirmar (blur/Enter) despacha `EditTextRunCmd`. El bloque hereda tamaño/familia aproximada solo para la vista; la fidelidad real la garantiza el motor al guardar (Task 5).

- [ ] **Step 1: Implementar** el bloque y el gesto (sigue el patrón del `createTextBlockElement` actual, pero con `textContent`, nunca `innerHTML` interpolado — regla `no-innerhtml-interpolado`).
- [ ] **Step 2: Cablear en `App.ts`** engine+model+bus+viewer+textlayer; `main.ts` monta `App` y carga un PDF de `fetch` de ejemplo o input de fichero.
- [ ] **Step 3: Verificación manual** `npm run dev:next`, abrir un PDF, editar una línea, ver el cambio.
- [ ] **Step 4: Commit** `feat(ui): capa de texto editable que despacha comandos`.

---

### Task 11: Guardar/descargar + idempotencia

**Files:** Modify `src/ui/App.ts` (botón guardar); Test `tests/unit/save.idempotente.test.ts`

- [ ] **Step 1 (Review Focus #4): Test `guardar-dos-veces-es-idempotente`** — abrir, editar una línea, `save`→A, `save`→B; reabrir A y B: mismo texto en ambos, y el run editado aparece **una** vez (no duplicado). (Comparar `getPageText` de A y B.)
- [ ] **Step 2: Ver fallar/implementar** — `save` no debe mutar el estado de forma que una segunda llamada re-aplique; si `FPDF_SaveAsCopy` sobre el mismo doc ya es idempotente, el test lo confirma; si no, `save` opera sobre una copia.
- [ ] **Step 3: Botón descargar** en la UI (Blob + `<a download>`).
- [ ] **Step 4: Ver pasar. Step 5: Commit** `feat: guardar/descargar PDF vectorial (idempotente)`.

---

### Task 12: E2E de paridad y fidelidad + CI

**Files:** Create `tests/e2e/next/edicion-fiel.spec.ts`; Modify `playwright.config.js`, `tests/fixtures/generar-fixtures.mjs`, `package.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: la app nueva servida por `vite preview` (build a `dist-next/`).

- [ ] **Step 1: Fixture `fuentes.pdf`** — añadir a `generar-fixtures.mjs` un PDF con líneas Times-Roman 18 roja y Helvetica 12 negra en posiciones conocidas.
- [ ] **Step 2: Proyecto Playwright `next`** — en `playwright.config.js`, añadir `{ name: 'next', testMatch: /e2e\/next\//, use: { baseURL: 'http://127.0.0.1:4173' } }` y un segundo `webServer` (`vite build && vite preview --port 4173`). Mantener los proyectos actuales intactos.
- [ ] **Step 3: Test E2E `edicion-fiel`** — abrir `fuentes.pdf`, editar la línea Times a "TEXTO NUEVO", descargar, y con pdf.js/PDFium en el test extraer del PDF descargado: (a) "TEXTO NUEVO" presente y seleccionable, (b) el texto original ausente, (c) la caja/família/tamaño de esa línea = Times-Roman 18 (leído del propio PDF), (d) la línea Helvetica intacta.
- [ ] **Step 4: Ver fallar (app aún incompleta) → completar cableado hasta pasar.**
- [ ] **Step 5: CI** — en `ci.yml`, añadir al job `e2e` (o uno nuevo `e2e-next`) los pasos `npm run build:next` y `npx playwright test --project=next`, y un job `typecheck`/`test:unit:src`. No se elimina ni ablanda ningún check actual.
- [ ] **Step 6: `npm run verify` + nuevos checks en verde. Commit** `test(e2e): edición fiel de punta a punta en la app nueva + CI`.

---

## Notas de cierre

- **Cutover:** fuera de este plan. Ocurre cuando la tabla de migración del spec (§9) esté entera en verde, en su propio PR, con el dueño decidiendo el cambio de `index.html`.
- **Reglas deterministas nuevas** (`ui-no-usa-FPDF-directo`, `coords-solo-en-PageGeometry`): se añaden cuando la estructura `src/` esté asentada (tras Task 8), cada una con su test, en el PR correspondiente. No se añaden en Task 1 para no disparar sobre andamiaje aún incompleto.
- **CSP/headers:** ninguna tarea los toca. El día del cutover se revisará con el dueño si conviene retirar `'unsafe-eval'` (ya innecesario sin pdf.js) — decisión suya (AGENTS.md §5).
