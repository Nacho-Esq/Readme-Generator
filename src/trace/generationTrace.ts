import * as vscode from 'vscode';
import type {
  DiscardedFileSummary,
  FileSelectionItem,
  ReadDepth,
  RepositoryMap,
  SelectedFile
} from '../scanner/types';
import { estimateTokens } from '../scanner/fileScanner';

export interface FinalReadFileTrace {
  path: string;
  contentChars: number;
  estimatedTokens: number;
  truncated: boolean;
  score: number;
  reasons: string[];
}

export interface GenerationTrace {
  workspaceName: string;
  generatedAt: string;
  readDepth: ReadDepth;
  tokenBudget: number;
  maxBytesPerFile: number;
  localDiscardedSummary: DiscardedFileSummary[];
  repositoryMap?: RepositoryMap;
  selectorInventory: object[];
  selectionPrompt: string;
  llmSelection: FileSelectionItem[];
  llmDiscardedSummary: DiscardedFileSummary[];
  finalReadFiles: FinalReadFileTrace[];
  warnings: string[];
  usedFallback: boolean;
}

export interface SavedTracePaths {
  jsonUri: vscode.Uri;
  markdownUri: vscode.Uri;
}

export function createGenerationTrace(
  workspaceName: string,
  readDepth: ReadDepth,
  tokenBudget: number,
  maxBytesPerFile: number
): GenerationTrace {
  return {
    workspaceName,
    generatedAt: new Date().toISOString(),
    readDepth,
    tokenBudget,
    maxBytesPerFile,
    localDiscardedSummary: [],
    selectorInventory: [],
    selectionPrompt: '',
    llmSelection: [],
    llmDiscardedSummary: [],
    finalReadFiles: [],
    warnings: [],
    usedFallback: false
  };
}

export function buildFinalReadFileTrace(files: SelectedFile[]): FinalReadFileTrace[] {
  return files.map((file) => ({
    path: file.relativePath,
    contentChars: file.content.length,
    estimatedTokens: estimateTokens(file.content),
    truncated: file.truncated,
    score: file.score,
    reasons: file.reasons
  }));
}

export async function saveGenerationTrace(
  workspaceFolder: vscode.WorkspaceFolder,
  trace: GenerationTrace
): Promise<SavedTracePaths> {
  const traceDir = vscode.Uri.joinPath(workspaceFolder.uri, '.readme-generator-ai');
  const jsonUri = vscode.Uri.joinPath(traceDir, 'last-run.json');
  const markdownUri = vscode.Uri.joinPath(traceDir, 'last-run.md');

  await vscode.workspace.fs.createDirectory(traceDir);
  await vscode.workspace.fs.writeFile(jsonUri, encode(JSON.stringify(trace, null, 2)));
  await vscode.workspace.fs.writeFile(markdownUri, encode(formatTraceMarkdown(trace)));

  return { jsonUri, markdownUri };
}

export async function openLastGenerationTrace(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
  const jsonUri = vscode.Uri.joinPath(workspaceFolder.uri, '.readme-generator-ai', 'last-run.json');
  try {
    await vscode.workspace.fs.stat(jsonUri);
  } catch {
    vscode.window.showWarningMessage('No hay ninguna traza de README Generator AI en este workspace.');
    return;
  }

  const document = await vscode.workspace.openTextDocument(jsonUri);
  await vscode.window.showTextDocument(document, { preview: false });
}

function formatTraceMarkdown(trace: GenerationTrace): string {
  const selectionPromptChars = trace.selectionPrompt.length;
  const selectionPromptTokens = estimateTokens(trace.selectionPrompt);
  const finalReadChars = trace.finalReadFiles.reduce((total, file) => total + file.contentChars, 0);
  const finalReadTokens = trace.finalReadFiles.reduce((total, file) => total + file.estimatedTokens, 0);

  return [
    '# README Generator AI - Last Run Trace',
    '',
    `- Workspace: ${trace.workspaceName}`,
    `- Generated at: ${trace.generatedAt}`,
    `- Read depth: ${trace.readDepth}`,
    `- Token budget: ${trace.tokenBudget}`,
    `- Max bytes per file: ${trace.maxBytesPerFile}`,
    `- Used fallback: ${trace.usedFallback ? 'yes' : 'no'}`,
    '',
    '## Token And Character Usage',
    `- Selection prompt sent to LLM: ${selectionPromptTokens} estimated tokens, ${selectionPromptChars} chars`,
    `- Final detailed files read: ${finalReadTokens} estimated tokens, ${finalReadChars} chars`,
    `- Detailed read token budget: ${trace.tokenBudget} estimated tokens`,
    '',
    '## Files Discarded Before LLM',
    formatDiscarded(trace.localDiscardedSummary),
    '',
    '## Metadata Sent To LLM',
    `Total files: ${trace.selectorInventory.length}`,
    '',
    '```json',
    JSON.stringify(trace.selectorInventory, null, 2),
    '```',
    '',
    '## LLM Ranking',
    formatSelection(trace.llmSelection),
    '',
    '## LLM Discarded Files',
    formatDiscarded(trace.llmDiscardedSummary),
    '',
    '## Final Read Files',
    formatFinalReadFiles(trace.finalReadFiles),
    '',
    '## Warnings',
    trace.warnings.length ? trace.warnings.map((warning) => `- ${warning}`).join('\n') : '- None'
  ].join('\n');
}

function formatDiscarded(items: DiscardedFileSummary[]): string {
  if (items.length === 0) {
    return '- None';
  }
  const total = items.reduce((count, item) => count + item.count, 0);
  const lines = [`Total discarded files: ${total}`];
  return items
    .reduce((output, item) => {
      const examples = item.examples.length ? ` Examples: ${item.examples.join(', ')}` : '';
      output.push(`- ${item.reason} (${item.stage || 'unknown'}): ${item.count}.${examples}`);
      return output;
    }, lines)
    .join('\n');
}

function formatSelection(items: FileSelectionItem[]): string {
  if (items.length === 0) {
    return '- None';
  }
  return items.map((item, index) => `${index + 1}. ${item.path} - ${item.reason}`).join('\n');
}

function formatFinalReadFiles(files: FinalReadFileTrace[]): string {
  if (files.length === 0) {
    return '- None';
  }
  return files
    .map((file, index) => {
      const truncated = file.truncated ? ', truncated' : '';
      return `${index + 1}. ${file.path} (${file.estimatedTokens} tokens, ${file.contentChars} chars${truncated})`;
    })
    .join('\n');
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
