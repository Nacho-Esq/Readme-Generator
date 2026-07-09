import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Estos escenarios combinan varias piezas deterministas del pipeline real
// (escaneo -> inventario -> mapa de repositorio -> presupuesto de tokens -> redacción)
// sobre "repos de mentira" construidos en memoria, para cubrir casos límite completos
// en vez de solo funciones sueltas. La parte que decide el modelo de IA (qué archivos
// selecciona, cómo resuelve contradicciones) queda fuera: aquí solo garantizamos que
// la tubería no se rompe y le entrega al modelo la información correcta.
const fakeFiles = vi.hoisted(() => new Map<string, string>());

vi.mock('vscode', () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  workspace: {
    fs: {
      readFile: async (uri: { fsPath: string }) => {
        const content = fakeFiles.get(uri.fsPath);
        if (content === undefined) {
          throw new Error(`archivo no encontrado: ${uri.fsPath}`);
        }
        return new TextEncoder().encode(content);
      }
    }
  }
}));

import { getReadDepthTokenBudget } from '../config';
import { countRedactions, isEnvFile, redactSecrets } from '../utils/secretRedactor';
import { buildFileInventory, readAllCandidateFiles, splitByTokenBudget } from './fileScanner';
import { analyzeRepository } from './repositoryAnalyzer';
import { CandidateFile } from './types';

const REPO_ROOT = path.sep === '\\' ? 'C:\\repo' : '/repo';

function candidate(relativePath: string, size: number): CandidateFile {
  return { uri: {} as never, relativePath, size };
}

function workspaceFolder(name = 'repo-de-prueba') {
  return { name, uri: { fsPath: REPO_ROOT } as never, index: 0 } as never;
}

beforeEach(() => {
  fakeFiles.clear();
});

describe('Escenario 1: repositorio muy grande (miles de archivos)', () => {
  it('el presupuesto "básico" selecciona una parte razonable sin colgarse ni fallar', async () => {
    const files = Array.from({ length: 3000 }, (_, i) => candidate(`src/module${i}/file.ts`, 2_000));
    const { selectorInventory, discardedSummary } = await buildFileInventory(files);
    expect(selectorInventory).toHaveLength(3000);
    expect(discardedSummary).toEqual([]);

    const budget = getReadDepthTokenBudget('básico');
    const { fitting, overflow } = splitByTokenBudget(selectorInventory, budget);

    expect(fitting.length).toBeGreaterThan(0);
    expect(fitting.length).toBeLessThan(files.length);
    expect(overflow.length).toBe(files.length - fitting.length);
  });

  it('un repositorio grande sigue produciendo un mapa de repositorio consistente (sin duplicar ni perder conteos)', async () => {
    const files = Array.from({ length: 500 }, (_, i) => candidate(`src/area${i % 10}/file${i}.ts`, 1_000));
    const map = await analyzeRepository(files, workspaceFolder());
    expect(map.stats.candidateFiles).toBe(500);
    expect(map.stats.sourceFiles).toBe(500);
    expect(map.modules.reduce((sum, m) => sum + m.fileCount, 0)).toBeGreaterThan(0);
  });
});

describe('Escenario 2: repositorio muy pequeño (1-2 archivos)', () => {
  it('un repo con un único archivo diminuto no falla y cabe entero en cualquier presupuesto', async () => {
    const files = [candidate('index.js', 40)];
    const { selectorInventory } = await buildFileInventory(files);
    const { fitting, overflow } = splitByTokenBudget(selectorInventory, getReadDepthTokenBudget('básico'));
    expect(fitting).toHaveLength(1);
    expect(overflow).toHaveLength(0);

    const map = await analyzeRepository(files, workspaceFolder());
    expect(map.stats.candidateFiles).toBe(1);
  });

  it('un repo vacío de candidatos no rompe el análisis ni el reparto de presupuesto', async () => {
    const map = await analyzeRepository([], workspaceFolder());
    expect(map.stats.candidateFiles).toBe(0);
    expect(map.entrypoints).toEqual([]);

    const { fitting, overflow } = splitByTokenBudget([], getReadDepthTokenBudget('básico'));
    expect(fitting).toEqual([]);
    expect(overflow).toEqual([]);
  });
});

