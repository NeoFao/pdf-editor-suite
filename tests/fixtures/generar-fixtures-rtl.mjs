/**
 * Genera los PDF con escritura de derecha a izquierda (hebreo, árabe, mixto) con Chromium (`page.pdf()`), que escribe un
 * `Tj` por glifo igual que el Chrome real de los usuarios. Se usan fuentes del SISTEMA de Windows con ambos alfabetos
 * (Arial, Times New Roman, Segoe UI): no se descarga ni se confirma ningún fichero de fuente.
 *
 * IMPORTANTE: este script NO corre en CI (Linux, sin esas fuentes) y NO forma parte de `npm run test:fixtures`.
 * Los PDF resultantes (`tests/fixtures/rtl/*.pdf`) se CONFIRMAN ya generados. Para regenerarlos, en Windows:
 *   node tests/fixtures/generar-fixtures-rtl.mjs
 * Chromium solo incrusta el subconjunto de la fuente usado si su `fsType` lo permite (estas fuentes lo permiten).
 */
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SALIDA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'rtl');

const estilo = `<style>
  @page { size: A4; margin: 0 }
  body { margin: 0; font-family: Arial, 'Times New Roman', 'Segoe UI', sans-serif; font-size: 18px; }
  p { position: absolute; left: 60px; width: 470px; margin: 0; white-space: nowrap; }
</style>`;

const DOCS = {
  'rtl-hebreo.pdf': `
    <p dir="rtl" style="top:80px">שלום עולם זה טקסט בעברית</p>
    <p dir="rtl" style="top:130px">הכל בסדר גמור היום</p>
    <p dir="ltr" style="top:180px">Linea latina de control</p>`,
  'rtl-arabe.pdf': `
    <p dir="rtl" style="top:80px">مرحبا بالعالم هذا نص عربي</p>
    <p dir="rtl" style="top:130px">كل شيء على ما يرام اليوم</p>
    <p dir="ltr" style="top:180px">Linea latina de control</p>`,
  'rtl-mixto.pdf': `
    <p dir="ltr" style="top:80px">Hola שלום 123 fin</p>
    <p dir="rtl" style="top:130px">שלום Hello 456 עולם</p>
    <p dir="ltr" style="top:180px">Salida مرحبا بالعالم final</p>
    <p dir="rtl" style="top:230px">שלום עולם</p>`
};

const navegador = await chromium.launch();
try {
  for (const [nombre, html] of Object.entries(DOCS)) {
    const page = await navegador.newPage();
    await page.setContent(`<!doctype html><meta charset="utf-8">${estilo}<body>${html}</body>`);
    await page.pdf({ path: path.join(SALIDA, nombre), format: 'A4', printBackground: true });
    await page.close();
    process.stdout.write(`generado ${nombre}${String.fromCharCode(10)}`);
  }
} finally {
  await navegador.close();
}
