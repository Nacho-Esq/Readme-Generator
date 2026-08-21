import { describe, expect, it, vi } from 'vitest';

// extensionStorage solo usa vscode.Uri.joinPath para componer la ruta de datos. Lo
// simulamos para poder inspeccionar el segmento (folderKey) que se añade a storageUri.
vi.mock('vscode', () => ({
  Uri: {
    joinPath: (base: { fsPath: string }, segment: string) => ({
      fsPath: `${base.fsPath}/${segment}`,
      segment
    })
  }
}));

import { resolveStorageDir } from './extensionStorage';

interface FakeUri {
  toString(): string;
}

function folder(uriString: string, name: string): { uri: FakeUri; name: string } {
  return { uri: { toString: () => uriString }, name };
}

const context = { storageUri: { fsPath: '/storage', toString: () => 'file:///storage' } } as never;

function keyOf(uriString: string, name: string): string {
  const dir = resolveStorageDir(context, folder(uriString, name) as never) as unknown as { segment: string };
  return dir.segment;
}

describe('resolveStorageDir — namespacing por carpeta objetivo', () => {
  it('devuelve undefined si no hay storageUri (sin workspace)', () => {
    expect(resolveStorageDir({ storageUri: undefined } as never, folder('file:///repo', 'repo') as never)).toBeUndefined();
  });

  it('la raíz y una subcarpeta obtienen espacios de datos DISTINTOS', () => {
    const root = keyOf('file:///repo', 'repo');
    const sub = keyOf('file:///repo/packages/api', 'api');
    expect(root).not.toBe(sub);
  });

  it('dos subcarpetas con el mismo nombre pero distinta URI no colisionan', () => {
    const a = keyOf('file:///repo/services/api', 'api');
    const b = keyOf('file:///repo/legacy/api', 'api');
    expect(a).not.toBe(b);
    // Ambas comparten el nombre legible pero difieren en el hash de la URI.
    expect(a.startsWith('api-')).toBe(true);
    expect(b.startsWith('api-')).toBe(true);
  });

  it('es determinista: la misma carpeta produce siempre la misma clave', () => {
    expect(keyOf('file:///repo/packages/api', 'api')).toBe(keyOf('file:///repo/packages/api', 'api'));
  });

  it('sanea nombres con caracteres no seguros en el segmento legible', () => {
    const key = keyOf('file:///repo/weird name!', 'weird name!');
    expect(key).toMatch(/^weird_name_-[0-9a-f]{12}$/);
  });
});
