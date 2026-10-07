import { defineConfig } from 'vitest/config';

// Unitarios de src/ en Node (el motor WASM también arranca en Node).
// globalSetup: regenera los fixtures no versionados (E-052).
export default defineConfig({
  test: {
    environment: 'node',
    // Por defecto vitest 4 lanza nucleos-1 workers (11 aqui) y cada uno carga PDFium (WASM): se pisan la CPU
    // y 2 tests pasan de ~1 s a 8-10 s (suite completa; con vitest 2: 4,4-5,5 s; con 4 workers: 1,4 s y 2,0 s).
    maxWorkers: 4,
    include: ['tests/unit/**/*.test.ts'],
    globalSetup: ['tests/unit/_setup/generar-fixtures.ts']
  }
});
