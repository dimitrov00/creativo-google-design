import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
} from '@angular/ssr/node';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Security headers per docs/security/csp-baseline.md's target policy. This
 * is the one app in this pass with a real per-request server, so — unlike
 * apps/showcase's static `__CSP_NONCE__` placeholder — the nonce below is
 * genuinely fresh per request, substituted into both the rendered HTML's
 * `ngcspnonce` attribute and this header.
 */
function cspHeader(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function setSecurityHeaders(res: express.Response, nonce: string): void {
  res.setHeader('Content-Security-Policy', cspHeader(nonce));
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload',
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
}

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application, stamping
 * a fresh per-request CSP nonce into both the response header and the
 * `ngcspnonce` placeholder in index.html.
 */
app.use('/**', (req, res, next) => {
  const nonce = randomBytes(16).toString('base64');

  angularApp
    .handle(req)
    .then(async (response) => {
      if (!response) {
        next();
        return;
      }

      const html = await response.text();
      const withNonce = html.replaceAll('__CSP_NONCE__', nonce);

      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'content-length') {
          res.setHeader(key, value);
        }
      });
      setSecurityHeaders(res, nonce);
      res.status(response.status).send(withNonce);
    })
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
