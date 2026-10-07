import { defineConfig } from 'vitest/config';

// Unitarios de src/ en Node (el motor WASM también arranca en Node).
// globalSetup: regenera los fixtures no versionados (E-052).
export default defineConfig({
  test: {
    environment: 'node',
    // vitest 4 lanza más workers en paralelo; los tests con WASM de PDFium rozaban los 5 s por defecto bajo carga.
    testTimeout: 20000,
    include: ['tests/unit/**/*.test.ts'],
    globalSetup: ['tests/unit/_setup/generar-fixtures.ts']
  }
});
