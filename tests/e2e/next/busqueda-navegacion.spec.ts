import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A4 del informe exploratorio: con «Pagina 4» en grande.pdf (500 págs.) la búsqueda contaba coincidencias
// pero no había forma de ir a ellas (ni siguiente/anterior, ni Enter, ni F3) y la vista no se movía.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const GRANDE = path.resolve(AQUI, '../../fixtures/generados/grande.pdf'); // 500 págs. A4, texto "Pagina N"
const ROTADA = path.resolve(AQUI, '../../fixtures/generados/rotada-lineas.pdf'); // págs. con /Rotate 90, 270, 180

async function abrir(page: Page, fichero: string) {
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles(fichero);
  await expect(page.locator('.run').first()).toBeVisible();
}

/** La búsqueda ha terminado cuando el contador deja de decir «Buscando». */
async function esperarFinBusqueda(page: Page) {
  await expect(page.locator('#search-count')).not.toContainText('Buscando');
  await expect(page.locator('#status')).toContainText('coincidencia(s)');
}

/**
 * La caja naranja de la coincidencia actual cae por completo dentro del recuadro del visor.
 * E-091: se mide con `expect.poll` (reintenta hasta que el scroll del salto se asienta y los resaltados
 * se repintan tras un desalojo, E-045) en vez de leer `boundingBox()` una sola vez justo después de `toHaveCount(1)`:
 * esa lectura única podía caer en pleno desplazamiento o sobre una capa de resaltados recién sustituida (null).
 */
async function actualDentroDelVisor(page: Page) {
  const actual = page.locator('.search-hl-current');
  await expect(actual).toHaveCount(1);
  await expect.poll(async () => {
    const b = await actual.boundingBox();
    const v = await page.locator('#viewer').boundingBox();
    if (!b || !v) return 'sin caja';
    const fuera = [
      b.x >= v.x - 1 || 'izquierda',
      b.y >= v.y - 1 || 'arriba',
      b.x + b.width <= v.x + v.width + 1 || 'derecha',
      b.y + b.height <= v.y + v.height + 1 || 'abajo'
    ].filter((r) => r !== true);
    return fuera.length === 0 ? 'dentro' : `fuera por ${fuera.join(',')}`;
  }, { message: 'la caja de la coincidencia actual debe acabar dentro del visor' }).toBe('dentro');
}

const numeroActual = async (page: Page) => Number(((await page.locator('#search-count').textContent()) ?? '').match(/^(\d+) de/)?.[1] ?? 0);
/** Lectura puntual del indicador; para comprobar un destino úsese `paginaEs` (espera). */
const paginaActual = async (page: Page) => Number(((await page.locator('#page-indicator').textContent()) ?? '').split('/')[0]);
const paginaEs = (page: Page, n: number) => expect.poll(() => paginaActual(page), { message: `el indicador debe llegar a la página ${n}` }).toBe(n);
const paginaMayorQue = (page: Page, n: number) => expect.poll(() => paginaActual(page)).toBeGreaterThan(n);

