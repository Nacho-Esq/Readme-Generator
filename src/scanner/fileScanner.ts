import * as path from 'path';
import * as vscode from 'vscode';
import { CandidateFile, DiscardedFileSummary, FileInventory, SelectedFile } from './types';

export interface ReadOptions {
  /** Contenido ya resuelto (redactado o editado por el usuario) que sustituye la lectura de disco. */
  overrides?: Map<string, string>;
  /** Rutas que no deben leerse ni enviarse al modelo. */
  exclude?: Set<string>;
}

export const PRE_SELECTION_MAX_BYTES_PER_FILE = 200_000;

// Umbral único de tamaño de fichero candidato. Por encima se descarta en el escaneo;
// es deliberadamente alto para no dejar fuera ficheros de código reales.
export const MAX_FILE_BYTES = 2_000_000;

const IGNORE_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  // Metadatos de herramientas de IA/agentes. `.claude/worktrees/` en particular
  // guarda COPIAS COMPLETAS del repositorio por agente: reingerirlas dispara cientos
  // de ficheros duplicados hacia el modelo (y con ello el coste y el rate limit).
  '.claude',
  // Metadatos de IDE y artefactos del test runner de VS Code: ruido, nunca aportan al README.
  '.idea',
  '.vscode-test',
  '.readme-generator-ai',
  'dist',
  'build',
  'venv',
  '.venv',
  'coverage',
  '__pycache__'
]);

const IGNORE_EXTENSIONS = new Set([
  // Images (binary, not useful as text)
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.tiff', '.psd', '.ai', '.eps',
  // SVG (XML but diagram content is not useful for README generation)
  '.svg',
  // Video / audio
  '.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm',
  '.mp3', '.wav', '.flac', '.ogg', '.aac', '.m4a',
  // PDF (binary encoding, TextDecoder produces garbage)
  '.pdf',
  // Lock files (version pins for transitive deps — pure noise)
  '.lock',
  // Compiled / native binaries
  '.exe', '.dll', '.so', '.dylib', '.class', '.pyc', '.pyd', '.pyo', '.wasm',
  // Archives and packages
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.7z', '.rar',
  '.jar', '.war', '.ear', '.whl', '.vsix', '.deb', '.rpm',
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // Databases
  '.sqlite', '.db', '.mdb',
  // Other binary / data formats
  '.bin', '.dat', '.dump', '.img', '.iso',
]);


