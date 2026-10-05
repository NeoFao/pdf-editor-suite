import { test, expect, vi } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import type { Pdfium } from '../../src/engine/pdfium/loadEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { AnadirEncabezadoMarcaCmd, QuitarEncabezadosMarcasCmd, type OpcionesEncabezado, type OpcionesMarcaAgua } from '../../src/commands/EncabezadoMarcaAgua';

async function docNPaginas(n: number, rotadas: Record<number, 90 | 180 | 270> = {}): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const p = d.addPage([300, 200]);
    if (rotadas[i]) p.setRotation(degrees(rotadas[i]!));
  }
  return d.save();
}

const ENC: OpcionesEncabezado = {
  cajas: [{ zona: 'abajo', alineacion: 'centro', texto: 'Página <<n>> de <<total>>' }],
  numeroInicial: 1, paginas: [0, 1, 2, 3, 4], fuente: 'Helvetica', sizePt: 10, colorHex: '#000000',
  margenHorizPt: 36, margenVertPt: 20, fecha: new Date(2026, 8, 30)
};
const MARCA: OpcionesMarcaAgua = {
  texto: 'CONFIDENCIAL', paginas: [0, 1, 2, 3, 4], fuente: 'Helvetica-Bold', sizePt: 40, colorHex: '#ff0000',
  opacidad: 0.5, anguloGrados: 45, detras: false
};

test('numeración: la página 3 de 5 contiene exactamente "Página 3 de 5" (texto real extraíble)', async () => {
  const eng = await PdfiumEngine.create();
  const s = await EditSession.open(eng, await docNPaginas(5));
  const bus = new CommandBus(s);
  await bus.execute(new AnadirEncabezadoMarcaCmd({ encabezado: ENC }));
  expect(eng.getPageText(s.doc, 2).map((r) => r.text)).toEqual(['Página 3 de 5']);
  expect(eng.getPageText(s.doc, 4).map((r) => r.text)).toEqual(['Página 5 de 5']);
});

test('número inicial y rango: solo las páginas del rango, numeradas desde el inicial', async () => {
  const eng = await PdfiumEngine.create();
  const s = await EditSession.open(eng, await docNPaginas(5));
  await new CommandBus(s).execute(new AnadirEncabezadoMarcaCmd({ encabezado: { ...ENC, numeroInicial: 10, paginas: [1, 2] } }));
  expect(eng.getPageText(s.doc, 0)).toHaveLength(0);
  expect(eng.getPageText(s.doc, 1).map((r) => r.text)).toEqual(['Página 10 de 5']);
  expect(eng.getPageText(s.doc, 2).map((r) => r.text)).toEqual(['Página 11 de 5']);
});

test('un solo paso de deshacer revierte todas las páginas; rehacer las vuelve a poner', async () => {
  const eng = await PdfiumEngine.create();
  const s = await EditSession.open(eng, await docNPaginas(5));
  const bus = new CommandBus(s);
  await bus.execute(new AnadirEncabezadoMarcaCmd({ encabezado: ENC }));
  await bus.undo();
  for (let i = 0; i < 5; i++) expect(eng.getPageText(s.doc, i)).toHaveLength(0);
  await bus.redo();
  expect(eng.getPageText(s.doc, 3).map((r) => r.text)).toEqual(['Página 4 de 5']);
});

test('E-037: un solo GenerateContent por página (lote), no uno por caja', async () => {
  const eng = await PdfiumEngine.create();
  const s = await EditSession.open(eng, await docNPaginas(3));
  const cajas = (['arriba', 'abajo'] as const).flatMap((zona) => (['izq', 'centro', 'der'] as const).map((alineacion) => ({ zona, alineacion, texto: 'x <<n>>' })));
  const p = (eng as unknown as { p: Pdfium }).p;
  const spy = vi.spyOn(p, 'FPDFPage_GenerateContent');
  await new CommandBus(s).execute(new AnadirEncabezadoMarcaCmd({ encabezado: { ...ENC, cajas, paginas: [0, 1, 2] } }));
  expect(spy).toHaveBeenCalledTimes(3); // 6 cajas x 3 páginas -> 3 llamadas
  spy.mockRestore();
  expect(eng.getPageText(s.doc, 1)).toHaveLength(6);
});

