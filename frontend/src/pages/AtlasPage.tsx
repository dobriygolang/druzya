// Re-export shim — keeps `import AtlasPage from '../pages/AtlasPage'`
// working after the WAVE-11 split. The real entry lives in
// `pages/atlas/AtlasPage.tsx` together with the surface components
// (canvas-legacy, drawer, filters, list-mode, zoom-controls).

export { default } from './atlas/AtlasPage'
