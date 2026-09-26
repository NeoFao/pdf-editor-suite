import { defineConfig } from 'vitest/config';

// Unitarios de src/ en Node (el motor WASM también arranca en Node).
export default defineConfig({
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] }
});
