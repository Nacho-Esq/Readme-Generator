import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Aislamiento estricto: los ficheros de test comparten el singleton de la
    // plantilla (initTemplateSpec). Ejecutarlos en paralelo provocaba fallos
    // intermitentes por interferencia entre ficheros. Secuencial + aislado los
    // hace deterministas.
    isolate: true,
    fileParallelism: false
  }
});
