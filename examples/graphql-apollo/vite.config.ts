import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // eco-faker/apollo declares @apollo/client and @apollo/client/link/schema
  // as *optional* peer dependencies. When eco-faker is a symlinked local/
  // workspace package (file:), Vite's dependency scanner treats those
  // imports as belonging to a different package than the one this app
  // installed and fails to resolve them at build time. Forcing them into
  // the pre-bundle explicitly fixes it.
  optimizeDeps: {
    include: ["@apollo/client", "@apollo/client/react", "@apollo/client/link/schema"],
  },
  resolve: {
    preserveSymlinks: true,
  },
})