test.describe('navegación de resultados de búsqueda', () => {
  test('grande.pdf: contador con progreso, primera coincidencia visible, Enter/Mayús+Enter, vuelta y F3', async ({ page }) => {
    await abrir(page, GRANDE);
    const campo = page.locator('#btn-search');
    await campo.fill('Pagina 4');

    // El contador muestra el progreso y el número de resultados crece mientras recorre el documento.
    await expect(page.locator('#search-count')).toContainText(/Buscando… \d+\/500 · \d+ resultados?/);
    await esperarFinBusqueda(page);
    const total = Number(((await page.locator('#search-count').textContent()) ?? '').match(/^(\d+) resultados/)?.[1]);
    expect(total).toBeGreaterThan(100);
    await expect(page.locator('#search-count')).toHaveAttribute('aria-live', 'polite');

    // Enter: primera coincidencia, visible, en la página que la contiene.
    await campo.press('Enter');
    await expect(page.locator('#search-count')).toContainText(`1 de ${total}`);
    await actualDentroDelVisor(page);
    await paginaEs(page, 4); // «Pagina 4» está en la página 4
    const pag1 = 4;

    // Siguiente repetido acaba cambiando de página; el actual sigue visible y numerado.
    let n = 1;
    let pag = pag1;
    for (let i = 0; i < 12 && pag === pag1; i++) {
      await page.locator('#btn-search-next').click();
      n++;
      await expect(page.locator('#search-count')).toContainText(`${n} de ${total}`);
      pag = await paginaActual(page);
    }
    expect(pag).toBeGreaterThan(pag1);
    await actualDentroDelVisor(page);

    // Mayús+Enter retrocede.
    await campo.press('Shift+Enter');
    n--;
    await expect(page.locator('#search-count')).toContainText(`${n} de ${total}`);
    await actualDentroDelVisor(page);
    await expect.poll(() => numeroActual(page)).toBe(n);

    // Mayús+Enter desde la primera: da la vuelta al final, con aviso, y la última queda visible.
    while (n > 1) { await page.locator('#btn-search-prev').click(); n--; }
    await expect(page.locator('#search-count')).toContainText(`1 de ${total}`);
    await campo.press('Shift+Enter');
    await expect(page.locator('#search-count')).toContainText(`${total} de ${total}`);
    await expect(page.locator('#search-count')).toContainText('Se volvió al final del documento');
    await actualDentroDelVisor(page);
    await paginaMayorQue(page, 450);

    // Tras la última, Siguiente vuelve al principio con aviso.
    await campo.press('Enter');
    await expect(page.locator('#search-count')).toContainText(`1 de ${total}`);
    await expect(page.locator('#search-count')).toContainText('Se volvió al principio del documento');
    await expect(page.locator('#status')).toContainText('Se volvió al principio del documento');
    await actualDentroDelVisor(page);
    await paginaEs(page, 4);

    // F3 / Mayús+F3 (también con el foco en el visor, fuera del campo).
    await page.locator('#viewer').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F3');
    await expect(page.locator('#search-count')).toContainText(`2 de ${total}`);
    await page.keyboard.press('Shift+F3');
    await expect(page.locator('#search-count')).toContainText(`1 de ${total}`);
    await campo.focus();
    await page.keyboard.press('F3');
    await expect(page.locator('#search-count')).toContainText(`2 de ${total}`);
    await actualDentroDelVisor(page);
  });

  test('Enter mientras se busca salta a la primera coincidencia sin esperar al final del documento', async ({ page }) => {
    await abrir(page, GRANDE);
    const campo = page.locator('#btn-search');
    await campo.fill('Pagina 4');
    await campo.press('Enter'); // aún sin resultados o con la búsqueda en marcha: queda pendiente
    await expect(page.locator('#search-count')).toContainText(/^1 de \d+/);
    await actualDentroDelVisor(page);
    await paginaEs(page, 4);
  });

  test('páginas desalojadas: al volver a una página sus resaltados reaparecen', async ({ page }) => {
    await abrir(page, GRANDE);
    const campo = page.locator('#btn-search');
    await campo.fill('Pagina 4');
    await esperarFinBusqueda(page);
    await campo.press('Enter');
    await expect(page.locator('.page').nth(3).locator('.search-hl')).not.toHaveCount(0);
    // Lejos: la página 4 se desaloja (sin canvas).
    await campo.press('Shift+Enter'); // última, ~pág. 499
    await expect(page.locator('#search-count')).toContainText('Se volvió al final');
    await expect(page.locator('.page').nth(3).locator('canvas')).toHaveCount(0);
    // De vuelta: se repinta y los resaltados (y el actual) reaparecen.
    await campo.press('Enter');
    await expect(page.locator('#search-count')).toContainText(/^1 de/);
    await expect(page.locator('.page').nth(3).locator('canvas')).toHaveCount(1);
    await expect(page.locator('.page').nth(3).locator('.search-hl')).not.toHaveCount(0);
    await expect(page.locator('.page').nth(3).locator('.search-hl-current')).toHaveCount(1);
  });

  test('coherencia con las opciones: el contador cuenta lo mismo que se resalta', async ({ page }) => {
    await abrir(page, GRANDE);
    await page.locator('#btn-replace-toggle').click();
    await page.locator('#opt-case').check();
    await page.locator('#btn-search').fill('PAGINA 4');
    await esperarFinBusqueda(page);
    await expect(page.locator('#search-count')).toHaveText('Sin resultados');
    await expect(page.locator('.search-hl')).toHaveCount(0);
    await page.locator('#opt-case').uncheck();
    await esperarFinBusqueda(page);
    const total = Number(((await page.locator('#search-count').textContent()) ?? '').match(/^(\d+) resultados/)?.[1]);
    expect(total).toBeGreaterThan(100);
  });

  test('rotada-lineas.pdf (/Rotate 90): la coincidencia queda visible y sobre los píxeles de su línea', async ({ page }) => {
    await abrir(page, ROTADA);
    const campo = page.locator('#btn-search');
    await campo.fill('LINEA-3');
    await esperarFinBusqueda(page);
    await campo.press('Enter');
    await expect(page.locator('#search-count')).toContainText(/^1 de 3/);
    await actualDentroDelVisor(page);
    const wrapper = page.locator('.page').nth(0);
    // E-091: el canvas se pinta de forma perezosa; se reintenta hasta que haya píxeles bajo la caja.
    const medir = () => wrapper.evaluate((w) => {
      const canvas = w.querySelector('canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const wr = w.getBoundingClientRect();
      const k = canvas.width / wr.width; // px de canvas por px CSS de página
      const b = w.querySelector('.search-hl-current')!.getBoundingClientRect();
      const x = Math.max(0, Math.round((b.left - wr.left) * k)), y = Math.max(0, Math.round((b.top - wr.top) * k));
      const ancho = Math.min(canvas.width - x, Math.round(b.width * k)), alto = Math.min(canvas.height - y, Math.round(b.height * k));
      const d = ctx.getImageData(x, y, ancho, alto).data;
      let oscuros = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! < 110 && d[i + 1]! < 110 && d[i + 2]! < 110) oscuros++;
      return { oscuros, ancho, alto, dentro: b.left >= wr.left - 1 && b.right <= wr.right + 1 && b.top >= wr.top - 1 && b.bottom <= wr.bottom + 1 };
    });
    await expect.poll(async () => (await medir()).dentro).toBe(true);
    // Texto negro de la línea bajo la caja: una caja mal colocada (sin /Rotate) caería sobre blanco.
    await expect.poll(async () => (await medir()).oscuros).toBeGreaterThan(30);
  });
});

