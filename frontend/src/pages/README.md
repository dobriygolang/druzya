# Pages

All page components in this directory are loaded **lazily** via `React.lazy()`
in `src/App.tsx`. This keeps the initial JS bundle small — each route's code
is fetched only when a user navigates to it.

## Adding a new page

1. Create `src/pages/MyNewPage.tsx` with a **default export** (required by
   `React.lazy`):

   ```tsx
   export default function MyNewPage() {
     return <div>...</div>
   }
   ```

2. Register it in `src/App.tsx`:

   ```tsx
   const MyNewPage = lazy(() => import('./pages/MyNewPage'))

   // inside <Routes>:
   <Route path="/my-new-page" element={<MyNewPage />} />
   ```

3. Do **not** add a static `import MyNewPage from './pages/MyNewPage'` — that
   would pull the page into the initial bundle and defeat code splitting.

The `<Suspense fallback={<RouteLoader />}>` boundary in `App.tsx` shows a
spinner while the chunk is being fetched.

## Bundle splitting

Vendor code is split into named chunks via `manualChunks` in
`vite.config.ts`: `react`, `query`, `icons`, `i18n`, and a default `vendor`
chunk for the rest of `node_modules`. Each page becomes its own chunk
automatically because of the dynamic `import()` in `lazy()`.
