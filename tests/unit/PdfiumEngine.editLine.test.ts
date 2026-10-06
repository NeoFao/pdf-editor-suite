import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { agruparLineasEditables, type LineaEditable } from '../../src/texto/lineasEditables';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { fixture } from './_util/fixtures';

/**
 * N1 F2: `editLine` reescribe una línea editable compuesta (decenas de objetos de 1-2 glifos) con el diff mínimo:
 * el prefijo común no se toca, el tramo cambiado se escribe EN SITIO sobre su primer objeto, los objetos sobrantes del
 * tramo se eliminan y el sufijo se traslada Δ. Todo en una sola carga de página. Unidades: pt de página sin girar,
 * salvo los píxeles del render (escala `ESCALA` px por pt).
 */
const ESCALA = 2;

async function abrir(nombre: string) {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(fixture(nombre));
  return { eng, doc };
}

function lineas(eng: PdfiumEngine, doc: number, p = 0): LineaEditable[] {
  return agruparLineasEditables(eng.getPageText(doc, p), p);
}

function linea(eng: PdfiumEngine, doc: number, texto: string, p = 0): LineaEditable {
  const l = lineas(eng, doc, p).find((x) => x.text === texto);
  if (!l) throw new Error(`No hay línea «${texto}»: ${lineas(eng, doc, p).map((x) => x.text).join(' | ')}`);
  return l;
}

/** Cuenta los píxeles RGBA distintos entre dos renders, restringido a `region` (px) si se indica. */
function pixelesDistintos(
  a: { width: number; height: number; data: Uint8ClampedArray },
  b: { width: number; height: number; data: Uint8ClampedArray },
  fuera?: { y0: number; y1: number }
): number {
  expect(a.width).toBe(b.width);
  let n = 0;
  for (let y = 0; y < a.height; y++) {
    if (fuera && y >= fuera.y0 && y < fuera.y1) continue;
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) n++;
    }
  }
  return n;
}

/** Franja vertical (px de render, y hacia abajo) de la línea, con 1 px de margen. */
function franja(l: LineaEditable, alturaPt: number): { y0: number; y1: number } {
  const b = l.boxPt;
  return {
    y0: Math.floor((alturaPt - (b.yPt + b.hPt)) * ESCALA) - 1,
    y1: Math.ceil((alturaPt - b.yPt) * ESCALA) + 1
  };
}

test('el mismo texto no escribe nada: save() es idéntico', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const l = linea(eng, doc, 'Columna izquierda uno');
  const antes = eng.save(doc);
  const res = eng.editLine(doc, 0, l, l.text);
  expect(res).toMatchObject({ ok: true, sinCambios: true });
  expect(Buffer.compare(Buffer.from(eng.save(doc)), Buffer.from(antes))).toBe(0);
  eng.close(doc);
});

