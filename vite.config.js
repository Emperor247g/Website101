import { defineConfig } from 'vite';

const supabaseConfig = {
  url: process.env.VITE_SUPABASE_URL || '',
  anonKey: process.env.VITE_SUPABASE_ANON_KEY || '',
};

export default defineConfig({
  base: './',
  publicDir: 'public',
  define: {
    __SUPABASE_CONFIG__: JSON.stringify(supabaseConfig),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
