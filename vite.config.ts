import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // GitHub Pages publica este repositório em /PandasFc/.
  // Builds locais/Android continuam usando caminhos relativos.
  base: mode === 'github' ? '/PandasFc/' : './',
}));