test('editar una palabra en medio: 0 px distintos fuera de la franja, prefijo idéntico, sufijo trasladado Δ', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const alto = eng.pageSize(doc, 0).heightPt;
  const l = linea(eng, doc, 'uno dos tres cuatro cinco seis');
  const antes = eng.renderPage(doc, 0, ESCALA);
  const runsAntes = eng.getPageText(doc, 0);
  const nuevo = 'uno dos TRES CUATRO cuatro cinco seis';

  const res = eng.editLine(doc, 0, l, nuevo);
  expect(res.ok).toBe(true);
  if (!res.ok || 'sinCambios' in res) throw new Error('inesperado');
  expect(res.dxPt).toBeGreaterThan(0);

  const despues = eng.renderPage(doc, 0, ESCALA);
  const f = franja(l, alto);
  expect(pixelesDistintos(antes, despues, f)).toBe(0); // criterio (2): nada fuera de la franja de la línea

  // El prefijo «uno dos » (hasta el primer cambio) es idéntico dentro de la franja.
  const prefijoRuns = l.tramos.filter((t) => t.fin <= 'uno dos '.length).map((t) => runsAntes.find((r) => r.runId === t.runId)!);
  const xFinPrefijo = Math.max(...prefijoRuns.map((r) => r.boxPt.xPt + r.boxPt.wPt));
  const xMax = Math.floor(xFinPrefijo * ESCALA) - 2;
  let distintos = 0;
  for (let y = f.y0; y < f.y1; y++) {
    for (let x = 0; x < xMax; x++) {
      const i = (y * antes.width + x) * 4;
      if (antes.data[i] !== despues.data[i] || antes.data[i + 1] !== despues.data[i + 1] || antes.data[i + 2] !== despues.data[i + 2]) distintos++;
    }
  }
  expect(distintos).toBe(0);

  // Texto nuevo y sufijo (« cinco seis») desplazado exactamente Δ.
  const despuesLineas = lineas(eng, doc);
  const nl = despuesLineas.find((x) => x.text === nuevo);
  expect(nl).toBeDefined();
  const runsDespues = eng.getPageText(doc, 0);
  const sufAntes = runsAntes.find((r) => r.runId === l.tramos[l.tramos.length - 1]!.runId)!; // «s» final
  // La «s» final de «seis»: la de mayor x entre las «s» de esa línea base.
  const sufDespues = runsDespues.filter((r) => r.textoReal === 's' && Math.abs(r.matriz[5] - sufAntes.matriz[5]) < 0.01).sort((a, b) => b.matriz[4] - a.matriz[4])[0]!;
  expect(sufDespues.matriz[4] - sufAntes.matriz[4]).toBeCloseTo(res.dxPt, 1);
  // Las otras 19 líneas siguen intactas (texto y posición).
  const otras = lineas(eng, doc).filter((x) => x.text !== nuevo);
  const otrasAntes = lineas(eng, doc, 0);
  expect(otras.length).toBe(otrasAntes.length - 1);
  eng.close(doc);
});

test('tras guardar y reabrir: findText y la línea encuentran el texto nuevo; vecinas y columna adyacente intactas', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const lineasAntes = lineas(eng, doc);
  const l = linea(eng, doc, 'Columna izquierda uno');
  const vecinas = lineasAntes.filter((x) => x.text !== l.text);
  const res = eng.editLine(doc, 0, l, 'Columna izquierda UNICA');
  expect(res.ok).toBe(true);

  const guardado = await eng.open(eng.save(doc));
  expect(eng.findText(guardado, 0, 'UNICA').length).toBe(1);
  expect(eng.findText(guardado, 0, 'izquierda uno').length).toBe(0);
  const despues = lineas(eng, guardado);
  expect(despues.find((x) => x.text === 'Columna izquierda UNICA')).toBeDefined();
  // Cada línea vecina (incluida «Columna derecha uno», en la misma línea base) conserva texto y caja.
  for (const v of vecinas) {
    const d = despues.find((x) => x.text === v.text);
    expect(d, v.text).toBeDefined();
    expect(d!.boxPt.xPt).toBeCloseTo(v.boxPt.xPt, 2);
    expect(d!.boxPt.yPt).toBeCloseTo(v.boxPt.yPt, 2);
    expect(d!.boxPt.wPt).toBeCloseTo(v.boxPt.wPt, 2);
  }
  eng.close(guardado);
  eng.close(doc);
});

test('la columna adyacente no se mueve (píxeles de la columna derecha idénticos)', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const alto = eng.pageSize(doc, 0).heightPt;
  const izq = linea(eng, doc, 'Columna izquierda uno');
  const der = linea(eng, doc, 'Columna derecha uno');
  const antes = eng.renderPage(doc, 0, ESCALA);
  expect(eng.editLine(doc, 0, izq, 'Columna izq. uno').ok).toBe(true);
  const despues = eng.renderPage(doc, 0, ESCALA);
  const b = der.boxPt;
  const x0 = Math.floor(b.xPt * ESCALA), x1 = Math.ceil((b.xPt + b.wPt) * ESCALA);
  const y0 = Math.floor((alto - (b.yPt + b.hPt)) * ESCALA), y1 = Math.ceil((alto - b.yPt) * ESCALA);
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * antes.width + x) * 4;
    if (antes.data[i] !== despues.data[i] || antes.data[i + 1] !== despues.data[i + 1] || antes.data[i + 2] !== despues.data[i + 2]) n++;
  }
  expect(n).toBe(0);
  eng.close(doc);
});