test('cede el hilo e informa del progreso en documentos grandes', async () => {
  const eng = await PdfiumEngine.create();
  const s = await EditSession.open(eng, await docNPaginas(25));
  const visto: number[] = [];
  await new CommandBus(s).execute(new AnadirEncabezadoMarcaCmd(
    { encabezado: { ...ENC, paginas: Array.from({ length: 25 }, (_v, i) => i) } },
    (h) => visto.push(h)
  ));
  expect(visto).toEqual([10, 20, 25]);
});

/** Mínimo de la luminosidad roja/verde en toda la página renderizada y cuántos píxeles no son blancos. */
function medir(eng: PdfiumEngine, doc: number, i: number, scale = 1): { minG: number; noBlancos: number; bbox: { x0: number; x1: number; y0: number; y1: number } } {
  const r = eng.renderPage(doc, i, scale);
  let minG = 255, noBlancos = 0;
  const bbox = { x0: r.width, x1: 0, y0: r.height, y1: 0 };
  for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
    const k = (y * r.width + x) * 4;
    if (r.data[k + 1]! < 250) {
      noBlancos++; minG = Math.min(minG, r.data[k + 1]!);
      bbox.x0 = Math.min(bbox.x0, x); bbox.x1 = Math.max(bbox.x1, x); bbox.y0 = Math.min(bbox.y0, y); bbox.y1 = Math.max(bbox.y1, y);
    }
  }
  return { minG, noBlancos, bbox };
}

test('marca de agua con opacidad 50 %: el píxel medido es semitransparente (rojo puro al 50 % sobre blanco, G≈127)', async () => {
  const eng = await PdfiumEngine.create();
  const s = await EditSession.open(eng, await docNPaginas(1));
  await new CommandBus(s).execute(new AnadirEncabezadoMarcaCmd({ marca: { ...MARCA, paginas: [0], anguloGrados: 0, sizePt: 60 } }));
  const m = medir(eng, s.doc, 0);
  expect(m.noBlancos).toBeGreaterThan(200);
  expect(m.minG).toBeGreaterThanOrEqual(120);
  expect(m.minG).toBeLessThanOrEqual(135); // 255 * (1 - 0.5)
  // opaca (100 %) da rojo puro: G=0
  const s2 = await EditSession.open(eng, await docNPaginas(1));
  await new CommandBus(s2).execute(new AnadirEncabezadoMarcaCmd({ marca: { ...MARCA, paginas: [0], anguloGrados: 0, sizePt: 60, opacidad: 1 } }));
  expect(medir(eng, s2.doc, 0).minG).toBeLessThanOrEqual(5);
});

test('la marca queda centrada en la página (centro del bbox visible ≈ centro de la página) a 0 y 45 grados', async () => {
  const eng = await PdfiumEngine.create();
  for (const angulo of [0, 45]) {
    const s = await EditSession.open(eng, await docNPaginas(1));
    await new CommandBus(s).execute(new AnadirEncabezadoMarcaCmd({ marca: { ...MARCA, paginas: [0], anguloGrados: angulo, sizePt: 50 } }));
    const { bbox } = medir(eng, s.doc, 0);
    expect((bbox.x0 + bbox.x1) / 2).toBeGreaterThan(150 - 12);
    expect((bbox.x0 + bbox.x1) / 2).toBeLessThan(150 + 12);
    expect((bbox.y0 + bbox.y1) / 2).toBeGreaterThan(100 - 12);
    expect((bbox.y0 + bbox.y1) / 2).toBeLessThan(100 + 12);
    if (angulo === 45) expect(bbox.y1 - bbox.y0).toBeGreaterThan(80); // diagonal: alto visible grande
  }
});