export async function scanRepository(workspaceFolder: vscode.WorkspaceFolder): Promise<CandidateFile[]> {
  const pattern = new vscode.RelativePattern(workspaceFolder, '**/*');
  const exclude = `{${Array.from(IGNORE_DIRECTORIES).map((dir) => `**/${dir}/**`).join(',')}}`;
  const uris = await vscode.workspace.findFiles(pattern, exclude);
  const candidates: CandidateFile[] = [];

  for (const uri of uris) {
    const relativePath = normalizeRelative(path.relative(workspaceFolder.uri.fsPath, uri.fsPath));
    if (!relativePath || shouldIgnore(relativePath)) {
      continue;
    }

    const ext = path.extname(relativePath).toLowerCase();
    if (IGNORE_EXTENSIONS.has(ext)) {
      continue;
    }

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.File && stat.size > 0 && stat.size <= MAX_FILE_BYTES) {
        candidates.push({ uri, relativePath, size: stat.size });
      }
    } catch {
      // Ignore files that disappear or cannot be read while scanning.
    }
  }

  return candidates;
}

export async function buildFileInventory(files: CandidateFile[]): Promise<FileInventory> {
  const selectorInventory: CandidateFile[] = [];
  const discarded = new Map<string, { count: number; examples: string[] }>();

  for (const file of files) {
    const reason = discardReason(file.relativePath);
    if (reason) {
      const entry = discarded.get(reason) ?? { count: 0, examples: [] };
      entry.count++;
      if (entry.examples.length < 8) {
        entry.examples.push(file.relativePath);
      }
      discarded.set(reason, entry);
    } else {
      selectorInventory.push(file);
    }
  }

  const discardedSummary: DiscardedFileSummary[] = Array.from(discarded.entries()).map(
    ([reason, { count, examples }]) => ({ reason, count, examples, stage: 'local' as const })
  );

  return { selectorInventory, discardedSummary };
}

export async function readAllCandidateFiles(
  files: CandidateFile[],
  maxBytesPerFile: number,
  options: ReadOptions = {}
): Promise<SelectedFile[]> {
  const { overrides, exclude } = options;
  const result: SelectedFile[] = [];
  for (const file of files) {
    if (exclude?.has(file.relativePath)) {
      continue;
    }
    const override = overrides?.get(file.relativePath);
    if (override !== undefined) {
      if (override.length === 0) {
        continue;
      }
      result.push({ ...file, content: override, truncated: false });
      continue;
    }
    const read = await readRawContent(file, maxBytesPerFile);
    if (!read || read.content.length === 0) {
      continue;
    }
    result.push({ ...file, content: read.content, truncated: read.truncated });
  }
  return result;
}

export async function readRawContent(
  file: CandidateFile,
  maxBytesPerFile: number
): Promise<{ content: string; truncated: boolean } | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(file.uri);
    const slice = bytes.slice(0, maxBytesPerFile);
    const content = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    return { content, truncated: bytes.byteLength > slice.byteLength };
  } catch {
    // Keep generation moving if one file cannot be read.
    return undefined;
  }
}

// Estima tokens a partir del tamaño en disco. Un fichero mayor que
// PRE_SELECTION_MAX_BYTES_PER_FILE se trunca a ese tamaño antes de enviarse al
// modelo (readRawContent), así que para el presupuesto solo cuentan los bytes que
// realmente llegan: usar el tamaño completo sobrestimaría un fichero grande y lo
// empujaría a overflow aunque su versión truncada cupiera de sobra.
export function estimateTokensFromSize(size: number): number {
  return Math.ceil(Math.min(size, PRE_SELECTION_MAX_BYTES_PER_FILE) / 4);
}

export function splitByTokenBudget(
  files: CandidateFile[],
  maxTotalTokens: number
): { fitting: CandidateFile[]; overflow: CandidateFile[] } {
  const fitting: CandidateFile[] = [];
  const overflow: CandidateFile[] = [];
  let totalTokens = 0;

  for (const file of files) {
    const tokenEstimate = estimateTokensFromSize(file.size);
    if (totalTokens + tokenEstimate <= maxTotalTokens) {
      fitting.push(file);
      totalTokens += tokenEstimate;
    } else {
      overflow.push(file);
    }
  }

  return { fitting, overflow };
}

export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function discardReason(relativePath: string): string | undefined {
  const lower = relativePath.toLowerCase();
  const basename = path.basename(lower);

  if (
    basename === 'package-lock.json' ||
    basename === 'npm-shrinkwrap.json' ||
    basename === 'pnpm-lock.yaml' ||
    basename === 'go.sum' ||
    basename === 'bun.lockb'
  ) {
    return 'lockfile';
  }

  // Evita reingerir la propia salida del generador en ejecuciones posteriores.
  if (basename === 'readme.generated.md') {
    return 'salida previa del generador';
  }

  if (lower.includes('/__snapshots__/') || lower.includes('/fixtures/') || lower.includes('/fixture/')) {
    return 'test fixture or snapshot';
  }

  if (basename.endsWith('.min.js') || basename.endsWith('.bundle.js')) {
    return 'minified or bundled asset';
  }

  return undefined;
}

function shouldIgnore(relativePath: string): boolean {
  const parts = relativePath.split('/');
  return parts.some((part) => IGNORE_DIRECTORIES.has(part));
}

function normalizeRelative(value: string): string {
  return value.split(path.sep).join('/');
}