// E-091: la misma navegación programática con la CPU ralentizada (x4), siempre activa. Cubre la carrera entre
// `goToPage`/pin de scroll (E-068), el centrado de la coincidencia (E-067) y el repintado de resaltados tras
// desalojo (E-045) cuando cada paso tarda varias veces más; las aserciones esperan por posición, no por tiempo.
test.describe('navegación de resultados con la CPU ralentizada', () => {
  test.beforeEach(async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  });

  test('salto a la primera, a otra página y vuelta: la actual acaba visible y en su página', async ({ page }) => {
    test.setTimeout(120_000);
    await abrir(page, GRANDE);
    const campo = page.locator('#btn-search');
    await campo.fill('Pagina 4');
    await campo.press('Enter'); // con la búsqueda en marcha: queda pendiente
    await expect(page.locator('#search-count')).toContainText(/^1 de \d+/);
    await actualDentroDelVisor(page);
    await paginaEs(page, 4);
    await esperarFinBusqueda(page);
    await campo.press('Shift+Enter'); // última: salto lejano, la página 4 se desaloja
    await expect(page.locator('#search-count')).toContainText('Se volvió al final');
    await actualDentroDelVisor(page);
    await paginaMayorQue(page, 450);
    await campo.press('Enter'); // de vuelta a la primera, página sin pintar
    await expect(page.locator('#search-count')).toContainText(/^1 de/);
    await actualDentroDelVisor(page);
    await paginaEs(page, 4);
    await expect(page.locator('.page').nth(3).locator('.search-hl-current')).toHaveCount(1);
  });
});
