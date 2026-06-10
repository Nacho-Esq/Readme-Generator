import * as path from 'path';
import * as vscode from 'vscode';
import { AzureResponsesClient } from './azure/azureResponsesClient';
import { ensureConfigured, getPreSelectionDeployment, getReadDepthTokenBudget, getSettings } from './config';
import { buildContentSelectionPrompt, buildFileSelectionMetadata } from './prompt/fileSelectionPrompt';
import { buildExtractionPrompt } from './prompt/promptBuilder';
import {
  analyzeReadmeData,
  completeRenderOptions,
  createDefaultRenderOptions,
  prepareDataForReview
} from './readme/reviewModel';
import { buildFileInventory } from './scanner/fileRanker';
import { PRE_SELECTION_MAX_BYTES_PER_FILE, readAllCandidateFiles, readSelectedFilesByTokenBudget, scanRepository } from './scanner/fileScanner';
import { analyzeRepository } from './scanner/repositoryAnalyzer';
import { DiscardedFileSummary, FileOverview, FileSelectionItem, FileSelectionResult } from './scanner/types';
import { TemplateRenderer } from './template/templateRenderer';
import {
  buildFinalReadFileTrace,
  createGenerationTrace,
  GenerationTrace,
  openLastGenerationTrace,
  saveGenerationTrace
} from './trace/generationTrace';
import { EditFormPanel } from './ui/editFormPanel';
import { asErrorMessage } from './utils/errors';

let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand('readmeGeneratorAi.generateReadme', () =>
    generateReadme(context)
  );
  context.subscriptions.push(command);

  const openTraceCommand = vscode.commands.registerCommand('readmeGeneratorAi.openLastTrace', () =>
    openLastTrace()
  );
  context.subscriptions.push(openTraceCommand);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = '$(book) Generate README';
  statusBarItem.tooltip = 'Generate README with Azure OpenAI';
  statusBarItem.command = 'readmeGeneratorAi.generateReadme';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

export function deactivate(): void {
  statusBarItem?.dispose();
}

async function generateReadme(context: vscode.ExtensionContext): Promise<void> {
  try {
    const workspaceFolder = getActiveWorkspaceFolder();
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('Abre un repositorio local en VS Code antes de generar el README.');
      return;
    }

    const settings = getSettings();
    if (!(await ensureConfigured(settings))) {
      return;
    }

    vscode.window.setStatusBarMessage('README Generator AI: escaneando repositorio...', 4_000);
    const candidates = await scanRepository(workspaceFolder);
    if (candidates.length === 0) {
      vscode.window.showErrorMessage('No se encontraron archivos relevantes para analizar.');
      return;
    }

    const client = new AzureResponsesClient(settings);
    const tokenBudget = getReadDepthTokenBudget(settings.readDepth);
    const trace = createGenerationTrace(
      workspaceFolder.name,
      settings.readDepth,
      tokenBudget
    );
    const inventory = await buildFileInventory(candidates);
    let repositoryMap = await analyzeRepository(candidates, workspaceFolder, inventory.discardedSummary);
    trace.localDiscardedSummary = inventory.discardedSummary;
    trace.repositoryMap = repositoryMap;
    trace.selectorInventory = buildFileSelectionMetadata(inventory.selectorInventory);

    vscode.window.setStatusBarMessage(
      `README Generator AI: leyendo repositorio completo (${inventory.selectorInventory.length} archivos)...`,
      6_000
    );
    const preSelectionDeployment = getPreSelectionDeployment(settings);
    const allCandidateFiles = await readAllCandidateFiles(inventory.selectorInventory, PRE_SELECTION_MAX_BYTES_PER_FILE);
    const contentPrompt = buildContentSelectionPrompt(repositoryMap, allCandidateFiles);
    trace.preSelectionDeployment = preSelectionDeployment;
    trace.preSelectionFilesSentCount = allCandidateFiles.length;
    trace.selectionPrompt = contentPrompt;
    vscode.window.setStatusBarMessage(
      `README Generator AI: seleccionando archivos clave con modelo ligero...`,
      4_000
    );
    const selection = await selectFilesForDetailedRead(
      client,
      contentPrompt,
      preSelectionDeployment,
      inventory.selectorInventory,
      inventory.fallbackRanking
    );
    trace.llmSelection = selection.llmSelection;
    trace.llmDiscardedSummary = selection.discardedSummary;
    trace.usedFallback = selection.usedFallback;
    repositoryMap = await analyzeRepository(
      candidates,
      workspaceFolder,
      inventory.discardedSummary.concat(selection.discardedSummary)
    );
    trace.repositoryMap = repositoryMap;

    const selectedFiles = await readSelectedFilesByTokenBudget(
      selection.ranking,
      PRE_SELECTION_MAX_BYTES_PER_FILE,
      tokenBudget
    );
    if (selectedFiles.length === 0) {
      vscode.window.showErrorMessage('No se pudieron leer los archivos seleccionados.');
      return;
    }
    trace.finalReadFiles = buildFinalReadFileTrace(selectedFiles);
    trace.warnings = selection.warnings;
    await saveTraceIfEnabled(workspaceFolder, settings.debugTrace, trace);

    vscode.window.setStatusBarMessage(`README Generator AI: analizando ${selectedFiles.length} archivos...`, 4_000);
    const prompt = buildExtractionPrompt(selectedFiles, workspaceFolder.name, repositoryMap);
    const extraction = await client.extractReadmeData(prompt);
    const warnings = selection.warnings.concat(extraction.warnings);
    trace.warnings = warnings;
    await saveTraceIfEnabled(workspaceFolder, settings.debugTrace, trace);

    const renderer = new TemplateRenderer(context.extensionUri);
    const templatePath = await renderer.resolveTemplatePath(settings.templatePath);
    const review = analyzeReadmeData(extraction.data);
    const initialRenderOptions = completeRenderOptions(extraction.data, createDefaultRenderOptions());
    const initialReviewData = prepareDataForReview(extraction.data, initialRenderOptions);
    const initialMarkdown = await renderer.render(templatePath, initialReviewData, initialRenderOptions);

    const editResult = await EditFormPanel.show(
      initialReviewData,
      initialMarkdown,
      warnings,
      context.extensionUri,
      review,
      initialRenderOptions,
      async (data, renderOptions) => {
        const completedOptions = completeRenderOptions(data, renderOptions);
        return renderer.render(templatePath, data, completedOptions);
      }
    );
    if (editResult.action !== 'save') {
      return;
    }

    const finalRenderOptions = completeRenderOptions(editResult.data, editResult.renderOptions);
    const finalMarkdown = await renderer.render(templatePath, editResult.data, finalRenderOptions);
    const outputUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, 'README.generated.md'));
    await vscode.workspace.fs.writeFile(outputUri, new TextEncoder().encode(finalMarkdown));

    const document = await vscode.workspace.openTextDocument(outputUri);
    await vscode.window.showTextDocument(document, { preview: false });
    vscode.window.showInformationMessage('README.generated.md generado correctamente.');
  } catch (error) {
    vscode.window.showErrorMessage(`No se pudo generar el README: ${asErrorMessage(error)}`);
  }
}

