import { defineConfig } from 'vitest/config';

// Unitarios de src/ en Node (el motor WASM también arranca en Node).
// globalSetup: regenera los fixtures no versionados (E-052).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    globalSetup: ['tests/unit/_setup/generar-fixtures.ts']
  }
});
