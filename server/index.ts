// One process serves the API and the web app. In development it mounts Vite; in production it serves dist/.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api';
import { createBidBoard } from './bids';
import { createLeadBook } from './leads';
import { createPriceFeed } from './prices';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A local .env (git-ignored) may hold AI_API_KEY, AI_MODEL, AI_BASE_URL, ADMIN_TOKEN and STRIPE_SECRET_KEY. When hosted they come from the host.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

// What the server remembers between restarts lives in data/ (git-ignored): price ticks, visitors' bids, requests.
const data = (name: string) => path.join(root, 'data', name);
const prices = createPriceFeed({ file: data('ticks.json') });
const api = createApi({
  prices,
  bids: createBidBoard({ file: data('bids.json') }),
  leads: createLeadBook({ file: data('leads.json') }),
  adminToken: process.env.ADMIN_TOKEN || undefined,
  stripeKey: process.env.STRIPE_SECRET_KEY || undefined,
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // one proxy in front when hosted, so the per-address limits see the visitor's address
app.use('/api', api);     // the router reads JSON bodies itself, up to 2 MB

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

void prices.start(); // fetch H100 prices now, then every minute

const port = Number(process.env.PORT || 5174);
app.listen(port, () => console.log(`listening on http://localhost:${port}`));
