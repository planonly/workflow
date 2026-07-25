import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves this repo at https://<user>.github.io/workflow/
// so all built asset paths need that /workflow/ prefix baked in.
export default defineConfig({
  base: '/workflow/',
  plugins: [react(), tailwindcss()],
})
