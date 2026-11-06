import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built game works from any folder or GitHub Pages path
export default defineConfig({
	base: './',
	plugins: [react()],
})
