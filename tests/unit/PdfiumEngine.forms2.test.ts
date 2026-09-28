import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

/**
 * PDF con un radio group ('color': rojo/verde/azul, sin selección inicial), un
 * combo ('pais': Perú/Chile/México, valor inicial Chile) y una lista de
 * selección múltiple ('frutas': manzana/pera/uva, sin selección inicial).
 * Con apariencias generadas, como en PdfiumEngine.forms.test.ts.
 */
async function crearFormulario(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([320, 300]);
  const form = doc.getForm();

  const radio = form.createRadioGroup('color');
  radio.addOptionToPage('rojo', p, { x: 20, y: 250, width: 15, height: 15 });
  radio.addOptionToPage('verde', p, { x: 20, y: 220, width: 15, height: 15 });
  radio.addOptionToPage('azul', p, { x: 20, y: 190, width: 15, height: 15 });

  const dropdown = form.createDropdown('pais');
  dropdown.addOptions(['Perú', 'Chile', 'México']);
  dropdown.select('Chile');
  dropdown.addToPage(p, { x: 20, y: 140, width: 150, height: 20 });

  const list = form.createOptionList('frutas');
  list.addOptions(['manzana', 'pera', 'uva']);
  list.enableMultiselect();
  list.addToPage(p, { x: 20, y: 40, width: 150, height: 60 });

  form.updateFieldAppearances(font);
  return doc.save();
}

/** Igual que crearFormulario pero con un campo de cada tipo marcado como sólo lectura (/Ff bit 1). */
async function crearFormularioReadOnly(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([320, 300]);
  const form = doc.getForm();

  const radio = form.createRadioGroup('color');
  radio.addOptionToPage('rojo', p, { x: 20, y: 250, width: 15, height: 15 });
  radio.addOptionToPage('verde', p, { x: 20, y: 220, width: 15, height: 15 });
  radio.enableReadOnly();

  const dropdown = form.createDropdown('pais');
  dropdown.addOptions(['Perú', 'Chile']);
  dropdown.select('Chile');
  dropdown.addToPage(p, { x: 20, y: 140, width: 150, height: 20 });
  dropdown.enableReadOnly();

  form.updateFieldAppearances(font);
  return doc.save();
}

test('listFormFields lee radio (exportValue por widget), combo y lista con sus opciones y seleccionados', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearFormulario());

  const fields = eng.listFormFields(doc, 0);
  const radios = fields.filter((f) => f.name === 'color');
  expect(radios).toHaveLength(3);
  expect(radios.map((f) => f.kind)).toEqual(['radio', 'radio', 'radio']);
  expect(radios.map((f) => f.exportValue).sort()).toEqual(['azul', 'rojo', 'verde']);
  // Ninguno seleccionado inicialmente.
  expect(radios.every((f) => f.checked === false)).toBe(true);
  // options vacío en radio (solo aplica a combo/lista).
  expect(radios.every((f) => f.options.length === 0)).toBe(true);

  const pais = fields.find((f) => f.name === 'pais')!;
  expect(pais.kind).toBe('combo');
  expect(pais.value).toBe('Chile');
  expect(pais.options.map((o) => o.label)).toEqual(['Perú', 'Chile', 'México']);
  expect(pais.options.map((o) => o.value)).toEqual(['Perú', 'Chile', 'México']);
  expect(pais.options.map((o) => o.selected)).toEqual([false, true, false]);
  expect(pais.multiSelect).toBe(false);

  const frutas = fields.find((f) => f.name === 'frutas')!;
  expect(frutas.kind).toBe('list');
  expect(frutas.options.map((o) => o.label)).toEqual(['manzana', 'pera', 'uva']);
  expect(frutas.options.every((o) => o.selected === false)).toBe(true);
  expect(frutas.multiSelect).toBe(true);

  eng.close(doc);
});

test('setFormChoice(pais, ["Perú"]) persiste tras guardar y reabrir', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearFormulario());
  const pais = eng.listFormFields(doc, 0).find((f) => f.name === 'pais')!;

  const ok = eng.setFormChoice(doc, 0, pais.annotIndex, ['Perú']);
  expect(ok).toBe(true);
  expect(eng.listFormFields(doc, 0).find((f) => f.name === 'pais')!.value).toBe('Perú');

  const doc2 = await eng.open(eng.save(doc));
  const pais2 = eng.listFormFields(doc2, 0).find((f) => f.name === 'pais')!;
  expect(pais2.value).toBe('Perú');
  expect(pais2.options.find((o) => o.label === 'Perú')!.selected).toBe(true);
  expect(pais2.options.filter((o) => o.selected)).toHaveLength(1);

  eng.close(doc);
  eng.close(doc2);
});

test('setFormChoice en combo rechaza más de un valor (no es multiselección)', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearFormulario());
  const pais = eng.listFormFields(doc, 0).find((f) => f.name === 'pais')!;

  const ok = eng.setFormChoice(doc, 0, pais.annotIndex, ['Perú', 'Chile']);
  expect(ok).toBe(false);
  // Nada cambió.
  expect(eng.listFormFields(doc, 0).find((f) => f.name === 'pais')!.value).toBe('Chile');

  eng.close(doc);
});

