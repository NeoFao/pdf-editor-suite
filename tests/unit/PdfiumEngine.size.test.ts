import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { fixture } from './_util/fixtures';

/**
 * E-080: `sizePt` es el `Tf` NOMINAL (14,66) y la matriz del objeto escala 0,75 (CTM de Chrome), así que el tamaño real
 * es 11 pt. `sizeEfectivoPt` = `Tf × hypot(a, b)` es lo que ve el usuario.
 */
async function abrir(nombre: string) {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(fixture(nombre));
  return { eng, doc };
}

test('por-glifo.pdf: el cuerpo es 14,66 nominal y 11 pt efectivos; el título 29,33 y 22 pt', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const runs = eng.getPageText(doc, 0);
  const titulo = runs[0]!; // «T» de «Tabla de cifras», Helvetica-Bold
  expect(titulo.sizePt).toBeCloseTo(29.33, 2);
  expect(titulo.sizeEfectivoPt).toBeCloseTo(22, 1);
  expect(titulo.matriz[0]).toBeCloseTo(0.75, 3);
  const cuerpo = runs.find((r) => r.textoReal === 'C')!; // «Columna …»
  expect(cuerpo.sizePt).toBeCloseTo(14.66, 2);
  expect(cuerpo.sizeEfectivoPt).toBeCloseTo(11, 1);
  eng.close(doc);
});

test('nativo.pdf (matriz identidad): tamaño efectivo = nominal', async () => {
  const { eng, doc } = await abrir('nativo.pdf');
  for (const r of eng.getPageText(doc, 0)) expect(r.sizeEfectivoPt).toBeCloseTo(r.sizePt, 3);
  eng.close(doc);
});

test('setRunFontSize recibe el tamaño EFECTIVO: pedir 22 deja 22 pt efectivos (no 22 × 0,75)', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const run = eng.getPageText(doc, 0).find((r) => r.textoReal === 'C')!;
  const res = eng.setRunFontSize(doc, 0, run.runId, 22);
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error('unreachable');
  const nuevo = eng.getPageText(doc, 0).find((r) => r.runId === res.runId)!;
  expect(nuevo.sizeEfectivoPt).toBeCloseTo(22, 1);
  expect(nuevo.sizePt).toBeCloseTo(22 / 0.75, 1); // Tf nominal = efectivo / escala
  expect(nuevo.matriz[0]).toBeCloseTo(0.75, 3); // la matriz se conserva
  eng.close(doc);
});

test('setRunFontSize con el mismo tamaño efectivo no cambia lo que se ve', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const run = eng.getPageText(doc, 0).find((r) => r.textoReal === 'C')!;
  const res = eng.setRunFontSize(doc, 0, run.runId, run.sizeEfectivoPt);
  if (!res.ok) throw new Error('unreachable');
  const nuevo = eng.getPageText(doc, 0).find((r) => r.runId === res.runId)!;
  expect(nuevo.sizeEfectivoPt).toBeCloseTo(run.sizeEfectivoPt, 2);
  eng.close(doc);
});

test('la sustitución de fuente (E-047) y setRunFont conservan el tamaño EFECTIVO', async () => {
  const { eng, doc } = await abrir('por-glifo.pdf');
  const run = eng.getPageText(doc, 0).find((r) => r.textoReal === 'C')!;
  const res = eng.replaceRunWithStandardFont(doc, 0, run.runId, 'C');
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error('unreachable');
  const sust = eng.getPageText(doc, 0).find((r) => r.runId === res.runId)!;
  expect(sust.sizeEfectivoPt).toBeCloseTo(run.sizeEfectivoPt, 2);
  const cambio = eng.setRunFont(doc, 0, res.runId, 'Courier');
  if (!cambio.ok) throw new Error('unreachable');
  const courier = eng.getPageText(doc, 0).find((r) => r.runId === cambio.runId)!;
  expect(courier.sizeEfectivoPt).toBeCloseTo(run.sizeEfectivoPt, 2);
  eng.close(doc);
});
