import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';
import { construirZip } from '../../unit/helpers/zipBuilder';

/**
 * §9 fila #4: abrir un `.docx` desde `#file-input` lo convierte a un PDF con
 * texto REAL y vectorial (nunca rasteriza), usando el motor PDFium — a
 * diferencia de la app vieja (`docx-preview` + `html2pdf`, que rasteriza).
 * Fase 2a añade tablas reales, imágenes inline y enlaces clicables (ver
 * `word-completo.docx`, más abajo). `word-basico.docx`/`word-tabla-imagen.docx`/
 * `word-completo.docx` (tests/fixtures) se generan con `npm run test:fixtures`
 * (ver `generar-fixtures.mjs`).
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WORD_BASICO = path.resolve(AQUI, '../../fixtures/generados/word-basico.docx');
const WORD_TABLA_IMAGEN = path.resolve(AQUI, '../../fixtures/generados/word-tabla-imagen.docx');
const WORD_JPEG = path.resolve(AQUI, '../../fixtures/generados/word-jpeg.docx');
const WORD_COMBINADA = path.resolve(AQUI, '../../fixtures/generados/word-combinada.docx');
const WORD_COMPLETO = path.resolve(AQUI, '../../fixtures/generados/word-completo.docx');
const WORD_ENCABEZADOS = path.resolve(AQUI, '../../fixtures/generados/word-encabezados.docx');
const WORD_FLOTANTE = path.resolve(AQUI, '../../fixtures/generados/word-flotante.docx');

async function dataTransferConFichero(page: Page, bytes: number[], fileName: string, mime: string) {
  return page.evaluateHandle(({ bytes, fileName, mime }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], fileName, { type: mime }));
    return dt;
  }, { bytes, fileName, mime });
}

test('abrir word-basico.docx lo convierte a un PDF de 2 páginas con el texto en la capa de texto', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_BASICO);
  await expect(page.locator('.run').first()).toBeVisible();

  await expect(page.locator('#status')).toContainText('Convertido desde Word');

  const indicador = await page.locator('#page-indicator').textContent();
  const total = Number((indicador ?? '').split('/')[1]?.trim());
  expect(total).toBe(2);

  const textos = await page.locator('.run').allTextContents();
  const todo = textos.join(' ');
  expect(todo).toContain('Título');
  expect(todo).toMatch(/ñ/);
  expect(todo).toContain('negrita');

  // Sin advertencias (word-basico.docx no tiene contenido no soportado): el aviso no se muestra.
  await expect(page.locator('#conversion-warnings')).toBeHidden();
});

test('abrir word-tabla-imagen.docx: la tabla sale como texto real (rejilla) y la imagen aparece en la capa de imágenes, sin aviso (fase 2a)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_TABLA_IMAGEN);
  await expect(page.locator('.run').first()).toBeVisible();

  // Ya no se aplana ni se omite: sin advertencias, el aviso no se muestra.
  await expect(page.locator('#conversion-warnings')).toBeHidden();

  const textos = await page.locator('.run').allTextContents();
  expect(textos.join(' ')).toContain('Producto');
  expect(textos.join(' ')).toContain('Manzanas');

  // La imagen inline es un objeto imagen real, visible en la capa de imágenes.
  await expect(page.locator('.image-box')).toHaveCount(1);
});

test('abrir word-completo.docx: tabla con celda combinada, imagen y aviso visible del enlace javascript: descartado (fase 2a)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_COMPLETO);
  await expect(page.locator('.run').first()).toBeVisible();

  const textos = await page.locator('.run').allTextContents();
  const todo = textos.join(' ');
  expect(todo).toContain('Encabezado combinado');
  expect(todo).toContain('A1');
  expect(todo).toContain('Ir a example.com');
  expect(todo).toContain('enlace peligroso');

  await expect(page.locator('.image-box')).toHaveCount(1);

  // El enlace javascript: se descarta y se avisa visiblemente; ni tabla ni imagen generan aviso.
  await expect(page.locator('#conversion-warnings')).toBeVisible();
  const avisoTexto = (await page.locator('#conversion-warnings').textContent()) ?? '';
  expect(avisoTexto).toMatch(/enlace/i);
  expect(avisoTexto).not.toMatch(/tabla/i);
});

test('soltar un .doc (Word 97 binario) muestra el mensaje de formato antiguo, sin intentar convertirlo', async ({ page }) => {
  await page.goto('/index.next.html');
  const dt = await dataTransferConFichero(page, [1, 2, 3, 4], 'viejo.doc', 'application/msword');

  await page.dispatchEvent('#app', 'drop', { dataTransfer: dt });

  await expect(page.locator('#status')).toContainText('.doc antiguo no soportado');
  await expect(page.locator('.page')).toHaveCount(0);
});

test('abrir word-jpeg.docx: la imagen JPEG (createImageBitmap) llega al PDF con el tamaño declarado, 72x36 pt ±1, y sin aviso', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_JPEG);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('.image-box')).toHaveCount(1);
  await expect(page.locator('#conversion-warnings')).toBeHidden();

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'word-jpeg.pdf');
  await download.saveAs(destino);

  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const imagenes = eng.listImageObjects(doc, 0);
  expect(imagenes).toHaveLength(1);
  expect(Math.abs(imagenes[0]!.rectPt.wPt - 72)).toBeLessThanOrEqual(1);
  expect(Math.abs(imagenes[0]!.rectPt.hPt - 36)).toBeLessThanOrEqual(1);
  eng.close(doc);
});

test('abrir word-combinada.docx: la celda combinada verticalmente muestra su texto UNA vez y sin aviso', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_COMBINADA);
  await expect(page.locator('.run').first()).toBeVisible();
  const textos = await page.locator('.run').allTextContents();
  expect(textos.filter((t) => t.includes('Fusionada'))).toHaveLength(1);
  expect(textos.join(' ')).toContain('fila cuatro');
  await expect(page.locator('#conversion-warnings')).toBeHidden();
});

test('abrir word-encabezados.docx: 3 páginas, pie "Página N de 3" en cada una, encabezado de portada solo en la 1 y sin aviso (fase 2b)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_ENCABEZADOS);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('#conversion-warnings')).toBeHidden();

  const indicador = await page.locator('#page-indicator').textContent();
  expect(Number((indicador ?? '').split('/')[1]?.trim())).toBe(3);

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'word-encabezados.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const texto = (p: number): string => eng.getPageText(doc, p).map((r) => r.text).join(' ');
  expect(eng.pageCount(doc)).toBe(3);
  expect(texto(0)).toContain('Encabezado de portada');
  expect(texto(1)).toContain('Encabezado general');
  expect(texto(0)).toContain('Página 1 de 3');
  expect(texto(1)).toContain('Página 2 de 3');
  expect(texto(2)).toContain('Página 3 de 3');
  // El título no queda huérfano al pie de la página 1.
  expect(texto(0)).not.toContain('Resultados del informe');
  expect(texto(1)).toContain('Resultados del informe');
  eng.close(doc);
});

test('abrir word-flotante.docx: la imagen flotante se coloca (una imagen en la capa) y el aviso visible dice que va sin ajuste de texto', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_FLOTANTE);
  await expect(page.locator('.run').first()).toBeVisible();
  await expect(page.locator('.image-box')).toHaveCount(1);

  await expect(page.locator('#conversion-warnings')).toBeVisible();
  const aviso = (await page.locator('#conversion-warnings').textContent()) ?? '';
  expect(aviso).toMatch(/imagen flotante colocada sin ajuste de texto/i);
});

test('T13: la flotante colocada sale en "Incluido con diferencias" y no en "No se pudo incluir"', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_FLOTANTE);
  await expect(page.locator('.image-box')).toHaveCount(1);

  const aviso = page.locator('#conversion-warnings');
  await expect(aviso).toBeVisible();
  await expect(aviso).toHaveAttribute('role', 'status');
  const aprox = aviso.locator('section[data-tipo="aproximado"]');
  await expect(aprox).toBeVisible();
  await expect(aprox.locator('strong')).toHaveText('Incluido con diferencias:');
  await expect(aprox.locator('li')).toContainText(/imagen flotante colocada sin ajuste de texto/i);
  await expect(aviso.locator('section[data-tipo="omitido"]')).toBeHidden();
});

test('T13: nota al pie y objeto incrustado salen en "No se pudo incluir"; el enlace rechazado, en "Incluido con diferencias"', async ({ page }) => {
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document><w:body>
  <w:p><w:r><w:t>Texto con nota</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>
  <w:p><w:r><w:object/></w:r></w:p>
  <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;
  const zip = construirZip([
    { nombre: '[Content_Types].xml', datos: Buffer.from('<Types/>') },
    { nombre: 'word/document.xml', datos: Buffer.from(documentXml, 'utf-8') }
  ]);
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles({ name: 'omisiones.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(zip) });
  await expect(page.locator('.run').first()).toBeVisible();

  const omit = page.locator('#conversion-warnings section[data-tipo="omitido"]');
  await expect(omit).toBeVisible();
  await expect(omit.locator('strong')).toHaveText('No se pudo incluir:');
  await expect(omit.locator('li')).toHaveCount(2);
  await expect(omit).toContainText(/nota al pie/i);
  await expect(omit).toContainText(/objeto incrustado/i);
  await expect(page.locator('#conversion-warnings section[data-tipo="aproximado"]')).toBeHidden();
});

test('T13: word-completo.docx (enlace javascript:) lo lista en "Incluido con diferencias"', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(WORD_COMPLETO);
  await expect(page.locator('.run').first()).toBeVisible();
  const aprox = page.locator('#conversion-warnings section[data-tipo="aproximado"]');
  await expect(aprox).toContainText(/enlace/i);
  await expect(page.locator('#conversion-warnings section[data-tipo="omitido"]')).toBeHidden();
});

// ---------------------------------------------------------------------------
// Fase 2c: secciones, encabezados ricos, ajuste de texto y tabulaciones (fixtures en tests/fixtures/generados).
// ---------------------------------------------------------------------------
const WORD_SECCIONES = path.resolve(AQUI, '../../fixtures/generados/word-secciones.docx');
const WORD_ENC_RICO = path.resolve(AQUI, '../../fixtures/generados/word-encabezado-rico.docx');
const WORD_AJUSTE = path.resolve(AQUI, '../../fixtures/generados/word-ajuste.docx');
const WORD_TABS = path.resolve(AQUI, '../../fixtures/generados/word-tabs.docx');
const WORD_NUM_TABS = path.resolve(AQUI, '../../fixtures/generados/word-numeracion-tabs.docx');
const WORD_LISTAS_CELDA = path.resolve(AQUI, '../../fixtures/generados/word-listas-celda.docx');

/** Abre el .docx en la app, espera la conversión, guarda el PDF resultante y lo abre con el motor para inspeccionarlo. */
async function convertirYGuardar(page: Page, fixture: string, nombre: string) {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(fixture);
  await expect(page.locator('.run').first()).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, `${nombre}.pdf`);
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  return { eng, doc };
}

