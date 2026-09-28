import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../../src/engine/pdfium/PdfiumEngine';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(AQUI, '../../fixtures/generados/nativo.pdf');

test('nota: se coloca con un clic, se ve su marcador y persiste al guardar; deshacer la quita', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  page.once('dialog', (d) => d.accept('Mi nota'));
  await page.locator('#btn-note').click(); // activa el modo nota
  const pagina = page.locator('.page').first();
  await pagina.click({ position: { x: 160, y: 175 } });
  await expect(page.locator('#status')).toHaveText('Nota añadida.');

  const marcador = page.locator('.note-marker');
  await expect(marcador).toHaveCount(1);
  await expect(marcador).toHaveAttribute('title', 'Mi nota');

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-save').click()]);
  const destino = path.join(test.info().outputDir, 'nota.pdf');
  await download.saveAs(destino);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(new Uint8Array(fs.readFileSync(destino)));
  const notas = eng.getNotes(doc, 0);
  expect(notas).toHaveLength(1);
  expect(notas[0]!.text).toBe('Mi nota');
  eng.close(doc);

  await page.locator('#btn-undo').click();
  await expect(page.locator('.note-marker')).toHaveCount(0);
});

test('nota: el marcador es alcanzable con el ratón (title/aria-label no quedan tapados por pointer-events:none)', async ({ page }) => {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(FIXTURE);
  await expect(page.locator('.run').first()).toBeVisible();

  page.once('dialog', (d) => d.accept('Nota alcanzable'));
  await page.locator('#btn-note').click();
  await page.locator('.page').first().click({ position: { x: 160, y: 175 } });
  const marker = page.locator('.note-marker');
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute('aria-label', 'Nota alcanzable');

  await marker.hover();
  const box = (await marker.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const esElMarcador = await page.evaluate(
    ([x, y]: [number, number]) => document.elementFromPoint(x, y)?.classList.contains('note-marker') ?? false,
    [cx, cy] as [number, number]
  );
  expect(esElMarcador).toBe(true);
});
