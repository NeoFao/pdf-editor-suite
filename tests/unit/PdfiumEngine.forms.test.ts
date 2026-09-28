import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

/**
 * Construye un PDF con AcroForm: dos campos de texto ('nombre' vacío,
 * 'ciudad' con valor inicial 'Lima') y una casilla ('acepto') sin marcar.
 * Con apariencias generadas (form.updateFieldAppearances), como pide el spec.
 */
async function crearFormulario(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([300, 220]);
  const form = doc.getForm();

  const nombre = form.createTextField('nombre');
  nombre.addToPage(p, { x: 20, y: 160, width: 200, height: 20 });

  const ciudad = form.createTextField('ciudad');
  ciudad.addToPage(p, { x: 20, y: 120, width: 200, height: 20 });
  ciudad.setText('Lima');

  const acepto = form.createCheckBox('acepto');
  acepto.addToPage(p, { x: 20, y: 80, width: 20, height: 20 });

  form.updateFieldAppearances(font);
  return doc.save();
}

async function crearNativo(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([300, 200]);
  p.drawText('Documento sin formulario', { x: 20, y: 150, size: 14, font });
  return doc.save();
}

test('listFormFields lee los 3 campos de un AcroForm con su tipo y valor inicial', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearFormulario());

  const fields = eng.listFormFields(doc, 0);
  expect(fields).toHaveLength(3);

  const nombre = fields.find((f) => f.name === 'nombre');
  const ciudad = fields.find((f) => f.name === 'ciudad');
  const acepto = fields.find((f) => f.name === 'acepto');

  expect(nombre).toBeTruthy();
  expect(nombre!.kind).toBe('text');
  expect(nombre!.value).toBe('');
  expect(nombre!.readOnly).toBe(false);

  expect(ciudad).toBeTruthy();
  expect(ciudad!.kind).toBe('text');
  expect(ciudad!.value).toBe('Lima');

  expect(acepto).toBeTruthy();
  expect(acepto!.kind).toBe('checkbox');
  expect(acepto!.checked).toBe(false);

  eng.close(doc);
});

test('setFormText escribe el valor de un campo de texto y persiste tras guardar y reabrir', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearFormulario());
  const nombre = eng.listFormFields(doc, 0).find((f) => f.name === 'nombre')!;

  const ok = eng.setFormText(doc, 0, nombre.annotIndex, 'José Ñúñez');
  expect(ok).toBe(true);
  expect(eng.listFormFields(doc, 0).find((f) => f.name === 'nombre')!.value).toBe('José Ñúñez');

  const doc2 = await eng.open(eng.save(doc));
  expect(eng.listFormFields(doc2, 0).find((f) => f.name === 'nombre')!.value).toBe('José Ñúñez');
  // El otro campo de texto no se ve afectado.
  expect(eng.listFormFields(doc2, 0).find((f) => f.name === 'ciudad')!.value).toBe('Lima');

  eng.close(doc);
  eng.close(doc2);
});

test('setFormChecked marca la casilla y persiste tras guardar y reabrir', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearFormulario());
  const acepto = eng.listFormFields(doc, 0).find((f) => f.name === 'acepto')!;

  const ok = eng.setFormChecked(doc, 0, acepto.annotIndex, true);
  expect(ok).toBe(true);
  expect(eng.listFormFields(doc, 0).find((f) => f.name === 'acepto')!.checked).toBe(true);

  const doc2 = await eng.open(eng.save(doc));
  expect(eng.listFormFields(doc2, 0).find((f) => f.name === 'acepto')!.checked).toBe(true);

  // Desmarcar también persiste.
  const ok2 = eng.setFormChecked(doc2, 0, acepto.annotIndex, false);
  expect(ok2).toBe(true);
  const doc3 = await eng.open(eng.save(doc2));
  expect(eng.listFormFields(doc3, 0).find((f) => f.name === 'acepto')!.checked).toBe(false);

  eng.close(doc);
  eng.close(doc2);
  eng.close(doc3);
});

test('setFormText solo actúa sobre campos de texto; setFormChecked solo sobre casillas', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearFormulario());
  const acepto = eng.listFormFields(doc, 0).find((f) => f.name === 'acepto')!;
  const ciudad = eng.listFormFields(doc, 0).find((f) => f.name === 'ciudad')!;

  expect(eng.setFormText(doc, 0, acepto.annotIndex, 'no debería')).toBe(false);
  expect(eng.setFormChecked(doc, 0, ciudad.annotIndex, true)).toBe(false);
  // Nada cambió.
  expect(eng.listFormFields(doc, 0).find((f) => f.name === 'ciudad')!.value).toBe('Lima');
  expect(eng.listFormFields(doc, 0).find((f) => f.name === 'acepto')!.checked).toBe(false);

  eng.close(doc);
});

test('un PDF sin AcroForm no tiene campos; abrir y cerrar repetidamente no falla', async () => {
  const eng = await PdfiumEngine.create();
  const bytes = await crearNativo();
  for (let i = 0; i < 3; i++) {
    const doc = await eng.open(bytes);
    expect(eng.listFormFields(doc, 0)).toEqual([]);
    eng.close(doc);
  }
});
