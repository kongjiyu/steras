import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), m1TemplateAssets()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, '../shared'),
      },
    },
    server: {
      port: 5173,
      host: true, // expose on LAN for cross-device testing
    },
    define: {
      // Expose build-time env to client. Only VITE_* prefixed vars are exposed.
      __APP_ENV__: JSON.stringify(env.VITE_APP_ENV ?? 'development'),
    },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'vendor-firebase';
            if (id.includes('/chart.js/') || id.includes('/react-chartjs-2/')) return 'vendor-charts';
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router')) return 'vendor-react';
            return undefined;
          },
        },
      },
      chunkSizeWarningLimit: 800,
    },
  };
});

function m1TemplateAssets(): Plugin {
  const repositoryRoot = path.resolve(__dirname, '..');
  const docxRoot = path.join(repositoryRoot, 'docs/templates/m1');
  const previewRoot = path.join(repositoryRoot, 'output/pdf/m1-template-previews');
  const assets = new Map<string, string>();
  let command: 'build' | 'serve' = 'serve';

  for (const sourcePath of walkFiles(docxRoot, '.docx')) {
    assets.set(`/templates/m1/downloads/${path.basename(sourcePath)}`, sourcePath);
  }
  for (const sourcePath of walkFiles(previewRoot, '.pdf')) {
    assets.set(`/templates/m1/previews/${path.basename(sourcePath)}`, sourcePath);
  }

  return {
    name: 'steras-m1-template-assets',
    configResolved(config) {
      command = config.command;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url) return next();
        let pathname: string;
        try {
          pathname = decodeURIComponent(request.url.split('?')[0]);
        } catch {
          return next();
        }
        const sourcePath = assets.get(pathname);
        if (!sourcePath) return next();
        response.statusCode = 200;
        response.setHeader('Content-Type', sourcePath.endsWith('.pdf')
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        response.setHeader('Content-Disposition', sourcePath.endsWith('.pdf')
          ? 'inline'
          : `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(sourcePath))}`);
        fs.createReadStream(sourcePath).pipe(response);
      });
    },
    buildStart() {
      if (command !== 'build') return;
      if (assets.size !== 32) {
        this.error(`Expected 32 M1 template assets (16 DOCX and 16 PDF), found ${assets.size}.`);
      }
      const expectedChecksums = new Map(
        fs.readFileSync(path.join(docxRoot, 'SHA256SUMS'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => {
            const [checksum, ...relativePath] = line.trim().split(/\s+/);
            return [relativePath.join(' '), checksum];
          }),
      );
      for (const sourcePath of walkFiles(docxRoot, '.docx')) {
        // SHA256SUMS uses portable forward-slash paths, while path.relative
        // returns backslashes on Windows.
        const relativePath = path.relative(docxRoot, sourcePath).split(path.sep).join('/');
        const actual = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
        if (expectedChecksums.get(relativePath) !== actual) {
          this.error(`M1 template checksum mismatch: ${relativePath}.`);
        }
      }
      const expectedPreviewChecksums = new Map(
        fs.readFileSync(path.join(previewRoot, 'SHA256SUMS'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => {
            const [checksum, ...fileName] = line.trim().split(/\s+/);
            return [fileName.join(' '), checksum];
          }),
      );
      for (const sourcePath of walkFiles(previewRoot, '.pdf')) {
        const fileName = path.basename(sourcePath);
        const actual = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
        if (expectedPreviewChecksums.get(fileName) !== actual) {
          this.error(`M1 preview checksum mismatch: ${fileName}.`);
        }
      }
      for (const [publicPath, sourcePath] of Array.from(assets.entries())) {
        this.emitFile({
          type: 'asset',
          fileName: publicPath.slice(1),
          source: fs.readFileSync(sourcePath),
        });
      }
    },
  };
}

function walkFiles(root: string, extension: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath, extension) : entry.name.endsWith(extension) ? [fullPath] : [];
  });
}
