import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // As telas dos módulos ficam em outros pacotes do monorepo: garante uma única cópia destas libs.
    dedupe: ['react', 'react-dom', '@tanstack/react-query'],
  },
  server: {
    port: 5173,
    // Mesma origem para o cookie de refresh (SameSite=Strict). Em produção, o CloudFront faz o mesmo papel.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
