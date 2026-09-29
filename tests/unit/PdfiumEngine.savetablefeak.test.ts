import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import type { Mem } from '../../src/engine/pdfium/mem';

/**
 * E-036 (docs/ERRORES-CONOCIDOS.md): `save()` registraba su callback
 * `WriteBlock` con `mem.addFunction(..., 'iiii')` en CADA llamada y nunca lo
 * liberaba con `removeFunction()`. Cada llamada ocupa una entrada nueva de la
 * tabla de funciones indirectas de WebAssembly — como `save()` se llama en
 * cada comando con deshacer por snapshot (además de al exportar), una sesión
 * larga de edición hace crecer esa tabla sin límite.
 *
 * Medición: `mem.addFunction()` devuelve el índice de tabla que ocupó (los
 * índices liberados por `removeFunction()` se reciclan; si nadie libera, cada
 * `addFunction()` nuevo tiene que pedir un índice más alto que el anterior).
 * Se toma un índice de referencia con una sonda de usar-y-liberar, se hacen
 * N `save()` seguidos, y se vuelve a sondear: si `save()` no libera su propio
 * callback, esos N slots quedan ocupados para siempre y la segunda sonda cae
 * muy por encima de la primera. Si `save()` libera correctamente, la segunda
 * sonda recicla el mismo hueco (o uno cercano) que la primera.
 */
test('E-036: 500 save() seguidos no agotan la tabla de funciones indirectas de WASM', async () => {
  const d = await PDFDocument.create();
  d.addPage([72, 72]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());

  // `mem` es privado en PdfiumEngine — se accede igual que en cualquier test
  // de caja blanca de este fichero (no hay una API pública para inspeccionar
  // la tabla de funciones, ni falta hace fuera de este test de fuga).
  const mem = (eng as unknown as { mem: Mem }).mem;

  const sondaAntes = mem.addFunction(() => 1, 'iiii');
  mem.removeFunction(sondaAntes);

  const N = 500;
  for (let i = 0; i < N; i++) {
    eng.save(doc);
  }

  const sondaDespues = mem.addFunction(() => 1, 'iiii');
  mem.removeFunction(sondaDespues);

  // Margen pequeño (no 0): otras operaciones del motor pueden reservar algún
  // slot transitorio propio. Lo que importa es que el crecimiento NO sea
  // proporcional a N (500) — antes del arreglo, sondaDespues - sondaAntes >= 500.
  expect(sondaDespues - sondaAntes).toBeLessThanOrEqual(2);

  eng.close(doc);
});