test('"detrás del contenido": la marca ocupa el índice 0; delante, el último', async () => {
  const eng = await PdfiumEngine.create();
  const s = await EditSession.open(eng, await docNPaginas(1));
  eng.insertText(s.doc, 0, { xPt: 10, yPt: 10, text: 'contenido', sizePt: 12 });
  await new CommandBus(s).execute(new AnadirEncabezadoMarcaCmd({ marca: { ...MARCA, paginas: [0], detras: true } }));
  const textos = eng.getPageText(s.doc, 0);
  expect(textos.find((r) => r.text === 'CONFIDENCIAL')!.runId).toBe(0);
  expect(textos.find((r) => r.text === 'contenido')!.runId).toBe(1);

  const s2 = await EditSession.open(eng, await docNPaginas(1));
  eng.insertText(s2.doc, 0, { xPt: 10, yPt: 10, text: 'contenido', sizePt: 12 });
  await new CommandBus(s2).execute(new AnadirEncabezadoMarcaCmd({ marca: { ...MARCA, paginas: [0], detras: false } }));
  expect(eng.getPageText(s2.doc, 0).find((r) => r.text === 'CONFIDENCIAL')!.runId).toBe(1);
});

test('detrás: el contenido opaco existente tapa la marca; delante, la marca se ve sobre él', async () => {
  const eng = await PdfiumEngine.create();
  const crear = async (detras: boolean): Promise<number> => {
    const s = await EditSession.open(eng, await docNPaginas(1));
    eng.fillRect(s.doc, 0, { xPt: 0, yPt: 0, wPt: 300, hPt: 200 }, [0, 0, 255]); // página azul opaca
    await new CommandBus(s).execute(new AnadirEncabezadoMarcaCmd({ marca: { ...MARCA, paginas: [0], detras, opacidad: 1, anguloGrados: 0, sizePt: 60 } }));
    const r = eng.renderPage(s.doc, 0, 1);
    let rojos = 0;
    for (let k = 0; k < r.data.length; k += 4) if (r.data[k]! > 200 && r.data[k + 2]! < 60) rojos++;
    return rojos;
  };
  expect(await crear(true)).toBe(0);
  expect(await crear(false)).toBeGreaterThan(200);
});

test('marcado y quitar: elimina SOLO lo marcado (texto original y texto propio sin marca se conservan)', async () => {
  const eng = await PdfiumEngine.create();
  const s = await EditSession.open(eng, await docNPaginas(3));
  eng.insertText(s.doc, 1, { xPt: 10, yPt: 150, text: 'Texto del usuario', sizePt: 12 });
  const bus = new CommandBus(s);
  await bus.execute(new AnadirEncabezadoMarcaCmd({ encabezado: ENC }));
  await bus.execute(new AnadirEncabezadoMarcaCmd({ marca: { ...MARCA, paginas: [0, 1, 2] } }));
  expect(eng.getPageText(s.doc, 1).map((r) => r.text.trim()).sort()).toEqual(['CONFIDENCIAL', 'Página 2 de 3', 'Texto del usuario'].sort());

  const quitar = new QuitarEncabezadosMarcasCmd();
  await bus.execute(quitar);
  expect(quitar.quitados).toBe(6);
  expect(eng.getPageText(s.doc, 1).map((r) => r.text)).toEqual(['Texto del usuario']);
  expect(eng.getPageText(s.doc, 0)).toHaveLength(0);

  await bus.undo(); // un solo paso devuelve todo
  expect(eng.getPageText(s.doc, 1)).toHaveLength(3);
});

