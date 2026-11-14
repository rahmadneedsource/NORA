import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import react from '@vitejs/plugin-react';
import auditHandler, { type HttpLikeReq, type HttpLikeRes } from './api/audit';

function getNodeProcess(): { cwd: () => string; env: Record<string, string | undefined> } {
  return (
    globalThis as unknown as {
      process: { cwd: () => string; env: Record<string, string | undefined> };
    }
  ).process;
}

function localAuditProxyPlugin(): Plugin {
  const attachMiddleware = (middlewares: Connect.Server, env: Record<string, string>) => {
    const proc = getNodeProcess();
    for (const [k, v] of Object.entries(env)) {
      if ((k === 'GEMINI_API_KEY' || k === 'OPENAI_API_KEY') && v && !proc.env[k]) {
        proc.env[k] = v;
      }
    }
    middlewares.use('/api/audit', (req, res) => {
      void auditHandler(req as unknown as HttpLikeReq, res as unknown as HttpLikeRes);
    });
  };

  return {
    name: 'nora-local-audit-proxy',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '');
      attachMiddleware(server.middlewares, env);
    },
    configurePreviewServer(server) {
      const env = loadEnv('production', server.config.root, '');
      attachMiddleware(server.middlewares, env);
    },
  };
}

export default defineConfig({
  plugins: [react(), localAuditProxyPlugin()],
  resolve: {
    alias: {
      'onnxruntime-web': path.resolve(
        __dirname,
        'node_modules/onnxruntime-web/dist/ort.all.bundle.min.mjs',
      ),
    },
  },
  build: { target: 'es2022' },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
  server: {
    host: true,
    port: 5176,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 5176,
    strictPort: true,
  },
});