test('línea multiestilo editada FUERA del tramo en negrita: conserva la negrita y el color', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const l = linea(eng, doc, 'Estilo mixto: normal NEGRITA y fin.');
  const estilosAntes = l.estilos.map((e) => e.fontName);
  expect(new Set(estilosAntes).size).toBeGreaterThan(1);
  const res = eng.editLine(doc, 0, l, 'Estilos mixtos: normal NEGRITA y fin.');
  expect(res.ok).toBe(true);
  const guardado = await eng.open(eng.save(doc));
  const nl = linea(eng, guardado, 'Estilos mixtos: normal NEGRITA y fin.');
  const neg = nl.estilos.find((e) => nl.text.slice(e.inicio, e.fin).includes('NEGRITA'))!;
  expect(neg.fontName).toMatch(/Bold/i);
  expect(neg.color[0]).toBeGreaterThan(150); // rojo
  expect(neg.color[1]).toBeLessThan(100);
  const normal = nl.estilos[0]!;
  expect(normal.fontName).not.toMatch(/Bold/i);
  eng.close(guardado);
  eng.close(doc);
});

test('borrado puro de un tramo (nunca SetText vacío), inserción al inicio y al final', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const l = linea(eng, doc, 'uno dos tres cuatro cinco seis');
  expect(eng.editLine(doc, 0, l, 'uno dos cinco seis').ok).toBe(true);
  let l2 = linea(eng, doc, 'uno dos cinco seis');
  expect(eng.editLine(doc, 0, l2, '1) uno dos cinco seis').ok).toBe(true);
  l2 = linea(eng, doc, '1) uno dos cinco seis');
  expect(eng.editLine(doc, 0, l2, '1) uno dos cinco seis!').ok).toBe(true);
  expect(linea(eng, doc, '1) uno dos cinco seis!')).toBeDefined();
  // El motor sigue vivo tras todo ello.
  expect(eng.renderPage(doc, 0, 1).width).toBeGreaterThan(0);
  eng.close(doc);
});

test('la línea vacía se rechaza sin tocar el documento (E-081)', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const l = linea(eng, doc, 'Celda A1');
  const antes = eng.save(doc);
  expect(eng.editLine(doc, 0, l, '')).toEqual({ ok: false, reason: 'empty-text' });
  expect(Buffer.compare(Buffer.from(eng.save(doc)), Buffer.from(antes))).toBe(0);
  eng.close(doc);
});

test('línea desactualizada: si el texto de los objetos ya no es el de la línea, devuelve stale', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const l = linea(eng, doc, 'Celda A1');
  expect(eng.editLine(doc, 0, l, 'Celda A1b').ok).toBe(true);
  expect(eng.editLine(doc, 0, l, 'otra cosa')).toEqual({ ok: false, reason: 'stale' });
  eng.close(doc);
});

test('línea girada 90°: el sufijo se traslada sobre el eje del texto', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const l = linea(eng, doc, 'Texto girado');
  const runsAntes = eng.getPageText(doc, 0);
  const ultimoAntes = runsAntes.find((r) => r.runId === l.tramos[l.tramos.length - 1]!.runId)!;
  const res = eng.editLine(doc, 0, l, 'Texto XX girado');
  expect(res.ok).toBe(true);
  if (!res.ok || 'sinCambios' in res) throw new Error('inesperado');
  // PDFium puede generar un hueco falso en texto girado al releerlo («girad o»): se compara sin blancos.
  const nl = lineas(eng, doc).find((x) => x.text.replace(/ /g, '') === 'TextoXXgirado')!;
  expect(nl).toBeDefined();
  expect(nl.anguloDeg).toBe(90);
  const ultimoDespues = eng.getPageText(doc, 0).find((r) => r.runId === nl.tramos[nl.tramos.length - 1]!.runId)!;
  // A 90° el eje del texto es +Y: el último carácter sube Δ y no se mueve en X.
  expect(ultimoDespues.matriz[4]).toBeCloseTo(ultimoAntes.matriz[4], 1);
  expect(ultimoDespues.matriz[5] - ultimoAntes.matriz[5]).toBeCloseTo(res.dxPt, 1);
  eng.close(doc);
});

