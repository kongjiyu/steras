import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig(function (_a) {
    var _b;
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), '');
    return {
        plugins: [react()],
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
                    manualChunks: {
                        // Split vendor libs into separate chunks for better caching.
                        'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
                        'vendor-react': ['react', 'react-dom', 'react-router-dom'],
                        'vendor-charts': ['chart.js', 'react-chartjs-2'],
                    },
                },
            },
            chunkSizeWarningLimit: 800,
        },
    };
});
