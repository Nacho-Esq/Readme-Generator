import * as crypto from 'crypto';
import * as vscode from 'vscode';

// Memoria de ranking del repositorio. Es la memoria funcional que permite al
// actualizador reutilizar el ranking previo y detectar, por simple diferencia de
// conjuntos, qué ficheros son nuevos desde la última lectura. Se escribe SIEMPRE,
// tanto al generar como al actualizar.
//
// Vive en el almacenamiento privado de la extensión (`context.storageUri`), NO en
// el repositorio del usuario: recibe ya resuelto el directorio de datos
// (`storageDir`, ver src/storage/extensionStorage.ts) y solo decide el nombre del
// fichero dentro de él.

export interface RankingEntry {
  path: string;
  reason: string;
}

export interface RankingMemory {
  version: number;
  workspaceName: string;
  updatedAt: string;
  mode: 'generate' | 'update';
  // Ficheros seleccionados por el nano, en orden de importancia, con su razón.
  ranking: RankingEntry[];
  // TODOS los ficheros que el nano ha considerado alguna vez (seleccionados +
  // descartados). Acumula entre pasadas: nuevos = inventario actual − seenPaths.
  seenPaths: string[];
  // Hash de contenido por fichero considerado. Permite detectar en la próxima pasada
  // qué ficheros han CAMBIADO (hash distinto), no solo cuáles son nuevos.
  fileHashes: Record<string, string>;
}

// Hash de contenido para detectar cambios (no criptográfico; sha1 basta y es rápido).
export function hashContent(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex');
}

const RANKING_VERSION = 1;
const MEMORY_FILE = 'ranking.json';

function memoryUri(storageDir: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(storageDir, MEMORY_FILE);
}

// Lee la memoria de ranking. Devuelve undefined si no existe, está corrupta o no
// tiene forma válida (para que el llamador haga una pasada completa como fallback).
export async function loadRankingMemory(
  storageDir: vscode.Uri
): Promise<RankingMemory | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(memoryUri(storageDir));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<RankingMemory>;
    if (!parsed || !Array.isArray(parsed.ranking) || !Array.isArray(parsed.seenPaths)) {
      return undefined;
    }
    return {
      version: typeof parsed.version === 'number' ? parsed.version : RANKING_VERSION,
      workspaceName: typeof parsed.workspaceName === 'string' ? parsed.workspaceName : '',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      mode: parsed.mode === 'update' ? 'update' : 'generate',
      ranking: parsed.ranking
        .filter((entry): entry is RankingEntry => Boolean(entry) && typeof entry.path === 'string')
        .map((entry) => ({ path: entry.path, reason: typeof entry.reason === 'string' ? entry.reason : '' })),
      seenPaths: parsed.seenPaths.filter((path): path is string => typeof path === 'string'),
      fileHashes: parseHashes(parsed.fileHashes)
    };
  } catch {
    return undefined;
  }
}

function parseHashes(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (typeof val === 'string') {
        result[key] = val;
      }
    }
  }
  return result;
}

// Escribe la memoria de ranking de forma ATÓMICA (fichero temporal + rename), para
// que un fallo a media escritura no deje la memoria corrupta. `version` y
// `updatedAt` los pone esta función.
export async function saveRankingMemory(
  storageDir: vscode.Uri,
  memory: Omit<RankingMemory, 'version' | 'updatedAt'>
): Promise<void> {
  const fileUri = vscode.Uri.joinPath(storageDir, MEMORY_FILE);
  const tmpUri = vscode.Uri.joinPath(storageDir, `${MEMORY_FILE}.tmp`);

  const full: RankingMemory = {
    version: RANKING_VERSION,
    updatedAt: new Date().toISOString(),
    ...memory
  };
  const bytes = new TextEncoder().encode(JSON.stringify(full, null, 2));

  await vscode.workspace.fs.createDirectory(storageDir);
  await vscode.workspace.fs.writeFile(tmpUri, bytes);
  await vscode.workspace.fs.rename(tmpUri, fileUri, { overwrite: true });
}
