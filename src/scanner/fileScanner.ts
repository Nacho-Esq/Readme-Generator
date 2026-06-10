import * as path from 'path';
import * as vscode from 'vscode';
import { CandidateFile, FileOverview, SelectedFile, RankedFile } from './types';

export const PRE_SELECTION_MAX_BYTES_PER_FILE = 200_000;

const IGNORE_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.readme-generator-ai',
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

export async function readAllCandidateFiles(
  files: FileOverview[],
  maxBytesPerFile: number
): Promise<SelectedFile[]> {
  const result: SelectedFile[] = [];
  for (const file of files) {
    try {
      const bytes = await vscode.workspace.fs.readFile(file.uri);
      const slice = bytes.slice(0, maxBytesPerFile);
      const content = new TextDecoder('utf-8', { fatal: false }).decode(slice);
      if (content.length === 0) {
        continue;
      }
      result.push({
        ...file,
        content,
        truncated: bytes.byteLength > slice.byteLength
      });
    } catch {
      // Keep generation moving if one file cannot be read.
    }
  }
  return result;
}

export async function readSelectedFilesByTokenBudget(
  rankedFiles: RankedFile[],
  maxBytesPerFile: number,
  maxTotalTokens: number
): Promise<SelectedFile[]> {
  const selected: SelectedFile[] = [];
  let totalTokens = 0;

  for (const file of rankedFiles) {
    if (totalTokens >= maxTotalTokens) {
      break;
    }

    try {
      const bytes = await vscode.workspace.fs.readFile(file.uri);
      const slice = bytes.slice(0, maxBytesPerFile);
      const content = new TextDecoder('utf-8', { fatal: false }).decode(slice);
      const tokenEstimate = estimateTokens(content);

      if (tokenEstimate <= 0) {
        continue;
      }

      // Si el fichero completo no cabe en el presupuesto restante, saltarlo — no truncar.
      if (totalTokens + tokenEstimate > maxTotalTokens) {
        continue;
      }

      totalTokens += tokenEstimate;
      selected.push({
        ...file,
        content,
        truncated: bytes.byteLength > slice.byteLength
      });
    } catch {
      // Keep generation moving if one selected file cannot be read.
    }
  }

  return selected;
}

export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function shouldIgnore(relativePath: string): boolean {
  const parts = relativePath.split('/');
  return parts.some((part) => IGNORE_DIRECTORIES.has(part));
}

function normalizeRelative(value: string): string {
  return value.split(path.sep).join('/');
}
