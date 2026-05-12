/// <reference types="vite/client" />

// This file provides Vite's client-side type hints (import.meta.env,
// import.meta.hot, ?url suffix imports, etc.) to the renderer. It's
// split out of tsconfig.json so we don't force Vite's types onto
// every Node-side consumer via the compilerOptions "types" array —
// that array makes TypeScript error out when the package isn't
// installed yet (e.g. on a freshly cloned repo before `npm install`).
export {};
