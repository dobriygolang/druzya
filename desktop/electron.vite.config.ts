import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Vite/Rollup resolves packages relative to the importing file's directory.
// Our proto-generated TS lives in ../frontend/src/api/generated/, aliased in
// as @generated/*. When Rollup follows that import chain on CI (where only
// desktop/node_modules is installed), it walks up from the frontend file
// and never finds @bufbuild/protobuf — the package physically sits in
// desktop/node_modules. Two complementary fixes land here:
//
//   1. Explicit alias for each peer — points the module specifier at
//      desktop/node_modules regardless of which file imported it.
//   2. `dedupe` for the same packages — tells Vite's module graph that all
//      imports of these specifiers should share one copy, guarding against
//      the same nominal-type drift TypeScript sees when both frontend/ and
//      desktop/ have their own node_modules at dev-time.
const PEER_ALIASES = {
  '@bufbuild/protobuf': resolve(__dirname, 'node_modules/@bufbuild/protobuf'),
  '@connectrpc/connect': resolve(__dirname, 'node_modules/@connectrpc/connect'),
  '@connectrpc/connect-web': resolve(__dirname, 'node_modules/@connectrpc/connect-web'),
};
const PEER_DEDUPE = Object.keys(PEER_ALIASES);

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main'),
        // Single codegen source of truth: protoc emits TS stubs into the
        // frontend tree and we alias them from here, so `make gen-proto`
        // updates both frontend and desktop in one shot.
        '@generated': resolve(__dirname, '../frontend/src/api/generated'),
        ...PEER_ALIASES,
      },
      dedupe: PEER_DEDUPE,
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        ...PEER_ALIASES,
      },
      dedupe: PEER_DEDUPE,
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer'),
        ...PEER_ALIASES,
      },
      dedupe: PEER_DEDUPE,
    },
    plugins: [react()],
  },
});
