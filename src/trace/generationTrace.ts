import * as vscode from 'vscode';
import type {
  DiscardedFileSummary,
  FileSelectionItem,
  ReadDepth,
  RepositoryMap,
  SelectedFile
} from '../scanner/types';
import { estimateTokens } from '../scanner/fileScanner';
import type { TokenUsage } from '../types';

export interface FinalReadFileTrace {
  path: string;
  contentChars: number;
  estimatedTokens: number;
  truncated: boolean;
}

export interface SecuritySummary {
  /** Archivos que el usuario excluyó: no se enviaron a ningún modelo. */
  excludedPaths: string[];
  /** Archivos enviados con sus valores codificados. */
  redactedFiles: Array<{ path: string; redactionCount: number }>;
}

export interface GenerationTrace {
  workspaceName: string;
  generatedAt: string;
  readDepth: ReadDepth;
  tokenBudget: number;
  localDiscardedSummary: DiscardedFileSummary[];
  securitySummary: SecuritySummary;
  repositoryMap?: RepositoryMap;
  preSelectionDeployment: string;
  preSelectionFilesSentCount: number;
  selectionPrompt: string;
  llmSelection: FileSelectionItem[];
  llmDiscardedFiles: FileSelectionItem[];
  llmDiscardedSummary: DiscardedFileSummary[];
  finalReadFiles: FinalReadFileTrace[];
  warnings: string[];
  mainModelDeployment: string;
  nanoTokenUsage: TokenUsage | null;
  mainModelTokenUsage: TokenUsage | null;
}

export interface SavedTracePaths {
  jsonUri: vscode.Uri;
  markdownUri: vscode.Uri;
}

export function createGenerationTrace(
  workspaceName: string,
  readDepth: ReadDepth,
  tokenBudget: number
): GenerationTrace {
  return {
    workspaceName,
    generatedAt: new Date().toISOString(),
    readDepth,
    tokenBudget,
    localDiscardedSummary: [],
    securitySummary: { excludedPaths: [], redactedFiles: [] },
    preSelectionDeployment: '',
    preSelectionFilesSentCount: 0,
    selectionPrompt: '',
    llmSelection: [],
    llmDiscardedFiles: [],
    llmDiscardedSummary: [],
    finalReadFiles: [],
    warnings: [],
    mainModelDeployment: '',
    nanoTokenUsage: null,
    mainModelTokenUsage: null
  };
}

export function buildFinalReadFileTrace(files: SelectedFile[]): FinalReadFileTrace[] {
  return files.map((file) => ({
    path: file.relativePath,
    contentChars: file.content.length,
    estimatedTokens: estimateTokens(file.content),
    truncated: file.truncated
  }));
}

// Guarda la traza en el almacenamiento privado de la extensión (`storageDir`, ya
// resuelto por el llamador; ver src/storage/extensionStorage.ts), NO en el repo del
// usuario. Escribe una versión JSON completa y una Markdown legible.
export async function saveGenerationTrace(
  storageDir: vscode.Uri,
  trace: GenerationTrace
): Promise<SavedTracePaths> {
  const jsonUri = vscode.Uri.joinPath(storageDir, 'last-run.json');
  const markdownUri = vscode.Uri.joinPath(storageDir, 'last-run.md');

  await vscode.workspace.fs.createDirectory(storageDir);
  await vscode.workspace.fs.writeFile(jsonUri, encode(JSON.stringify(trace, null, 2)));
  await vscode.workspace.fs.writeFile(markdownUri, encode(formatTraceMarkdown(trace)));

  return { jsonUri, markdownUri };
}

export async function openLastGenerationTrace(storageDir: vscode.Uri): Promise<void> {
  const jsonUri = vscode.Uri.joinPath(storageDir, 'last-run.json');
  try {
    await vscode.workspace.fs.stat(jsonUri);
  } catch {
    vscode.window.showWarningMessage('No hay ninguna traza de README Generator AI para este proyecto.');
    return;
  }

  const document = await vscode.workspace.openTextDocument(jsonUri);
  await vscode.window.showTextDocument(document, { preview: false });
}

// ---------------------------------------------------------------------------
// Pricing table (EUR per 1M tokens — match by deployment name substring)
// ---------------------------------------------------------------------------

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const MODEL_PRICING: Array<{ pattern: string; pricing: ModelPricing }> = [
  { pattern: 'gpt-5.4-nano',       pricing: { inputPerMillion: 0.18,  outputPerMillion: 1.08  } },
  { pattern: 'gpt-5.1-codex-mini', pricing: { inputPerMillion: 0.22,  outputPerMillion: 1.73  } },
  { pattern: 'gpt-5.2-codex',      pricing: { inputPerMillion: 1.51,  outputPerMillion: 12.05 } },
  { pattern: 'gpt-5.4-mini',       pricing: { inputPerMillion: 0.65,  outputPerMillion: 3.88  } },
  { pattern: 'gpt-5.3-codex',      pricing: { inputPerMillion: 1.51,  outputPerMillion: 12.05 } },
];

