// One process serves the API and the web app. In development it mounts Vite; in production it serves dist/.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './api';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api', api);

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

const port = Number(process.env.PORT || 5174);
app.listen(port, () => console.log(`listening on http://localhost:${port}`));