interface DetailedReadSelection {
  ranking: FileOverview[];
  llmSelection: FileSelectionItem[];
  discardedSummary: DiscardedFileSummary[];
  warnings: string[];
  usedFallback: boolean;
}

async function selectFilesForDetailedRead(
  client: AzureResponsesClient,
  prompt: string,
  deploymentOverride: string,
  inventory: FileOverview[],
  fallbackRanking: FileOverview[]
): Promise<DetailedReadSelection> {
  try {
    const result = await client.preSelectImportantFiles(prompt, deploymentOverride);
    const validated = validateFileSelection(result, inventory);
    if (validated.ranking.length === 0) {
      throw new Error('El selector LLM no devolvio rutas validas.');
    }

    return {
      ranking: validated.ranking,
      llmSelection: result.selectedFiles,
      discardedSummary: [summarizeLlmDiscarded(inventory, validated.ranking)],
      warnings: result.warnings.concat(validated.warnings),
      usedFallback: false
    };
  } catch (error) {
    return {
      ranking: fallbackRanking,
      llmSelection: [],
      discardedSummary: [
        {
          reason: 'fallback to local heuristic ranking',
          count: 0,
          examples: [],
          stage: 'fallback'
        }
      ],
      warnings: [`No se pudo usar el selector LLM de archivos; se uso el ranking local: ${asErrorMessage(error)}`],
      usedFallback: true
    };
  }
}

function validateFileSelection(
  result: FileSelectionResult,
  inventory: FileOverview[]
): { ranking: FileOverview[]; warnings: string[] } {
  const byPath = new Map(inventory.map((file) => [file.relativePath, file]));
  const selected = new Map<string, FileOverview>();
  const invalidPaths: string[] = [];

  for (const item of result.selectedFiles) {
    const file = byPath.get(item.path);
    if (!file) {
      invalidPaths.push(item.path);
      continue;
    }
    selected.set(file.relativePath, file);
  }

  const warnings = invalidPaths.length
    ? [`El selector LLM devolvio ${invalidPaths.length} rutas fuera del inventario: ${invalidPaths.slice(0, 8).join(', ')}`]
    : [];

  return {
    ranking: Array.from(selected.values()),
    warnings
  };
}

function summarizeLlmDiscarded(inventory: FileOverview[], selectedRanking: FileOverview[]): DiscardedFileSummary {
  const selectedPaths = new Set(selectedRanking.map((file) => file.relativePath));
  const discarded = inventory.filter((file) => !selectedPaths.has(file.relativePath));
  return {
    reason: 'discarded by LLM selector',
    count: discarded.length,
    examples: discarded.slice(0, 8).map((file) => file.relativePath),
    stage: 'llm'
  };
}

function getActiveWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const folder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (folder) {
      return folder;
    }
  }
  return vscode.workspace.workspaceFolders?.[0];
}

async function openLastTrace(): Promise<void> {
  const workspaceFolder = getActiveWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('Abre un repositorio local en VS Code antes de abrir la traza.');
    return;
  }
  await openLastGenerationTrace(workspaceFolder);
}

async function saveTraceIfEnabled(
  workspaceFolder: vscode.WorkspaceFolder,
  enabled: boolean,
  trace: GenerationTrace
): Promise<void> {
  if (!enabled) {
    return;
  }
  try {
    await saveGenerationTrace(workspaceFolder, trace);
  } catch (error) {
    vscode.window.showWarningMessage(`No se pudo guardar la traza de README Generator AI: ${asErrorMessage(error)}`);
  }
}