export function getInputCostPerToken(deploymentName: string): number | null {
  const entry = MODEL_PRICING.find((e) => deploymentName.includes(e.pattern));
  return entry ? entry.pricing.inputPerMillion / 1_000_000 : null;
}

function computeCostValue(deploymentName: string, usage: TokenUsage): number | null {
  const entry = MODEL_PRICING.find((e) => deploymentName.includes(e.pattern));
  if (!entry) {
    return null;
  }
  return (
    (usage.inputTokens / 1_000_000) * entry.pricing.inputPerMillion +
    (usage.outputTokens / 1_000_000) * entry.pricing.outputPerMillion
  );
}

function computeCost(deploymentName: string, usage: TokenUsage): string {
  const cost = computeCostValue(deploymentName, usage);
  return cost === null ? 'precio desconocido' : `€${cost.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Markdown formatter
// ---------------------------------------------------------------------------

function formatTraceMarkdown(trace: GenerationTrace): string {
  const totalLocalDiscarded = trace.localDiscardedSummary.reduce((n, s) => n + s.count, 0);
  const nanoSelectedCount = trace.llmSelection.length;
  const finalReadCount = trace.finalReadFiles.length;

  const nanoCostStr = trace.nanoTokenUsage
    ? computeCost(trace.preSelectionDeployment, trace.nanoTokenUsage)
    : 'N/A';
  const mainCostStr = trace.mainModelTokenUsage
    ? computeCost(trace.mainModelDeployment, trace.mainModelTokenUsage)
    : 'N/A';

  const nanoCostVal = trace.nanoTokenUsage
    ? computeCostValue(trace.preSelectionDeployment, trace.nanoTokenUsage)
    : null;
  const mainCostVal = trace.mainModelTokenUsage
    ? computeCostValue(trace.mainModelDeployment, trace.mainModelTokenUsage)
    : null;
  const totalCostStr =
    nanoCostVal !== null && mainCostVal !== null
      ? `€${(nanoCostVal + mainCostVal).toFixed(4)}`
      : 'N/A';

  const finalReadTokens = trace.finalReadFiles.reduce((n, f) => n + f.estimatedTokens, 0);

  const sections: string[] = [];

  // Header
  sections.push('# README Generator AI — Trace');
  sections.push('');
  sections.push(`- **Workspace**: ${trace.workspaceName}`);
  sections.push(`- **Generado**: ${trace.generatedAt}`);
  sections.push(`- **Read depth**: ${trace.readDepth} (budget modelo principal: ${trace.tokenBudget.toLocaleString('es-ES')} tokens)`);
  sections.push('- **Límite por fichero**: 200 KB (ambas fases)');
  sections.push('');
  sections.push('---');
  sections.push('');

  // Cost table
  sections.push('## 💰 Coste estimado');
  sections.push('');
  sections.push('| Modelo | Deployment | Input tokens | Output tokens | Coste est. |');
  sections.push('|--------|------------|-------------:|-------------:|------------|');

  if (trace.nanoTokenUsage) {
    sections.push(
      `| Nano (pre-selección) | ${trace.preSelectionDeployment} | ${trace.nanoTokenUsage.inputTokens.toLocaleString('es-ES')} | ${trace.nanoTokenUsage.outputTokens.toLocaleString('es-ES')} | ${nanoCostStr} |`
    );
  } else {
    sections.push(`| Nano (pre-selección) | ${trace.preSelectionDeployment || '—'} | N/A | N/A | N/A |`);
  }

  if (trace.mainModelTokenUsage) {
    sections.push(
      `| Principal (extracción) | ${trace.mainModelDeployment} | ${trace.mainModelTokenUsage.inputTokens.toLocaleString('es-ES')} | ${trace.mainModelTokenUsage.outputTokens.toLocaleString('es-ES')} | ${mainCostStr} |`
    );
  } else {
    sections.push(`| Principal (extracción) | ${trace.mainModelDeployment || '—'} | N/A | N/A | N/A |`);
  }

  sections.push(`| **Total** | | | | **${totalCostStr}** |`);
  sections.push('');
  sections.push('---');
  sections.push('');

  // Phase 1: local pre-filter
  sections.push('## 1️⃣ Pre-filtro de archivos');
  sections.push('');
  if (totalLocalDiscarded === 0) {
    sections.push('Ningún archivo descartado en esta fase.');
  } else {
    sections.push(`Archivos descartados: **${totalLocalDiscarded}** (antes de enviar al nano)`);
    sections.push('');
    for (const item of trace.localDiscardedSummary) {
      const examples = item.examples.length ? ` Examples: ${item.examples.join(', ')}` : '';
      sections.push(`- ${item.reason} (${item.stage ?? 'local'}): ${item.count}.${examples}`);
    }
  }
  sections.push('');
  sections.push(`**Archivos enviados al nano: ${trace.preSelectionFilesSentCount}**`);
  sections.push('');
  sections.push('---');
  sections.push('');

  // Security: user-driven exclusions and redactions
  const { excludedPaths, redactedFiles } = trace.securitySummary;
  sections.push('## 🔒 Protección de datos sensibles');
  sections.push('');
  if (excludedPaths.length === 0 && redactedFiles.length === 0) {
    sections.push('Ningún archivo excluido ni codificado por seguridad.');
  } else {
    sections.push(`Archivos excluidos (no enviados a ningún modelo): **${excludedPaths.length}**`);
    for (const path of excludedPaths) {
      sections.push(`- \`${path}\``);
    }
    sections.push('');
    sections.push(`Archivos codificados (enviados con valores redactados): **${redactedFiles.length}**`);
    for (const file of redactedFiles) {
      const n = file.redactionCount;
      sections.push(`- \`${file.path}\` — ${n} ${n === 1 ? 'valor codificado' : 'valores codificados'}`);
    }
  }
  sections.push('');
  sections.push('---');
  sections.push('');

  // Phase 2: nano ranking
  sections.push('## 2️⃣ Modelo nano — Ranking');
  sections.push('');
  sections.push(`Deployment: \`${trace.preSelectionDeployment || '—'}\``);
  if (trace.nanoTokenUsage) {
    sections.push(
      `Tokens reales: ${trace.nanoTokenUsage.inputTokens.toLocaleString('es-ES')} input + ${trace.nanoTokenUsage.outputTokens.toLocaleString('es-ES')} output | Coste estimado: ${nanoCostStr}`
    );
  } else {
    sections.push('Tokens reales: N/A');
  }
  sections.push('');

  if (trace.llmSelection.length === 0) {
    sections.push('_Sin datos de selección._');
  } else {
    sections.push('### Seleccionados (orden de importancia):');
    sections.push('');
    for (let i = 0; i < trace.llmSelection.length; i++) {
      const item = trace.llmSelection[i];
      sections.push(`${i + 1}. \`${item.path}\` — ${item.reason}`);
    }

    const nanoDiscardedCount = trace.llmDiscardedFiles.length;
    sections.push('');
    sections.push(`### Descartados por el nano: ${nanoDiscardedCount}`);
    sections.push('');
    if (trace.llmDiscardedFiles.length > 0) {
      for (const item of trace.llmDiscardedFiles) {
        sections.push(`- \`${item.path}\` — ${item.reason}`);
      }
    } else {
      sections.push('_No hay archivos descartados registrados._');
    }
  }

  sections.push('');
  sections.push('---');
  sections.push('');

  // Phase 3: main model file reading
  const finalReadPaths = new Set(trace.finalReadFiles.map((f) => f.path));
  const notRead = trace.llmSelection.filter((s) => !finalReadPaths.has(s.path));

  sections.push('## 3️⃣ Modelo principal — Lectura de ficheros');
  sections.push('');
  sections.push(
    `Budget: ${trace.tokenBudget.toLocaleString('es-ES')} tokens | ` +
    `Ficheros del ranking: ${nanoSelectedCount} | ` +
    `Leídos: ${finalReadCount} | ` +
    `No leídos por budget: ${notRead.length}`
  );
  sections.push('');

  if (trace.finalReadFiles.length === 0) {
    sections.push('_Ningún archivo leído._');
  } else {
    sections.push('| # | Fichero | Tokens est. | Chars |');
    sections.push('|---|---------|------------:|------:|');
    for (let i = 0; i < trace.finalReadFiles.length; i++) {
      const f = trace.finalReadFiles[i];
      sections.push(
        `| ${i + 1} | \`${f.path}\` | ${f.estimatedTokens.toLocaleString('es-ES')} | ${f.contentChars.toLocaleString('es-ES')} |`
      );
    }
    sections.push('');
    sections.push(`_Total tokens estimados leídos: ${finalReadTokens.toLocaleString('es-ES')} / ${trace.tokenBudget.toLocaleString('es-ES')}_`);
  }

  if (notRead.length > 0) {
    sections.push('');
    sections.push('**No leídos (budget insuficiente):**');
    for (const item of notRead) {
      sections.push(`- \`${item.path}\` — no cabe en el presupuesto restante`);
    }
  }

  sections.push('');
  sections.push('---');
  sections.push('');

  // Phase 4: extraction
  sections.push('## 4️⃣ Modelo principal — Extracción');
  sections.push('');
  sections.push(`Deployment: \`${trace.mainModelDeployment || '—'}\``);
  if (trace.mainModelTokenUsage) {
    sections.push(
      `Tokens reales: ${trace.mainModelTokenUsage.inputTokens.toLocaleString('es-ES')} input + ${trace.mainModelTokenUsage.outputTokens.toLocaleString('es-ES')} output | Coste estimado: ${mainCostStr}`
    );
  } else {
    sections.push('Tokens reales: N/A');
  }
  sections.push('');
  sections.push('---');
  sections.push('');

  // Warnings
  sections.push('## ⚠️ Advertencias');
  sections.push('');
  sections.push(
    trace.warnings.length ? trace.warnings.map((w) => `- ${w}`).join('\n') : '- None'
  );

  return sections.join('\n');
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