test('abrir word-secciones.docx: la tercera página sale apaisada, con su encabezado y la numeración reiniciada, sin aviso (fase 2c)', async ({ page }) => {
  const { eng, doc } = await convertirYGuardar(page, WORD_SECCIONES, 'word-secciones');
  await expect(page.locator('#conversion-warnings')).toBeHidden();
  expect(eng.pageCount(doc)).toBe(3);
  const tam = [0, 1, 2].map((p) => eng.pageSize(doc, p));
  expect(tam.map((t) => [Math.round(t.widthPt), Math.round(t.heightPt)])).toEqual([[612, 792], [612, 792], [792, 612]]);
  const texto = (p: number): string => eng.getPageText(doc, p).map((r) => r.text).join(' ');
  expect(texto(1)).toContain('Página 2 de 3');
  expect(texto(2)).toContain('Encabezado apaisado');
  expect(texto(2)).toContain('Página 1 de 3');
  eng.close(doc);
});

test('abrir word-encabezado-rico.docx: logo y tabla del encabezado en cada página, sin aviso (fase 2c)', async ({ page }) => {
  const { eng, doc } = await convertirYGuardar(page, WORD_ENC_RICO, 'word-encabezado-rico');
  await expect(page.locator('#conversion-warnings')).toBeHidden();
  expect(eng.pageCount(doc)).toBe(3);
  for (let p = 0; p < 3; p++) {
    expect(eng.listImageObjects(doc, p)).toHaveLength(1);
    const texto = eng.getPageText(doc, p).map((r) => r.text).join(' ');
    expect(texto).toContain('Empresa S.A.');
    expect(texto).toContain('Informe mensual');
  }
  eng.close(doc);
});

