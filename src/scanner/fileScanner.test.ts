import { describe, expect, it, vi } from 'vitest';

// fileScanner.ts importa `vscode` para scanRepository/readRawContent (I/O real de disco).
// Aquí solo probamos las funciones puras (splitByTokenBudget, estimateTokens,
// buildFileInventory, readAllCandidateFiles con overrides/exclude), así que basta
// con un doble vacío para que el módulo se pueda importar fuera de VS Code.
vi.mock('vscode', () => ({}));

import { buildFileInventory, estimateTokens, readAllCandidateFiles, splitByTokenBudget } from './fileScanner';
import { CandidateFile } from './types';

function candidate(relativePath: string, size: number): CandidateFile {
  return { uri: {} as never, relativePath, size };
}

describe('estimateTokens', () => {
  it('estima 1 token cada 4 caracteres, redondeando hacia arriba', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('splitByTokenBudget', () => {
  it('reparte archivos entre "fitting" y "overflow" según el presupuesto de tokens', () => {
    // 4 bytes ~ 1 token estimado (size/4). Presupuesto de 2 tokens.
    const files = [candidate('a.ts', 4), candidate('b.ts', 4), candidate('c.ts', 4)];
    const { fitting, overflow } = splitByTokenBudget(files, 2);
    expect(fitting.map((f) => f.relativePath)).toEqual(['a.ts', 'b.ts']);
    expect(overflow.map((f) => f.relativePath)).toEqual(['c.ts']);
  });

  it('un archivo que no cabe no "gasta" presupuesto: los siguientes más pequeños pueden seguir colando', () => {
    const files = [candidate('grande.ts', 4000), candidate('pequeno.ts', 4)];
    const { fitting, overflow } = splitByTokenBudget(files, 1);
    // grande.ts (1000 tokens estimados) no cabe en el presupuesto de 1 token y va a
    // overflow, pero como no cupo, NO incrementa el contador de tokens usados. Por eso
    // pequeno.ts (1 token) sí que cabe después. Esto es relevante para diagnosticar el
    // caso real de "el modelo grande solo lee pocos archivos": un único archivo enorme
    // al principio del ranking no bloquea por sí solo a los archivos pequeños que le siguen.
    expect(fitting.map((f) => f.relativePath)).toEqual(['pequeno.ts']);
    expect(overflow.map((f) => f.relativePath)).toEqual(['grande.ts']);
  });

  it('con presupuesto 0 o archivos vacíos, no falla y no mete nada en fitting', () => {
    const { fitting, overflow } = splitByTokenBudget([candidate('a.ts', 100)], 0);
    expect(fitting).toEqual([]);
    expect(overflow).toHaveLength(1);
  });

  it('con una lista vacía de archivos, ambos resultados quedan vacíos', () => {
    const { fitting, overflow } = splitByTokenBudget([], 100_000);
    expect(fitting).toEqual([]);
    expect(overflow).toEqual([]);
  });

  it('caso realista: con presupuesto básico (30k tokens) y muchos archivos medianos, no deja pasar a todos', () => {
    // 40 archivos de ~5000 bytes (~1250 tokens cada uno) -> caben ~24, el resto a overflow.
    const files = Array.from({ length: 40 }, (_, i) => candidate(`file${i}.ts`, 5000));
    const { fitting, overflow } = splitByTokenBudget(files, 30_000);
    expect(fitting.length).toBeGreaterThan(0);
    expect(fitting.length).toBeLessThan(40);
    expect(fitting.length + overflow.length).toBe(40);
  });
});

describe('buildFileInventory', () => {
  it('separa del inventario los lockfiles conocidos', async () => {
    const { selectorInventory, discardedSummary } = await buildFileInventory([
      candidate('package-lock.json', 100),
      candidate('pnpm-lock.yaml', 100),
      candidate('src/index.ts', 100)
    ]);
    expect(selectorInventory.map((f) => f.relativePath)).toEqual(['src/index.ts']);
    expect(discardedSummary.find((d) => d.reason === 'lockfile')?.count).toBe(2);
  });

  it('descarta la propia salida previa del generador (readme.generated.md)', async () => {
    const { selectorInventory, discardedSummary } = await buildFileInventory([
      candidate('README.generated.md', 100),
      candidate('README.md', 100)
    ]);
    expect(selectorInventory.map((f) => f.relativePath)).toEqual(['README.md']);
    expect(discardedSummary.find((d) => d.reason === 'salida previa del generador')?.count).toBe(1);
  });

  it('descarta fixtures/snapshots de test y archivos minificados/bundle', async () => {
    const { selectorInventory, discardedSummary } = await buildFileInventory([
      candidate('src/__snapshots__/a.snap', 10),
      candidate('test/fixtures/sample.json', 10),
      candidate('dist/app.min.js', 10),
      candidate('dist/vendor.bundle.js', 10),
      candidate('src/real.ts', 10)
    ]);
    expect(selectorInventory.map((f) => f.relativePath)).toEqual(['src/real.ts']);
    // discardedSummary agrupa por motivo (no un elemento por archivo descartado).
    const byReason = Object.fromEntries(discardedSummary.map((d) => [d.reason, d.count]));
    expect(byReason).toEqual({ 'test fixture or snapshot': 2, 'minified or bundled asset': 2 });
  });

  it('cuando no hay nada que descartar, discardedSummary queda vacío', async () => {
    const { selectorInventory, discardedSummary } = await buildFileInventory([candidate('src/index.ts', 10)]);
    expect(selectorInventory).toHaveLength(1);
    expect(discardedSummary).toEqual([]);
  });
});

describe('readAllCandidateFiles', () => {
  it('usa el contenido de "overrides" en vez de leer del disco', async () => {
    const files = [candidate('a.ts', 10)];
    const result = await readAllCandidateFiles(files, 1000, {
      overrides: new Map([['a.ts', 'contenido redactado']])
    });
    expect(result).toEqual([{ ...files[0], content: 'contenido redactado', truncated: false }]);
  });

  it('si el override es una cadena vacía, el archivo se descarta', async () => {
    const files = [candidate('a.ts', 10)];
    const result = await readAllCandidateFiles(files, 1000, {
      overrides: new Map([['a.ts', '']])
    });
    expect(result).toEqual([]);
  });

  it('excluye los archivos marcados en "exclude", sin intentar leerlos', async () => {
    const files = [candidate('secreto.env', 10), candidate('normal.ts', 10)];
    const result = await readAllCandidateFiles(files, 1000, {
      exclude: new Set(['secreto.env']),
      overrides: new Map([['normal.ts', 'contenido']])
    });
    expect(result.map((f) => f.relativePath)).toEqual(['normal.ts']);
  });

  it('devuelve una lista vacía si no hay archivos', async () => {
    const result = await readAllCandidateFiles([], 1000);
    expect(result).toEqual([]);
  });
});
