import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * globalSetup de Vitest: regenera tests/fixtures/generados/ (no versionado)
 * antes de los unitarios, para que `npm run test:unit:src` no lea fixtures
 * ausentes o desactualizados (E-052). El generador es determinista e
 * idempotente; en CI repite lo que ya hizo `test:fixtures` (coste pequeño,
 * a cambio de no depender del orden de los pasos).
 */
export default function setup(): void {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const generador = path.resolve(aqui, '../../fixtures/generar-fixtures.mjs');
  execFileSync(process.execPath, [generador], { stdio: 'inherit' });
}