describe('Escenario 3: repositorio lleno de archivos con secretos', () => {
  const secretFiles: Array<[string, string]> = [
    ['.env', 'DB_PASSWORD=hunter2\nAPI_KEY=sk-abcdef123456'],
    ['config/.env.production', 'STRIPE_SECRET=sk_live_abcdef123456789012'],
    ['scripts/deploy.sh', 'export AZURE_CLIENT_SECRET=abcdef123456'],
    ['notes/connection.txt', 'Server=tcp:x;Password=abc123;AccountKey=xyz789;']
  ];

  it('cada archivo sensible queda marcado como .env o produce al menos una redacción', () => {
    for (const [relativePath, content] of secretFiles) {
      const redacted = redactSecrets(content, relativePath);
      const isEnv = isEnvFile(relativePath);
      const redactions = countRedactions(redacted);
      expect(isEnv || redactions > 0).toBe(true);
      // Ninguna redacción significa que el secreto original sigue en el texto: eso sería
      // justo el bug de seguridad que este mecanismo existe para evitar.
      if (!isEnv) {
        expect(redactions).toBeGreaterThan(0);
      }
    }
  });

  it('tras redactar, ningún valor de secreto original sobrevive en el contenido', () => {
    const originalSecrets = ['hunter2', 'sk-abcdef123456', 'sk_live_abcdef123456789012', 'abcdef123456', 'abc123', 'xyz789'];
    for (const [relativePath, content] of secretFiles) {
      const redacted = redactSecrets(content, relativePath);
      for (const secret of originalSecrets) {
        if (content.includes(secret)) {
          expect(redacted).not.toContain(secret);
        }
      }
    }
  });
});

describe('Escenario 4: información contradictoria entre archivos', () => {
  it('el mapa de repositorio conserva AMBAS fuentes de documentación contradictorias, sin descartar ninguna en silencio', async () => {
    const files = [
      candidate('README.md', 200),
      candidate('docs/ARCHITECTURE.md', 200)
    ];
    // README dice que es una librería; ARCHITECTURE dice que es un servicio backend.
    // No es tarea del código determinista "decidir" cuál es correcta (eso lo hace el
    // modelo); lo único que debemos garantizar es que ambas llegan al prompt.
    const map = await analyzeRepository(files, workspaceFolder());
    expect(map.documentation).toEqual(expect.arrayContaining(['README.md', 'docs/ARCHITECTURE.md']));
  });
});

describe('Escenario 5: información faltante o casi vacía', () => {
  it('un archivo con contenido vacío se descarta al leer, en vez de enviarse vacío al modelo', async () => {
    const files = [candidate('index.js', 0)];
    const result = await readAllCandidateFiles(files, 1000, { overrides: new Map([['index.js', '']]) });
    expect(result).toEqual([]);
  });

  it('un repo con un solo archivo de una línea sigue produciendo un mapa de repositorio válido, sin inventar tecnologías ni módulos', async () => {
    const files = [candidate('main.py', 10)];
    const map = await analyzeRepository(files, workspaceFolder());
    expect(map.stats.candidateFiles).toBe(1);
    // Sin requirements.txt/pyproject.toml no hay evidencia suficiente para afirmar
    // "Python": el detector no debe inventar tecnologías a partir de una sola extensión.
    expect(map.technologies).toEqual([]);
    expect(map.modules).toEqual([]);
  });
});

describe('Escenario 6: información excesiva (archivos enormes y repetitivos)', () => {
  it('varios archivos cercanos al máximo permitido activan el mecanismo de overflow en vez de leerlo todo de golpe', () => {
    const hugeFiles = Array.from({ length: 5 }, (_, i) => candidate(`data/dump${i}.json`, 1_900_000));
    const { fitting, overflow } = splitByTokenBudget(hugeFiles, getReadDepthTokenBudget('básico'));
    // Ninguno de estos archivos (≈475k tokens estimados cada uno) cabe en el
    // presupuesto básico (30k tokens): todos deben ir a overflow, no perderse.
    expect(fitting).toEqual([]);
    expect(overflow).toHaveLength(5);
  });

  it('con profundidad "profundo" (180k tokens) cabe más contenido, pero sigue habiendo overflow si hay suficiente volumen', () => {
    const files = Array.from({ length: 50 }, (_, i) => candidate(`data/chunk${i}.json`, 20_000));
    const { fitting, overflow } = splitByTokenBudget(files, getReadDepthTokenBudget('profundo'));
    expect(fitting.length).toBeGreaterThan(0);
    expect(overflow.length).toBeGreaterThan(0);
    expect(fitting.length + overflow.length).toBe(50);
  });
});
