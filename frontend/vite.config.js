import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
export default defineConfig(function (_a) {
    var _b;
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), '');
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
            __APP_ENV__: JSON.stringify((_b = env.VITE_APP_ENV) !== null && _b !== void 0 ? _b : 'development'),
        },
        build: {
            outDir: 'dist',
            sourcemap: mode !== 'production',
            rollupOptions: {
                output: {
                    manualChunks: function (id) {
                        if (!id.includes('node_modules'))
                            return undefined;
                        if (id.includes('/firebase/') || id.includes('/@firebase/'))
                            return 'vendor-firebase';
                        if (id.includes('/chart.js/') || id.includes('/react-chartjs-2/'))
                            return 'vendor-charts';
                        if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router'))
                            return 'vendor-react';
                        return undefined;
                    },
                },
            },
            chunkSizeWarningLimit: 800,
        },
    };
});
function m1TemplateAssets() {
    var repositoryRoot = path.resolve(__dirname, '..');
    var docxRoot = path.join(repositoryRoot, 'docs/templates/m1');
    var previewRoot = path.join(repositoryRoot, 'output/pdf/m1-template-previews');
    var assets = new Map();
    var command = 'serve';
    for (var _i = 0, _a = walkFiles(docxRoot, '.docx'); _i < _a.length; _i++) {
        var sourcePath = _a[_i];
        assets.set("/templates/m1/downloads/".concat(path.basename(sourcePath)), sourcePath);
    }
    for (var _b = 0, _c = walkFiles(previewRoot, '.pdf'); _b < _c.length; _b++) {
        var sourcePath = _c[_b];
        assets.set("/templates/m1/previews/".concat(path.basename(sourcePath)), sourcePath);
    }
    return {
        name: 'steras-m1-template-assets',
        configResolved: function (config) {
            command = config.command;
        },
        configureServer: function (server) {
            server.middlewares.use(function (request, response, next) {
                if (!request.url)
                    return next();
                var pathname;
                try {
                    pathname = decodeURIComponent(request.url.split('?')[0]);
                }
                catch (_a) {
                    return next();
                }
                var sourcePath = assets.get(pathname);
                if (!sourcePath)
                    return next();
                response.statusCode = 200;
                response.setHeader('Content-Type', sourcePath.endsWith('.pdf')
                    ? 'application/pdf'
                    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                response.setHeader('Content-Disposition', sourcePath.endsWith('.pdf')
                    ? 'inline'
                    : "attachment; filename*=UTF-8''".concat(encodeURIComponent(path.basename(sourcePath))));
                fs.createReadStream(sourcePath).pipe(response);
            });
        },
        buildStart: function () {
            if (command !== 'build')
                return;
            if (assets.size !== 32) {
                this.error("Expected 32 M1 template assets (16 DOCX and 16 PDF), found ".concat(assets.size, "."));
            }
            var expectedChecksums = new Map(fs.readFileSync(path.join(docxRoot, 'SHA256SUMS'), 'utf8')
                .trim()
                .split('\n')
                .map(function (line) {
                var _a = line.trim().split(/\s+/), checksum = _a[0], relativePath = _a.slice(1);
                return [relativePath.join(' '), checksum];
            }));
            for (var _i = 0, _a = walkFiles(docxRoot, '.docx'); _i < _a.length; _i++) {
                var sourcePath = _a[_i];
                // SHA256SUMS uses portable forward-slash paths, while path.relative
                // returns backslashes on Windows.
                var relativePath = path.relative(docxRoot, sourcePath).split(path.sep).join('/');
                var actual = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
                if (expectedChecksums.get(relativePath) !== actual) {
                    this.error("M1 template checksum mismatch: ".concat(relativePath, "."));
                }
            }
            var expectedPreviewChecksums = new Map(fs.readFileSync(path.join(previewRoot, 'SHA256SUMS'), 'utf8')
                .trim()
                .split('\n')
                .map(function (line) {
                var _a = line.trim().split(/\s+/), checksum = _a[0], fileName = _a.slice(1);
                return [fileName.join(' '), checksum];
            }));
            for (var _b = 0, _c = walkFiles(previewRoot, '.pdf'); _b < _c.length; _b++) {
                var sourcePath = _c[_b];
                var fileName = path.basename(sourcePath);
                var actual = createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
                if (expectedPreviewChecksums.get(fileName) !== actual) {
                    this.error("M1 preview checksum mismatch: ".concat(fileName, "."));
                }
            }
            for (var _d = 0, _e = Array.from(assets.entries()); _d < _e.length; _d++) {
                var _f = _e[_d], publicPath = _f[0], sourcePath = _f[1];
                this.emitFile({
                    type: 'asset',
                    fileName: publicPath.slice(1),
                    source: fs.readFileSync(sourcePath),
                });
            }
        },
    };
}
function walkFiles(root, extension) {
    if (!fs.existsSync(root))
        return [];
    return fs.readdirSync(root, { withFileTypes: true }).flatMap(function (entry) {
        var fullPath = path.join(root, entry.name);
        return entry.isDirectory() ? walkFiles(fullPath, extension) : entry.name.endsWith(extension) ? [fullPath] : [];
    });
}
