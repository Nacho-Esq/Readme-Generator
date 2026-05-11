import * as path from 'path';
import * as vscode from 'vscode';
import { CandidateFile, SelectedFile, RankedFile } from './types';

const IGNORE_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'venv',
  '.venv',
  'coverage',
  '__pycache__'
]);

const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.json',
  '.toml',
  '.yaml',
  '.yml',
  '.md',
  '.env',
  '.example',
  '.tf',
  '.bicep',
  '.sh'
]);

const ALWAYS_INCLUDE_FILES = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'readme.md',
  'readme.generated.md',
  '.env.example',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'azure-pipelines.yml',
  'azure-pipelines.yaml'
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

    const basename = path.basename(relativePath).toLowerCase();
    const ext = path.extname(relativePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) && !ALWAYS_INCLUDE_FILES.has(basename)) {
      continue;
    }

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.File && stat.size > 0 && stat.size < 2_000_000) {
        candidates.push({ uri, relativePath, size: stat.size });
      }
    } catch {
      // Ignore files that disappear or cannot be read while scanning.
    }
  }

  return candidates;
}

export async function readSelectedFiles(
  rankedFiles: RankedFile[],
  maxFiles: number,
  maxBytesPerFile: number,
  maxTotalBytes: number
): Promise<SelectedFile[]> {
  const selected: SelectedFile[] = [];
  let totalBytes = 0;

  for (const file of rankedFiles.slice(0, maxFiles)) {
    if (totalBytes >= maxTotalBytes) {
      break;
    }

    const remaining = maxTotalBytes - totalBytes;
    const byteLimit = Math.min(maxBytesPerFile, remaining);
    if (byteLimit <= 0) {
      break;
    }

    try {
      const bytes = await vscode.workspace.fs.readFile(file.uri);
      const slice = bytes.slice(0, byteLimit);
      const content = new TextDecoder('utf-8', { fatal: false }).decode(slice);
      totalBytes += slice.byteLength;
      selected.push({
        ...file,
        content,
        truncated: bytes.byteLength > slice.byteLength
      });
    } catch {
      // Keep generation moving if one ranked file cannot be read.
    }
  }

  return selected;
}

function shouldIgnore(relativePath: string): boolean {
  const parts = relativePath.split('/');
  return parts.some((part) => IGNORE_DIRECTORIES.has(part));
}

function normalizeRelative(value: string): string {
  return value.split(path.sep).join('/');
}
