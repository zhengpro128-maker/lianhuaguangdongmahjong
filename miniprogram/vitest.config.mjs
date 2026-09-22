import { defineConfig } from 'vitest/config'
import path from 'node:path'
export default defineConfig({
  root: path.resolve(import.meta.dirname, '..'),
  test: { include: ['miniprogram/tests/**/*.test.{js,ts}', 'miniprogram/src/**/*.test.{js,ts}'], environment: 'node' },
  define: { 'import.meta.env.BASE_URL': JSON.stringify('./') },
})
