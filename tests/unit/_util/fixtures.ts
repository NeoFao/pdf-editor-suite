import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(AQUI, '../../fixtures/generados');

/** Bytes de un fixture generado por `tests/fixtures/generar-fixtures.mjs`. */
export function fixture(nombre: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURES, nombre)));
}
