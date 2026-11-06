// Metro config. The additions only serve the browser dev preview (`pnpm web`):
// expo-sqlite on web loads a wasm build of SQLite and needs SharedArrayBuffer,
// which browsers only expose to cross-origin isolated pages.
const http = require('node:http');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// credentialless (not require-corp) keeps cross-origin fetches and images
// working without each origin sending a CORP header.
const ISOLATION_HEADERS = {
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

let headersPatched = false;

// Expo CLI serves the web index.html from middleware it places ahead of
// Metro's, so a wrapper returned here never sees the page. Patching writeHead
// adds the headers to every dev-server response instead. enhanceMiddleware
// only runs under `expo start`, never during `expo export`.
const patchDevServerHeaders = () => {
  if (headersPatched) return;
  headersPatched = true;
  const writeHead = http.ServerResponse.prototype.writeHead;
  http.ServerResponse.prototype.writeHead = function (...args) {
    for (const [name, value] of Object.entries(ISOLATION_HEADERS)) {
      if (!this.headersSent && !this.hasHeader(name)) this.setHeader(name, value);
    }
    return writeHead.apply(this, args);
  };
};

const enhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, metroServer) => {
  patchDevServerHeaders();
  return enhanceMiddleware ? enhanceMiddleware(middleware, metroServer) : middleware;
};

module.exports = config;
