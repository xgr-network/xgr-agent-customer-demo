import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { loadConfig } from '../config/env.js';
import { createDemoRouter } from './routes/demoRoutes.js';
import { renderCustomerApiDocsPage } from './customerApiDocsPage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const distDir = path.join(rootDir, 'dist');
const customerApiDocPath = path.join(rootDir, 'demo/docs/customer-integration-api.md');

const config = loadConfig();
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use('/api', createDemoRouter(config));
app.get('/docs/customer-api', (req, res) => {
  try {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(renderCustomerApiDocsPage(customerApiDocPath));
  } catch (error) {
    res.status(500).send(`Could not render customer API guide: ${error.message}`);
  }
});

const indexFile = path.join(distDir, 'index.html');
const assetsDir = path.join(distDir, 'assets');
const hasBuiltWebApp = fs.existsSync(indexFile);

if (process.env.NODE_ENV === 'production' || hasBuiltWebApp) {
  if (!hasBuiltWebApp) {
    throw new Error('Web app build is missing. Run npm run build before starting the production server.');
  }

  // Serve Vite assets only from /assets. Missing assets must be a real 404,
  // not index.html. Otherwise the browser receives HTML for a JS request and
  // the page can look like it loads forever.
  app.use('/assets', express.static(assetsDir, {
    fallthrough: false,
    index: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
      }
      res.setHeader('Cache-Control', 'no-store');
    },
  }));

  app.use(express.static(distDir, {
    index: false,
    fallthrough: true,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store');
    },
  }));

  app.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(indexFile);
  });

  app.get(/^\/(?!api\/|assets\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(indexFile);
  });
} else {
  app.get('/', (_req, res) => {
    res.status(503).send(
      'Web app build is missing. Run npm run build or start the Vite dev server with npm run dev:web.'
    );
  });
}

app.listen(config.port, () => {
  console.log(`xgr_Agent demo server running on port ${config.port} in ${config.mode} mode`);
});
