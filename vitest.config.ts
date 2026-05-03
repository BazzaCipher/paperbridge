import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx', 'api/**/*.ts'],
      exclude: [
        'src/main.tsx',
        'src/router.tsx',
        'src/**/*.d.ts',
        'src/components/**/*.tsx', // UI components tested separately
        'src/pages/**/*.tsx',
        'src/layouts/**/*.tsx',
        'src/hooks/**/*.ts',       // React hooks need component test harness
        'src/providers/**/*.tsx',   // React providers
        'src/services/aiService.ts', // External API dependency
        'src/services/ai/**/*.ts',   // External API dependency
        'src/core/nodes/registerAll.ts', // React component imports
        'src/core/extraction/ocrExtractor.ts', // External OCR dependency
        'src/blog/**',               // import.meta.glob not testable in vitest
      ],
    },
    setupFiles: ['./src/__tests__/setup.ts'],
  },
})
