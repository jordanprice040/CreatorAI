import { defineConfig } from 'vite';
import { serviceConfig } from '@creator/domain';
const config = serviceConfig(process.env);
export default defineConfig({
  server: {
    host: config.host,
    port: config.web_port,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://${config.host}:${config.api_port}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: config.host,
    port: config.web_port,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://${config.host}:${config.api_port}`,
        changeOrigin: true,
      },
    },
  },
});