test('abrir word-ajuste.docx: el texto rodea la imagen flotante (las líneas junto a ella quedan a su izquierda) y no hay aviso de "sin ajuste" (fase 2c)', async ({ page }) => {
  const { eng, doc } = await convertirYGuardar(page, WORD_AJUSTE, 'word-ajuste');
  await expect(page.locator('#conversion-warnings')).toBeHidden();
  const img = eng.listImageObjects(doc, 0)[0]!.rectPt;
  const runs = eng.getPageText(doc, 0).filter((r) => r.text.includes('texto'));
  const junto = runs.filter((r) => r.boxPt.yPt >= img.yPt - 0.5 && r.boxPt.yPt + r.boxPt.hPt <= img.yPt + img.hPt + 0.5);
  expect(junto.length).toBeGreaterThanOrEqual(6);
  for (const r of junto) expect(r.boxPt.xPt + r.boxPt.wPt).toBeLessThanOrEqual(img.xPt - 9 + 1);
  expect(Math.max(...runs.map((r) => r.boxPt.xPt + r.boxPt.wPt))).toBeGreaterThan(img.xPt + 20); // debajo vuelve el ancho completo
  eng.close(doc);
});

test('abrir word-tabs.docx: el número del índice y el "Página X de Y" del pie acaban en el margen derecho (fase 2c)', async ({ page }) => {
  const { eng, doc } = await convertirYGuardar(page, WORD_TABS, 'word-tabs');
  await expect(page.locator('#conversion-warnings')).toBeHidden();
  const runs = eng.getPageText(doc, 0);
  const anexo = runs.find((r) => r.textoReal.trim() === 'Anexo')!;
  const n120 = runs.find((r) => r.textoReal.trim() === '120' && Math.abs(r.boxPt.yPt - anexo.boxPt.yPt) < 4)!;
  expect(Math.abs(n120.boxPt.xPt + n120.boxPt.wPt - 540)).toBeLessThanOrEqual(1.5);
  expect(runs.some((r) => /^\.{10,}$/.test(r.textoReal.trim()))).toBe(true);
  const pagina = runs.find((r) => r.textoReal.includes('Página 1 de 1'))!;
  expect(Math.abs(pagina.boxPt.xPt + eng.measureText(pagina.fontName, pagina.sizePt, pagina.textoReal.trim()) - 540)).toBeLessThanOrEqual(1);
  eng.close(doc);
});