test('reaplicar sustituye lo anterior del mismo tipo (no se apila) y respeta el otro tipo', async () => {
  const eng = await PdfiumEngine.create();
  const s = await EditSession.open(eng, await docNPaginas(2));
  const bus = new CommandBus(s);
  await bus.execute(new AnadirEncabezadoMarcaCmd({ marca: { ...MARCA, paginas: [0, 1] } }));
  await bus.execute(new AnadirEncabezadoMarcaCmd({ encabezado: { ...ENC, paginas: [0, 1] } }));
  await bus.execute(new AnadirEncabezadoMarcaCmd({ encabezado: { ...ENC, paginas: [0, 1], numeroInicial: 7 } }));
  expect(eng.getPageText(s.doc, 0).map((r) => r.text).sort()).toEqual(['CONFIDENCIAL', 'Página 7 de 2']);
});

test('las marcas persisten tras guardar y reabrir, y se pueden quitar del documento reabierto', async () => {
  const eng = await PdfiumEngine.create();
  const s = await EditSession.open(eng, await docNPaginas(2));
  await new CommandBus(s).execute(new AnadirEncabezadoMarcaCmd({ encabezado: { ...ENC, paginas: [0, 1] } }));
  await new CommandBus(s).execute(new AnadirEncabezadoMarcaCmd({ marca: { ...MARCA, paginas: [0, 1] } }));
  const bytes = await eng.saveCompact(s.doc);
  const doc2 = await eng.open(bytes);
  expect(eng.getPageText(doc2, 1).map((r) => r.text.trim()).sort()).toEqual(['CONFIDENCIAL', 'Página 2 de 2']);
  expect(eng.removeMarkedObjects(doc2, 1, 'MarcaAgua')).toBe(1);
  expect(eng.getPageText(doc2, 1).map((r) => r.text.trim())).toEqual(['Página 2 de 2']);
  expect(eng.removeMarkedObjects(doc2, 1)).toBe(1);
  expect(eng.removeMarkedObjects(doc2, 1)).toBe(0);
  eng.close(doc2);
});

test('página con /Rotate: pie centrado abajo y marca centrada quedan en el sitio correcto de la página VISTA (90, 180, 270)', async () => {
  const eng = await PdfiumEngine.create();
  for (const rot of [90, 180, 270] as const) {
    const s = await EditSession.open(eng, await docNPaginas(1, { 0: rot }));
    const bus = new CommandBus(s);
    await bus.execute(new AnadirEncabezadoMarcaCmd({ encabezado: { ...ENC, paginas: [0], sizePt: 16 } }));
    const pie = medir(eng, s.doc, 0);
    const r = eng.renderPage(s.doc, 0, 1);
    // El pie ocupa la franja inferior VISTA, centrada en horizontal, más ancho que alto (texto derecho).
    expect((pie.bbox.x0 + pie.bbox.x1) / 2).toBeGreaterThan(r.width / 2 - 8);
    expect((pie.bbox.x0 + pie.bbox.x1) / 2).toBeLessThan(r.width / 2 + 8);
    expect(pie.bbox.y0).toBeGreaterThan(r.height - 45);
    expect(pie.bbox.x1 - pie.bbox.x0).toBeGreaterThan((pie.bbox.y1 - pie.bbox.y0) * 3);

    await bus.undo();
    await bus.execute(new AnadirEncabezadoMarcaCmd({ marca: { ...MARCA, paginas: [0], anguloGrados: 0, sizePt: 40 } }));
    const m = medir(eng, s.doc, 0);
    expect((m.bbox.x0 + m.bbox.x1) / 2).toBeGreaterThan(r.width / 2 - 10);
    expect((m.bbox.x0 + m.bbox.x1) / 2).toBeLessThan(r.width / 2 + 10);
    expect((m.bbox.y0 + m.bbox.y1) / 2).toBeGreaterThan(r.height / 2 - 10);
    expect((m.bbox.y0 + m.bbox.y1) / 2).toBeLessThan(r.height / 2 + 10);
    expect(m.bbox.x1 - m.bbox.x0).toBeGreaterThan((m.bbox.y1 - m.bbox.y0) * 3); // derecha para el lector
  }
});
