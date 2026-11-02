import { test, expect } from '@playwright/test';

/**
 * E-120: si algo falla durante una conversión (p. ej. «RuntimeError: unreachable» del motor), la interfaz debe terminar
 * con un mensaje de error en `#status`, nunca quedarse en «Convirtiendo…». El fallo se fuerza desde el navegador: el
 * decodificador de texto lanza el error del motor cuando recibe el contenido centinela.
 */
test('un fallo inesperado del conversor termina con un mensaje de error y no deja «Convirtiendo…»', async ({ page }) => {
  await page.addInitScript(() => {
    const decode = TextDecoder.prototype.decode;
    TextDecoder.prototype.decode = function (entrada?: BufferSource, opciones?: TextDecodeOptions): string {
      const texto = decode.call(this, entrada, opciones);
      if (texto === 'FALLO-DEL-MOTOR') throw new Error('RuntimeError: unreachable');
      return texto;
    };
  });
  await page.goto('/index.next.html');
  await page.locator('#file-input').setInputFiles({ name: 'roto.md', mimeType: 'text/markdown', buffer: Buffer.from('FALLO-DEL-MOTOR') });
  const estado = page.locator('#status');
  await expect(estado).toContainText('No se pudo convertir');
  await expect(estado).toContainText('roto.md');
  await expect(estado).not.toContainText('Convirtiendo');
});