test('setFormChoice(frutas, ["manzana","uva"]) en lista multiselección persiste ambos tras guardar y reabrir', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearFormulario());
  const frutas = eng.listFormFields(doc, 0).find((f) => f.name === 'frutas')!;

  const ok = eng.setFormChoice(doc, 0, frutas.annotIndex, ['manzana', 'uva']);
  expect(ok).toBe(true);

  const doc2 = await eng.open(eng.save(doc));
  const frutas2 = eng.listFormFields(doc2, 0).find((f) => f.name === 'frutas')!;
  const seleccionadas = frutas2.options.filter((o) => o.selected).map((o) => o.label).sort();
  expect(seleccionadas).toEqual(['manzana', 'uva']);

  // Reducir a un solo valor también funciona (vía la misma API).
  const ok2 = eng.setFormChoice(doc2, 0, frutas.annotIndex, ['pera']);
  expect(ok2).toBe(true);
  const frutas3 = eng.listFormFields(doc2, 0).find((f) => f.name === 'frutas')!;
  expect(frutas3.options.filter((o) => o.selected).map((o) => o.label)).toEqual(['pera']);

  // Vaciar del todo (0 valores) también funciona — es el caso que usa deshacer
  // cuando la lista partía sin ninguna selección. EPDFAnnot_SetFormFieldValue
  // con cadena vacía NO sirve para esto en una lista MultiSelect (verificado
  // empíricamente): hace falta la vía de índices también para 0 valores.
  const ok3 = eng.setFormChoice(doc2, 0, frutas.annotIndex, []);
  expect(ok3).toBe(true);
  expect(eng.listFormFields(doc2, 0).find((f) => f.name === 'frutas')!.options.filter((o) => o.selected)).toHaveLength(0);

  eng.close(doc);
  eng.close(doc2);
});

test('setFormRadio marca SOLO el widget elegido y persiste tras guardar y reabrir', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearFormulario());
  const verde = eng.listFormFields(doc, 0).find((f) => f.name === 'color' && f.exportValue === 'verde')!;

  const ok = eng.setFormRadio(doc, 0, verde.annotIndex);
  expect(ok).toBe(true);

  const doc2 = await eng.open(eng.save(doc));
  const radios2 = eng.listFormFields(doc2, 0).filter((f) => f.name === 'color');
  const marcados = radios2.filter((f) => f.checked);
  expect(marcados).toHaveLength(1);
  expect(marcados[0]!.exportValue).toBe('verde');

  eng.close(doc);
  eng.close(doc2);
});

test('setFormRadio cambia de opción: la anterior queda desmarcada', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearFormulario());
  const rojo = eng.listFormFields(doc, 0).find((f) => f.name === 'color' && f.exportValue === 'rojo')!;
  const azul = eng.listFormFields(doc, 0).find((f) => f.name === 'color' && f.exportValue === 'azul')!;

  expect(eng.setFormRadio(doc, 0, rojo.annotIndex)).toBe(true);
  expect(eng.setFormRadio(doc, 0, azul.annotIndex)).toBe(true);

  const radios = eng.listFormFields(doc, 0).filter((f) => f.name === 'color');
  expect(radios.filter((f) => f.checked)).toHaveLength(1);
  expect(radios.find((f) => f.checked)!.exportValue).toBe('azul');

  eng.close(doc);
});

test('clearFormRadio deja el grupo entero en Off', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearFormulario());
  const rojo = eng.listFormFields(doc, 0).find((f) => f.name === 'color' && f.exportValue === 'rojo')!;

  expect(eng.setFormRadio(doc, 0, rojo.annotIndex)).toBe(true);
  expect(eng.listFormFields(doc, 0).some((f) => f.name === 'color' && f.checked)).toBe(true);

  expect(eng.clearFormRadio(doc, 0, rojo.annotIndex)).toBe(true);
  expect(eng.listFormFields(doc, 0).every((f) => f.name !== 'color' || f.checked === false)).toBe(true);

  eng.close(doc);
});

test('setFormChoice/setFormRadio devuelven false sobre campos de sólo lectura', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearFormularioReadOnly());
  const pais = eng.listFormFields(doc, 0).find((f) => f.name === 'pais')!;
  const rojo = eng.listFormFields(doc, 0).find((f) => f.name === 'color' && f.exportValue === 'rojo')!;

  expect(pais.readOnly).toBe(true);
  expect(rojo.readOnly).toBe(true);

  expect(eng.setFormChoice(doc, 0, pais.annotIndex, ['Perú'])).toBe(false);
  expect(eng.listFormFields(doc, 0).find((f) => f.name === 'pais')!.value).toBe('Chile');

  expect(eng.setFormRadio(doc, 0, rojo.annotIndex)).toBe(false);
  expect(eng.listFormFields(doc, 0).some((f) => f.name === 'color' && f.checked)).toBe(false);

  eng.close(doc);
});

test('setFormChoice/setFormRadio devuelven false sobre el tipo de campo equivocado', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearFormulario());
  const pais = eng.listFormFields(doc, 0).find((f) => f.name === 'pais')!;
  const rojo = eng.listFormFields(doc, 0).find((f) => f.name === 'color' && f.exportValue === 'rojo')!;

  expect(eng.setFormRadio(doc, 0, pais.annotIndex)).toBe(false);
  expect(eng.setFormChoice(doc, 0, rojo.annotIndex, ['x'])).toBe(false);

  eng.close(doc);
});
