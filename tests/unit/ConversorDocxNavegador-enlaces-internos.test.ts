import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { agruparAdvertencias } from '../../src/convert/advertencia';

/**
 * Enlaces internos de Word con el motor REAL: `word-enlaces-internos.docx` (ver `generar-fixtures.mjs`): la página 1 trae un enlace a
 * `conclusion` (que cae en la 6.ª línea de la página 3, borde superior de la línea en y = 660 pt) y otro a un marcador inexistente.
 * Los valores son copia deliberada del generador (ese módulo ejecuta `main()` al importarlo).
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DEST = { pagina: 3, yPt: 660, lineaPt: 12 };

test('word-enlaces-internos.docx: la anotación /Link de la página 1 lleva a la página 3, a la altura de la línea del marcador', async () => {
  const engine = await PdfiumEngine.create();
  const nombre = 'word-enlaces-internos.docx';
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(AQUI, '../fixtures/generados', nombre)));
  const { pdf, advertencias } = await new ConversorDocxNavegador(engine).convertir(nombre, bytes);
  const doc = await engine.open(pdf);
  expect(engine.pageCount(doc)).toBe(3);

  const enlaces = engine.getLinks(doc, 0);
  expect(enlaces).toHaveLength(1); // el enlace al marcador inexistente NO crea anotación
  const d = enlaces[0]!.destino;
  expect(d.tipo).toBe('pagina');
  if (d.tipo !== 'pagina') throw new Error('destino no interno');
  expect(d.pageIndex).toBe(DEST.pagina - 1);
  expect(Math.abs(d.yPt! - DEST.yPt)).toBeLessThanOrEqual(DEST.lineaPt);
  // La caja del enlace cubre el texto "Ir a la conclusion" de la primera línea de la página 1.
  const caja = enlaces[0]!.rectPt;
  expect(caja.xPt).toBeCloseTo(72, 0);
  expect(caja.yPt + caja.hPt).toBeGreaterThan(720 - 12);

  // Las otras páginas no traen enlaces; el roto avisa como omitido y no como aproximado.
  expect(engine.getLinks(doc, 1)).toEqual([]);
  const { omitidas, aproximadas } = agruparAdvertencias(advertencias);
  expect(omitidas.map((a) => a.mensaje).join(' | ')).toMatch(/sin destino/i);
  expect(aproximadas.map((a) => a.mensaje).join(' | ')).not.toMatch(/enlace/i);
  engine.close(doc);
});

test('sobrevive a guardar y reabrir: el destino sigue siendo la página 3 a la misma altura', async () => {
  const engine = await PdfiumEngine.create();
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(AQUI, '../fixtures/generados/word-enlaces-internos.docx')));
  const { pdf } = await new ConversorDocxNavegador(engine).convertir('x.docx', bytes);
  const doc2 = await engine.open(engine.save(await engine.open(pdf)));
  const d = engine.getLinks(doc2, 0)[0]!.destino;
  expect(d).toEqual({ tipo: 'pagina', pageIndex: 2, yPt: expect.closeTo(DEST.yPt, 0) });
  engine.close(doc2);
});
