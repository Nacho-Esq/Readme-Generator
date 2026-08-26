import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// repositoryAnalyzer.ts solo usa `vscode` para leer package.json del disco
// (vscode.Uri.file + vscode.workspace.fs.readFile). Simulamos un "disco" en memoria
// para poder controlar exactamente qué contenido "existe" en cada test.
const fakeFiles = vi.hoisted(() => new Map<string, string>());

vi.mock('vscode', () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath })
  },
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

import { analyzeRepository } from './repositoryAnalyzer';
import { CandidateFile } from './types';

const REPO_ROOT = path.sep === '\\' ? 'C:\\repo' : '/repo';

function candidate(relativePath: string, size = 100): CandidateFile {
  return { uri: {} as never, relativePath, size };
}

function workspaceFolder(name = 'mi-repo') {
  return { name, uri: { fsPath: REPO_ROOT } as never, index: 0 } as never;
}

function setPackageJson(deps: Record<string, string> = {}) {
  fakeFiles.set(path.join(REPO_ROOT, 'package.json'), JSON.stringify({ dependencies: deps }));
}

beforeEach(() => {
  fakeFiles.clear();
});

describe('analyzeRepository: estadísticas', () => {
  it('cuenta archivos candidatos, fuente, documentación y bytes totales', async () => {
    const map = await analyzeRepository(
      [candidate('src/index.ts', 100), candidate('src/app.py', 50), candidate('README.md', 20), candidate('img/logo.png', 30)],
      workspaceFolder()
    );
    expect(map.stats).toEqual({
      candidateFiles: 4,
      sourceFiles: 2,
      documentationFiles: 1,
      totalBytes: 200
    });
  });

  it('usa el nombre del workspace recibido', async () => {
    const map = await analyzeRepository([], workspaceFolder('mi-app-especial'));
    expect(map.workspaceName).toBe('mi-app-especial');
  });

  it('conserva el discardedSummary que se le pasa tal cual', async () => {
    const discarded = [{ reason: 'lockfile', count: 1, examples: ['package-lock.json'], stage: 'local' as const }];
    const map = await analyzeRepository([], workspaceFolder(), discarded);
    expect(map.discardedSummary).toBe(discarded);
  });
});

describe('analyzeRepository: detección de tecnologías', () => {
  it('detecta Node.js si hay package.json', async () => {
    setPackageJson();
    const map = await analyzeRepository([candidate('package.json')], workspaceFolder());
    expect(map.technologies.map((t) => t.name)).toContain('Node.js');
  });

  it('detecta TypeScript si hay tsconfig.json, aunque no esté en dependencies', async () => {
    setPackageJson();
    const map = await analyzeRepository(
      [candidate('package.json'), candidate('tsconfig.json')],
      workspaceFolder()
    );
    expect(map.technologies.map((t) => t.name)).toContain('TypeScript');
  });

  it('detecta React si está en las dependencias de package.json', async () => {
    setPackageJson({ react: '^18.0.0' });
    const map = await analyzeRepository([candidate('package.json')], workspaceFolder());
    expect(map.technologies.map((t) => t.name)).toContain('React');
  });

  it('detecta Python si hay requirements.txt o pyproject.toml', async () => {
    const map = await analyzeRepository([candidate('requirements.txt')], workspaceFolder());
    expect(map.technologies.map((t) => t.name)).toContain('Python');
  });

  it('detecta Docker y GitHub Actions por presencia de archivos característicos', async () => {
    const map = await analyzeRepository(
      [candidate('Dockerfile'), candidate('.github/workflows/ci.yml')],
      workspaceFolder()
    );
    const names = map.technologies.map((t) => t.name);
    expect(names).toContain('Docker');
    expect(names).toContain('GitHub Actions');
  });

  it('si no hay package.json, no lo intenta leer y no detecta Node.js', async () => {
    const map = await analyzeRepository([candidate('index.py')], workspaceFolder());
    expect(map.technologies.map((t) => t.name)).not.toContain('Node.js');
  });
});

describe('analyzeRepository: entrypoints', () => {
  it('reconoce nombres de entrypoint habituales por su nombre de archivo', async () => {
    const map = await analyzeRepository(
      [candidate('src/main.ts'), candidate('src/utils.ts'), candidate('server.js')],
      workspaceFolder()
    );
    expect(map.entrypoints).toEqual(['server.js', 'src/main.ts']);
  });

  it('reconoce src/extension.ts como entrypoint especial de extensión de VS Code', async () => {
    const map = await analyzeRepository([candidate('src/extension.ts')], workspaceFolder());
    expect(map.entrypoints).toContain('src/extension.ts');
  });
});

describe('analyzeRepository: módulos y documentación', () => {
  it('agrupa archivos bajo carpetas importantes conocidas (src, docs, infra...)', async () => {
    const map = await analyzeRepository(
      [candidate('src/a/one.ts'), candidate('src/a/two.ts'), candidate('docs/guide.md')],
      workspaceFolder()
    );
    const srcModule = map.modules.find((m) => m.path === 'src/a');
    expect(srcModule?.fileCount).toBe(2);
    expect(srcModule?.kind).toBe('source');
    expect(map.modules.find((m) => m.path === 'docs')?.kind).toBe('docs');
  });

  it('no crea módulo para carpetas que no están en la lista de carpetas importantes', async () => {
    const map = await analyzeRepository([candidate('random/whatever.ts')], workspaceFolder());
    expect(map.modules.find((m) => m.path.startsWith('random'))).toBeUndefined();
  });

  it('detecta documentación: README.md, docs/ y archivos con "architecture" en el nombre', async () => {
    const map = await analyzeRepository(
      [candidate('README.md'), candidate('docs/setup.md'), candidate('ARCHITECTURE.md'), candidate('otro.md')],
      workspaceFolder()
    );
    expect(map.documentation).toEqual(expect.arrayContaining(['README.md', 'docs/setup.md', 'ARCHITECTURE.md']));
    expect(map.documentation).not.toContain('otro.md');
  });
});
