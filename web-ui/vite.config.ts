import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

// Dev (recomendado): mismo-origen vía proxy, SIN CORS ni cookies de 3ros.
//   npm run dev                      -> backend en http://127.0.0.1:3923
//   CPR_TARGET=http://127.0.0.1:9999 npm run dev   -> otro puerto
// Con proxy, deja VITE_CPR_BASE vacío (same-origin); el proxy reenvía al backend.
//
// Dev directo cross-origin: NO soporta login (la cookie HttpOnly SameSite=Lax
// nunca vuelve en fetch cross-site). Solo para listados anónimos/shares.
//   VITE_CPR_BASE=http://127.0.0.1:3923
// Para login usa siempre el proxy mismo-origen.
//
// Prod: build estático servido en mismo origen (/.cpr/n/ o reverse-proxy); base relativa.
const target = process.env.CPR_TARGET || 'http://127.0.0.1:3923';

// Nota vite 8: el matcher regex ve req.url COMPLETA (con query), y
// bypass:false responde 404 (NO salta a vite). Para "dejar pasar a vite"
// hay que devolver string (reescribe url y sigue al siguiente middleware).
const VITE_EXACT = new Set(['/', '/index.html', '/favicon.ico']);
const VITE_PREFIX = ['/src/', '/@vite', '/@react-refresh', '/node_modules/', '/assets/', '/.well-known/'];

export default defineConfig({
  plugins: [preact()],
  base: './',
  server: {
    proxy: {
      '^/.*': {
        target,
        // changeOrigin:false a propósito: copyparty compara Origin contra Host
        // (httpcli.py:_cors) y rechaza el POST si no coinciden; con el Host
        // original (localhost:5173) el Origin cuadra y el login funciona.
        changeOrigin: false,
        // los Set-Cookie del backend (cppwd/cppws) deben quedarse en el host del dev-server
        cookieDomainRewrite: 'localhost',
        bypass(req: any) {
          const url: string = req.url || '/';
          // vite dev no tiene assets no-GET: todo POST/PUT/DELETE es backend
          // (login act=login a `/`, handshake up2k, chunks, ?move/?copy/?delete)
          if (req.method && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') return undefined;
          const path = url.split('?')[0];
          // /?ls, /?srch, ... (query en raíz) son API del backend, no la app
          if (path === '/' && url.includes('?')) return undefined;
          const isVite =
            VITE_EXACT.has(path) || VITE_PREFIX.some((p) => path.startsWith(p));
          // string = lo sirve vite; undefined = proxy al backend
          return isVite ? url : undefined;
        },
      } as any,
    },
  },
})
