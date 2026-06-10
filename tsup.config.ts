import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
    'react/index': 'src/react/index.tsx',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  shims: true,
});