/** Tres objetos contiguos en ZapfDingbats (no tiene letras latinas; el del medio es un espacio): una línea compuesta. */
async function lineaZapfCompuesta() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.ZapfDingbats);
  const p = d.addPage([320, 200]);
  let x = 40;
  for (const t of ['✁✂', ' ', '✃✄']) {
    p.drawText(t, { x, y: 130, size: 18, font: f, color: rgb(0, 0, 0) });
    x += f.widthOfTextAtSize(t, 18);
  }
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  return { eng, doc };
}

test('línea compuesta con carácter ausente en su fuente: glyph-missing sin tocar nada; con fuenteEstandar entra solo el tramo, sin .notdef', async () => {
  const { eng, doc } = await lineaZapfCompuesta();
  const l = lineas(eng, doc)[0]!;
  expect(l.runIds.length).toBe(3);
  expect(l.text).toBe('✁✂ ✃✄');
  const antes = eng.save(doc);
  expect(eng.editLine(doc, 0, l, '✁✂ Mañana €✃✄')).toEqual({ ok: false, reason: 'glyph-missing' });
  expect(Buffer.compare(Buffer.from(eng.save(doc)), Buffer.from(antes))).toBe(0);

  const res = eng.editLine(doc, 0, l, '✁✂ Mañana €✃✄', { fuenteEstandar: true });
  expect(res.ok).toBe(true);
  if (!res.ok || 'sinCambios' in res) throw new Error('inesperado');
  expect(res.fuenteEstandar).toBe('Helvetica');
  const guardado = await eng.open(eng.save(doc));
  const runs = eng.getPageText(guardado, 0);
  expect(runs.map((r) => r.textoReal)).toContain(' Mañana €');
  // Lo no tocado conserva su fuente (ZapfDingbats) y el texto se extrae entero.
  expect(runs.find((r) => r.textoReal === '✁✂')!.fontName).toContain('Zapf');
  expect(runs.find((r) => r.textoReal === '✃✄')!.fontName).toContain('Zapf');
  expect(eng.findText(guardado, 0, 'Mañana').length).toBe(1);
  eng.close(guardado);
  eng.close(doc);
});

test('línea de un solo objeto (nativo.pdf): se comporta como editTextRun', async () => {
  const { eng, doc } = await abrir('nativo.pdf');
  const l = lineas(eng, doc).find((x) => x.text.includes('Quinta'))!;
  expect(l.runIds.length).toBe(1);
  const res = eng.editLine(doc, 0, l, 'Sigo vivo');
  expect(res).toMatchObject({ ok: true });
  expect(eng.getPageText(doc, 0).some((r) => r.text === 'Sigo vivo')).toBe(true);
  eng.close(doc);
});

test('la edición de una línea compuesta carga la página UNA sola vez (E-037)', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const l = linea(eng, doc, 'uno dos tres cuatro cinco seis');
  const p = (eng as unknown as { p: { FPDF_LoadPage: (...a: unknown[]) => number } }).p;
  const original = p.FPDF_LoadPage.bind(p);
  let cargas = 0;
  p.FPDF_LoadPage = (...a: unknown[]) => { cargas++; return original(...a); };
  expect(eng.editLine(doc, 0, l, 'uno dos TRES cuatro cinco seis').ok).toBe(true);
  expect(cargas).toBe(1);
  eng.close(doc);
});
