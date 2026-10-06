import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// T16: el spec de paridad de teclado vale solo si NO usa el ratón. Se vigila el propio fichero para que
// nadie "arregle" un fallo del teclado con un clic que oculte que el gesto no existe.
test('teclado-seleccion.spec.ts no usa el ratón (ni page.mouse ni .click())', () => {
  const spec = fs.readFileSync(path.resolve('tests/e2e/next/teclado-seleccion.spec.ts'), 'utf8');
  const codigo = spec.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  expect(codigo).not.toMatch(/\.mouse\b/);
  expect(codigo).not.toMatch(/\.(click|dblclick|dragTo|hover|tap)\s*\(/);
});