test('abrir word-numeracion-tabs.docx: marcadores romanos y de letra, y la tabulación de la celda en su parada, sin aviso (E-101)', async ({ page }) => {
  const { eng, doc } = await convertirYGuardar(page, WORD_NUM_TABS, 'word-numeracion-tabs');
  await expect(page.locator('#conversion-warnings')).toBeHidden();
  const runs = eng.getPageText(doc, 0);
  const lineas = runs.map((r) => r.textoReal.trim());
  for (const esperada of ['iv. cuatro', 'B) beta', 'xii. doce']) expect(lineas).toContain(esperada);
  const valor = runs.find((r) => r.textoReal.trim() === 'Valor')!;
  expect(Math.abs(valor.boxPt.xPt - 277)).toBeLessThanOrEqual(1.5);
  eng.close(doc);
});

test('abrir word-listas-celda.docx: la lista numerada sigue dentro de la celda (3., 4.) y vuelve al cuerpo (5.); viñetas ✔ exacta y cuadradito con aviso (E-102)', async ({ page }) => {
  const { eng, doc } = await convertirYGuardar(page, WORD_LISTAS_CELDA, 'word-listas-celda');
  // Solo el ▪ (sustituido por ■) avisa; ✔ y la redonda de Symbol son exactas.
  await expect(page.locator('#conversion-warnings')).toBeVisible();
  await expect(page.locator('#conversion-warnings')).toContainText('viñeta');
  await expect(page.locator('#conversion-warnings')).toContainText('▪');
  const runs = eng.getPageText(doc, 0);
  const lineas = runs.map((r) => r.textoReal.trim());
  for (const esperada of ['1. uno', '2. dos', '3. tres', '4. cuatro', '5. cinco', '• redonda']) expect(lineas).toContain(esperada);
  for (const [vineta, texto] of [['■', 'cuadro'], ['✔', 'visto']] as const) {
    const v = runs.find((r) => r.textoReal.trim() === vineta)!;
    const t = runs.find((r) => r.textoReal.trim() === texto)!;
    expect(v).toBeDefined();
    expect(Math.abs(v.boxPt.yPt - t.boxPt.yPt)).toBeLessThan(6);
    expect(v.boxPt.xPt).toBeLessThan(t.boxPt.xPt);
  }
  // Las celdas están a la derecha del margen: el "3." cuelga dentro de su celda, no en el margen del cuerpo.
  const tres = runs.find((r) => r.textoReal.trim() === '3. tres')!;
  expect(tres.boxPt.xPt).toBeGreaterThan(72 + 5);
  eng.close(doc);
});
