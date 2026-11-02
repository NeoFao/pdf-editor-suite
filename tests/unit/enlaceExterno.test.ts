import { test, expect } from 'vitest';
import { dominioDe, decidirEnlaceExterno } from '../../src/ui/enlaceExterno';

test('E-116: un host IDN se muestra en punycode, y es el mismo que se abre', () => {
  const d = decidirEnlaceExterno('https://bücher.example/x', new Set());
  expect(d.dominio).toBe('xn--bcher-kva.example');
  expect(d.url).toBe('https://xn--bcher-kva.example/x');
  expect(d.mostrado).toBe(d.url);
});

test('E-116: bidi y control en la ruta se muestran escapados, avisan y la URL abierta va normalizada', () => {
  const d = decidirEnlaceExterno('https://a.test/doc‮gpj.exe', new Set(['a.test']));
  expect(d.conCaracteresOcultos).toBe(true);
  expect(d.accion).toBe('confirmar'); // con caracteres ocultos nunca se omite la pregunta
  expect(d.mostrado).not.toMatch(/[‮]/);
  expect(d.url).not.toMatch(/[‮]/);
  const c = decidirEnlaceExterno('https://a.test/‎x\u0085y⁦', new Set());
  expect(c.conCaracteresOcultos).toBe(true);
  expect(c.mostrado).not.toMatch(/[‎\u0085⁦]/);
});

test('E-116: usuario o contraseña en la URL (https://user@evil.com) la bloquea: sin Abrir', () => {
  for (const u of ['https://user@evil.com', 'https://bank.com:x@evil.com/', 'https://:pw@evil.com']) {
    const d = decidirEnlaceExterno(u, new Set(['evil.com']));
    expect(d.accion).toBe('bloqueado');
    expect(d.motivo).toBe('credenciales');
  }
});

test('E-116: en una URL normal lo mostrado coincide con lo que se abre', () => {
  const d = decidirEnlaceExterno('HTTPS://Ejemplo.TEST:443/a b?x=1#f', new Set());
  expect(d.accion).toBe('confirmar');
  expect(d.mostrado).toBe(d.url);
  expect(d.url).toBe(new URL('HTTPS://Ejemplo.TEST:443/a b?x=1#f').href);
  expect(d.conCaracteresOcultos).toBe(false);
});

// E-116: enlaces externos (/URI) del PDF. La decisión de qué hacer con una URL es lógica pura.

test('dominioDe: host de http(s) y dominio de la dirección en mailto', () => {
  expect(dominioDe('https://Ejemplo.TEST:8443/ruta?x=1')).toBe('ejemplo.test');
  expect(dominioDe('mailto:ana@correo.example?subject=hola')).toBe('correo.example');
  expect(dominioDe('javascript:alert(1)')).toBe('');
});

test('decidirEnlaceExterno: http, https y mailto piden confirmación por defecto', () => {
  for (const u of ['https://a.test/x', 'http://a.test/', 'mailto:a@b.test']) {
    expect(decidirEnlaceExterno(u, new Set()).accion).toBe('confirmar');
  }
});

test('decidirEnlaceExterno: esquemas no permitidos quedan bloqueados, también si el dominio estaba omitido', () => {
  for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<b>x</b>', 'vbscript:x', 'ftp://a.test/', 'pagina.html', '']) {
    expect(decidirEnlaceExterno(u, new Set(['a.test', ''])).accion).toBe('bloqueado');
  }
});

test('decidirEnlaceExterno: un dominio omitido en la sesión se abre sin preguntar; otro dominio sigue preguntando', () => {
  const omitidos = new Set(['a.test']);
  expect(decidirEnlaceExterno('https://a.test/otra', omitidos).accion).toBe('abrir');
  expect(decidirEnlaceExterno('https://b.test/otra', omitidos).accion).toBe('confirmar');
  // Subdominio engañoso: no coincide con el dominio omitido.
  expect(decidirEnlaceExterno('https://a.test.malo.example/', omitidos).accion).toBe('confirmar');
});
