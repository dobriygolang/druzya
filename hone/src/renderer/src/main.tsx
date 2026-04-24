import { createRoot } from 'react-dom/client';

// React namespace is auto-injected via tsconfig "jsx": "react-jsx", so we
// deliberately do NOT `import React` here (an unused import in strict
// mode breaks the build).
import App from './App';
import './styles/globals.css';

// Strict mode is deliberately OFF for the MVP. The ported design uses
// requestAnimationFrame-driven state in <CanvasBg> which double-fires
// under StrictMode's intentional development remount, causing visual
// stutter. We flip it back on once the canvas component is refactored
// to be remount-safe.
const mount = document.getElementById('root');
if (!mount) throw new Error('hone: #root missing');

createRoot(mount).render(<App />);
