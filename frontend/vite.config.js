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
