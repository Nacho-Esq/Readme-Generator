import { beforeEach, describe, expect, it, vi } from 'vitest';

// Estado del "disco" y del editor en memoria, controlado por cada test. vi.hoisted
// porque el factory de vi.mock se evalúa antes que el cuerpo del fichero.
const state = vi.hoisted(() => ({
  workspaceFolders: [] as Array<{ uri: FakeUri; name: string; index: number }>,
  // fsPath -> lista de [nombre, tipo] (tipo 2 = Directory, 1 = File)
  dirs: new Map<string, Array<[string, number]>>(),
  // fsPath de directorios que existen (para stat)
  directories: new Set<string>(),
  quickPickImpl: undefined as undefined | ((items: any[]) => any),
  quickPickCalls: 0,
  errors: [] as string[]
}));

interface FakeUri {
  fsPath: string;
  toString(): string;
}

function fakeUri(fsPath: string): FakeUri {
  return { fsPath, toString: () => `file://${fsPath}` };
}

vi.mock('vscode', () => ({
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  Uri: {
    joinPath: (base: FakeUri, ...segments: string[]) => fakeUri([base.fsPath, ...segments].join('/'))
  },
  workspace: {
    get workspaceFolders() {
      return state.workspaceFolders.length ? state.workspaceFolders : undefined;
    },
    fs: {
      stat: async (uri: FakeUri) => {
        if (state.directories.has(uri.fsPath)) {
          return { type: 2 };
        }
        if (state.dirs.has(uri.fsPath)) {
          return { type: 2 };
        }
        return { type: 1 };
      },
      readDirectory: async (uri: FakeUri) => {
        const entries = state.dirs.get(uri.fsPath);
        if (!entries) {
          throw new Error(`no existe: ${uri.fsPath}`);
        }
        return entries;
      }
    }
  },
  window: {
    showErrorMessage: (msg: string) => {
      state.errors.push(msg);
      return Promise.resolve(undefined);
    },
    showQuickPick: (items: any[]) => {
      state.quickPickCalls += 1;
      const impl = state.quickPickImpl ?? (() => undefined);
      return Promise.resolve(impl(items));
    }
  }
}));

import {
  isIgnoredSubfolder,
  isProjectMarkerFile,
  makeTargetFolder,
  resolveTargetFolders,
  selectRelevantSubfolders
} from './targetFolder';

const D = 2; // Directory
const F = 1; // File

function workspace(name: string, fsPath: string) {
  return { uri: fakeUri(fsPath), name, index: 0 };
}

beforeEach(() => {
  state.workspaceFolders = [];
  state.dirs = new Map();
  state.directories = new Set();
  state.quickPickImpl = undefined;
  state.quickPickCalls = 0;
  state.errors = [];
});

describe('isProjectMarkerFile', () => {
  it('reconoce manifiestos de proyecto conocidos, insensible a mayúsculas', () => {
    expect(isProjectMarkerFile('package.json')).toBe(true);
    expect(isProjectMarkerFile('Package.json')).toBe(true);
    expect(isProjectMarkerFile('pom.xml')).toBe(true);
    expect(isProjectMarkerFile('Makefile')).toBe(true);
    expect(isProjectMarkerFile('requirements.txt')).toBe(true);
  });

  it('reconoce proyectos por extensión (.NET)', () => {
    expect(isProjectMarkerFile('Api.csproj')).toBe(true);
    expect(isProjectMarkerFile('Solution.sln')).toBe(true);
  });

  it('no confunde ficheros normales con marcadores', () => {
    expect(isProjectMarkerFile('index.ts')).toBe(false);
    expect(isProjectMarkerFile('notas.txt')).toBe(false);
    expect(isProjectMarkerFile('README.md')).toBe(false);
  });
});

describe('isIgnoredSubfolder', () => {
  it('ignora dependencias/artefactos/metadatos', () => {
    expect(isIgnoredSubfolder('node_modules')).toBe(true);
    expect(isIgnoredSubfolder('.git')).toBe(true);
    expect(isIgnoredSubfolder('dist')).toBe(true);
  });
  it('no ignora carpetas de código normales', () => {
    expect(isIgnoredSubfolder('src')).toBe(false);
    expect(isIgnoredSubfolder('packages')).toBe(false);
  });
});

