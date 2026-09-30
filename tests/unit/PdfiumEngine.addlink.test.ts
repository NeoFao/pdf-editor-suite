import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument } from 'pdf-lib';

/** Busca `aguja` (ASCII) en los bytes crudos del PDF guardado — suficiente para comprobar que la anotación /Link con su /URI persiste en el archivo serializado, sin depender de un getter que el contrato no expone (fase 1 de enlaces: solo escritura). */
function contieneAscii(bytes: Uint8Array, aguja: string): boolean {
  const texto = Buffer.from(bytes).toString('latin1');
  return texto.includes(aguja);
}

test('addLink crea una anotación /Link con la URI dada, y persiste tras save + abrir de nuevo', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());

  const ok = eng.addLink(doc, 0, { xPt: 40, yPt: 120, wPt: 160, hPt: 24 }, 'https://example.com/pagina');
  expect(ok).toBe(true);

  const bytes1 = eng.save(doc);
  expect(contieneAscii(bytes1, '/Link')).toBe(true);
  expect(contieneAscii(bytes1, 'https://example.com/pagina')).toBe(true);

  // Reabrir y volver a guardar: la anotación no se pierde en el segundo ciclo.
  const doc2 = await eng.open(bytes1);
  const bytes2 = eng.save(doc2);
  expect(contieneAscii(bytes2, '/Link')).toBe(true);
  expect(contieneAscii(bytes2, 'https://example.com/pagina')).toBe(true);

  eng.close(doc);
  eng.close(doc2);
});

test('addLink con javascript: NO crea ninguna anotación', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());

  const ok = eng.addLink(doc, 0, { xPt: 40, yPt: 120, wPt: 160, hPt: 24 }, 'javascript:alert(1)');
  expect(ok).toBe(false);

  const bytes = eng.save(doc);
  expect(contieneAscii(bytes, '/Link')).toBe(false);
  expect(contieneAscii(bytes, 'alert')).toBe(false);

  eng.close(doc);
});

test('addLink en lote (applyPageOps): varios enlaces en la misma página', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());

  const resultados = eng.applyPageOps(doc, 0, [
    { type: 'addLink', rect: { xPt: 10, yPt: 10, wPt: 50, hPt: 20 }, url: 'https://a.example.com' },
    { type: 'addLink', rect: { xPt: 10, yPt: 40, wPt: 50, hPt: 20 }, url: 'mailto:alguien@example.com' },
    { type: 'addLink', rect: { xPt: 10, yPt: 70, wPt: 50, hPt: 20 }, url: 'file:///etc/passwd' }
  ]);
  expect(resultados).toEqual([
    { type: 'addLink', ok: true },
    { type: 'addLink', ok: true },
    { type: 'addLink', ok: false }
  ]);

  const bytes = eng.save(doc);
  expect(contieneAscii(bytes, 'https://a.example.com')).toBe(true);
  expect(contieneAscii(bytes, 'mailto:alguien@example.com')).toBe(true);
  expect(contieneAscii(bytes, 'file://')).toBe(false);

  eng.close(doc);
});
