// One process serves the API and the web app. In development it mounts Vite; in production it serves dist/.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, prices } from './api';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // one proxy in front when hosted, so the per-address limit sees the visitor's address
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