describe('selectRelevantSubfolders', () => {
  it('selecciona solo subcarpetas con marcador de proyecto, ignora artefactos y ordena', () => {
    const result = selectRelevantSubfolders([
      { name: 'web', entries: ['pom.xml', 'src'] },
      { name: 'docs', entries: ['intro.md'] },
      { name: 'api', entries: ['package.json', 'src'] },
      { name: 'node_modules', entries: ['package.json'] }
    ]);
    expect(result).toEqual(['api', 'web']);
  });

  it('sin subcarpetas relevantes devuelve lista vacía', () => {
    expect(selectRelevantSubfolders([{ name: 'assets', entries: ['logo.png'] }])).toEqual([]);
  });
});

describe('makeTargetFolder', () => {
  it('toma el nombre del basename de la URI y no es una carpeta de workspace real', () => {
    const folder = makeTargetFolder(fakeUri('/repo/packages/api') as never);
    expect(folder.name).toBe('api');
    expect(folder.index).toBe(0);
    expect(folder.uri.fsPath).toBe('/repo/packages/api');
  });
});

describe('resolveTargetFolders', () => {
  it('menú contextual sobre una carpeta: la usa directamente, sin preguntar', async () => {
    state.directories.add('/repo/packages/api');
    const targets = await resolveTargetFolders(fakeUri('/repo/packages/api') as never);
    expect(targets?.map((t) => t.name)).toEqual(['api']);
    expect(state.quickPickCalls).toBe(0);
  });

  it('menú contextual sobre un archivo (no carpeta): error y sin objetivo', async () => {
    const targets = await resolveTargetFolders(fakeUri('/repo/README.md') as never);
    expect(targets).toBeUndefined();
    expect(state.errors.length).toBe(1);
  });

  it('sin carpetas de workspace: error y sin objetivo', async () => {
    const targets = await resolveTargetFolders(undefined);
    expect(targets).toBeUndefined();
    expect(state.errors.length).toBe(1);
  });

  it('una sola candidata (sin subproyectos): no pregunta', async () => {
    state.workspaceFolders = [workspace('repo', '/repo')];
    state.dirs.set('/repo', [['src', D], ['README.md', F]]);
    state.dirs.set('/repo/src', [['index.ts', F]]);
    const targets = await resolveTargetFolders(undefined);
    expect(targets?.map((t) => t.name)).toEqual(['repo']);
    expect(state.quickPickCalls).toBe(0);
  });

  it('varias candidatas (raíz + subproyectos): pregunta y "Todas" las devuelve todas', async () => {
    state.workspaceFolders = [workspace('monorepo', '/monorepo')];
    state.dirs.set('/monorepo', [['api', D], ['web', D], ['docs', D], ['node_modules', D]]);
    state.dirs.set('/monorepo/api', [['package.json', F]]);
    state.dirs.set('/monorepo/web', [['pom.xml', F]]);
    state.dirs.set('/monorepo/docs', [['intro.md', F]]);
    state.dirs.set('/monorepo/node_modules', [['package.json', F]]);
    state.quickPickImpl = (items) => items.find((i) => i.all);

    const targets = await resolveTargetFolders(undefined);
    expect(state.quickPickCalls).toBe(1);
    expect(targets?.map((t) => t.name).sort()).toEqual(['api', 'monorepo', 'web']);
  });

  it('varias candidatas: elegir una concreta devuelve solo esa', async () => {
    state.workspaceFolders = [workspace('monorepo', '/monorepo')];
    state.dirs.set('/monorepo', [['api', D], ['web', D]]);
    state.dirs.set('/monorepo/api', [['package.json', F]]);
    state.dirs.set('/monorepo/web', [['go.mod', F]]);
    state.quickPickImpl = (items) => items.find((i) => i.folder && i.folder.name === 'web');

    const targets = await resolveTargetFolders(undefined);
    expect(targets?.map((t) => t.name)).toEqual(['web']);
  });

  it('varias candidatas pero el usuario cancela el QuickPick: sin objetivo', async () => {
    state.workspaceFolders = [workspace('monorepo', '/monorepo')];
    state.dirs.set('/monorepo', [['api', D], ['web', D]]);
    state.dirs.set('/monorepo/api', [['package.json', F]]);
    state.dirs.set('/monorepo/web', [['go.mod', F]]);
    state.quickPickImpl = () => undefined; // cancela

    const targets = await resolveTargetFolders(undefined);
    expect(targets).toBeUndefined();
  });
});
