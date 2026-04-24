import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// electron-vite scaffolding mirrors desktop/ (the stealth copilot) so the
// two apps can share a codegen root (frontend/src/api/generated) and a
// future shared/electron-core package. Any divergence here should have a
// reason documented in the README.
//
// Two cross-cutting concerns repeat across main / preload / renderer:
//
//   @generated/*        — proto-generated TS stubs live in the frontend
//                          tree; both desktop/ and hone/ alias the same
//                          directory so one `make gen-proto` updates both.
//
//   @bufbuild/protobuf, — peer packages of the generated code. When a
//   @connectrpc/connect   renderer/main file imports via @generated, Rollup
//                          resolves from the frontend tree and (on CI,
//                          where only hone/node_modules is installed)
//                          can't find these. Force the resolver to point
//                          at hone/node_modules regardless of importer,
//                          and dedupe so Vite's module graph treats the
//                          package as a single instance (guards against
//                          the same nominal-type drift TypeScript sees).
const GEN_ALIAS = {
  '@generated': resolve(__dirname, '../frontend/src/api/generated'),
};
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
        ...GEN_ALIAS,
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
        ...GEN_ALIAS,
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
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        // The renderer is where api/hone.ts lives — without @generated
        // aliased here, Vite's dev server can't resolve the proto stubs
        // and every `⌘K → Stats` path dies on page load.
        ...GEN_ALIAS,
        ...PEER_ALIASES,
      },
      dedupe: PEER_DEDUPE,
    },
    plugins: [react()],
  },
});
