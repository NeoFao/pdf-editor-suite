import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

// Editar DOS líneas seguidas en la misma sesión: ambas deben quedar con el texto nuevo y las demás intactas,
// confirmando con Enter, con un clic fuera o con Tab.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

type Confirmar = 'Enter' | 'clic-fuera' | 'Tab';

async function editar(page: Page, indice: number, texto: string, como: Confirmar): Promise<void> {
  const run = page.locator('.page').first().locator('.run').nth(indice);
  await run.click();
  await expect(run).toHaveClass(/editing/);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(texto);
  await expect(run, `el texto tecleado no llegó a la línea ${indice}`).toHaveText(texto);
  if (como === 'Enter') await page.keyboard.press('Enter');
  else if (como === 'Tab') await page.keyboard.press('Tab');
  else await page.locator('#status').click();
  await expect(run).not.toHaveClass(/editing/);
}

for (const como of ['Enter', 'clic-fuera', 'Tab'] as const) {
  test(`edicion-consecutiva (${como}): dos líneas seguidas quedan editadas y el resto intacto`, async ({ page }) => {
    await page.goto('/index.next.html');
    await page.locator('#file-input').setInputFiles(FIXTURE);
    const runs = page.locator('.page').first().locator('.run');
    await expect(runs.first()).toBeVisible();
    const antes = await runs.allTextContents();

    await editar(page, 1, 'NUEVA-DOS', como);
    await editar(page, 3, 'NUEVA-CUATRO', como);

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
    const destino = path.join(test.info().outputDir, `consecutiva-${como}.pdf`);
    await download.saveAs(destino);
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
    const textos = eng.getPageText(doc, 0).map((t) => t.text);
    eng.close(doc);
    const esperado = antes.map((t, i) => (i === 1 ? 'NUEVA-DOS' : i === 3 ? 'NUEVA-CUATRO' : t));
    expect(textos.slice().sort(), `textos=${JSON.stringify(textos)}`).toEqual(esperado.slice().sort());
  });
}
