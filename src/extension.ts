import * as path from 'path';
import * as vscode from 'vscode';
import { AzureResponsesClient } from './azure/azureResponsesClient';
import { ensureConfigured, getPreSelectionDeployment, getReadDepthTokenBudget, getSettings } from './config';
import { buildContentSelectionPrompt } from './prompt/fileSelectionPrompt';
import { buildExtractionPrompt } from './prompt/promptBuilder';
import {
  analyzeReadmeData,
  completeRenderOptions,
  createDefaultRenderOptions,
  prepareDataForReview
} from './readme/reviewModel';
import { buildFileInventory, PRE_SELECTION_MAX_BYTES_PER_FILE, readAllCandidateFiles, scanRepository, splitByTokenBudget } from './scanner/fileScanner';
import { analyzeRepository } from './scanner/repositoryAnalyzer';
import { CandidateFile, DiscardedFileSummary, FileSelectionItem, FileSelectionResult } from './scanner/types';
import { TokenUsage } from './types';
import { TemplateRenderer } from './template/templateRenderer';
import {
  buildFinalReadFileTrace,
  createGenerationTrace,
  GenerationTrace,
  getInputCostPerToken,
  openLastGenerationTrace,
  saveGenerationTrace
} from './trace/generationTrace';
import { BudgetWarningPanel } from './ui/budgetWarningPanel';
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
    const tokenBudget = getReadDepthTokenBudget(settings.readDepth, settings.customTokenBudget);
    const trace = createGenerationTrace(
      workspaceFolder.name,
      settings.readDepth,
      tokenBudget
    );
    const inventory = await buildFileInventory(candidates);
    let repositoryMap = await analyzeRepository(candidates, workspaceFolder, inventory.discardedSummary);
    trace.localDiscardedSummary = inventory.discardedSummary;
    trace.repositoryMap = repositoryMap;

    vscode.window.setStatusBarMessage(
      `README Generator AI: leyendo repositorio completo (${inventory.selectorInventory.length} archivos)...`,
      6_000
    );
    const preSelectionDeployment = getPreSelectionDeployment(settings);
    const allCandidateFiles = await readAllCandidateFiles(inventory.selectorInventory, PRE_SELECTION_MAX_BYTES_PER_FILE);
    const contentPrompt = buildContentSelectionPrompt(repositoryMap, allCandidateFiles);
    trace.preSelectionDeployment = preSelectionDeployment;
    trace.mainModelDeployment = settings.deployment;
    trace.preSelectionFilesSentCount = allCandidateFiles.length;
    trace.selectionPrompt = contentPrompt;
    vscode.window.setStatusBarMessage(`README Generator AI: seleccionando archivos clave con modelo ligero...`, 4_000);
    let nanoResult;
    try {
      nanoResult = await client.preSelectImportantFiles(contentPrompt, preSelectionDeployment);
    } catch (error) {
      vscode.window.showErrorMessage(
        `El modelo '${preSelectionDeployment}' no ha podido ordenar los archivos del repositorio. ` +
        `Revisa la configuración del modelo de pre-selección (preSelectionDeployment) y comprueba que el endpoint sea accesible. ` +
        `Detalle: ${asErrorMessage(error)}`
      );
      return;
    }
    const validated = validateFileSelection(nanoResult.data, inventory.selectorInventory);
    if (validated.ranking.length === 0) {
      vscode.window.showErrorMessage(
        `El modelo '${preSelectionDeployment}' no devolvió ninguna ruta de archivo válida. ` +
        `Verifica que el modelo de pre-selección esté configurado correctamente.`
      );
      return;
    }
    trace.llmSelection = nanoResult.data.selectedFiles;
    trace.llmDiscardedFiles = nanoResult.data.discardedFiles;
    const llmDiscardedSummary = [summarizeLlmDiscarded(inventory.selectorInventory, validated.ranking)];
    trace.llmDiscardedSummary = llmDiscardedSummary;
    const nanoWarnings = nanoResult.data.warnings.concat(validated.warnings);
    trace.nanoTokenUsage = nanoResult.tokenUsage;
    repositoryMap.discardedSummary = inventory.discardedSummary.concat(llmDiscardedSummary);
    trace.repositoryMap = repositoryMap;

    const { fitting, overflow } = splitByTokenBudget(validated.ranking, tokenBudget);
    const nanoReasonsByPath = new Map(nanoResult.data.selectedFiles.map((item) => [item.path, item.reason]));

    let filesToRead: CandidateFile[] = [...fitting];

    if (overflow.length > 0) {
      const inputCostPerToken = getInputCostPerToken(settings.deployment);
      const overflowInfo = overflow.map((f) => ({
        path: f.relativePath,
        nanoReason: nanoReasonsByPath.get(f.relativePath) ?? '',
        estimatedTokens: Math.ceil(f.size / 4)
      }));
      const budgetResult = await BudgetWarningPanel.show(
        overflowInfo,
        inputCostPerToken,
        context.extensionUri
      );
      if (budgetResult.action === 'expand' && budgetResult.selectedPaths.length > 0) {
        const overflowByPath = new Map(overflow.map((f) => [f.relativePath, f]));
        const extras = budgetResult.selectedPaths
          .map((p) => overflowByPath.get(p))
          .filter((f): f is CandidateFile => f !== undefined);
        filesToRead = [...fitting, ...extras];
      }
    }

    vscode.window.setStatusBarMessage(
      `README Generator AI: leyendo ${filesToRead.length} archivos...`,
      6_000
    );
    const selectedFiles = await readAllCandidateFiles(filesToRead, PRE_SELECTION_MAX_BYTES_PER_FILE);
    if (selectedFiles.length === 0) {
      vscode.window.showErrorMessage('No se pudieron leer los archivos seleccionados.');
      return;
    }
    trace.finalReadFiles = buildFinalReadFileTrace(selectedFiles);
    trace.warnings = nanoWarnings;
    await saveTraceIfEnabled(workspaceFolder, settings.debugTrace, trace);

    const readPaths = new Set(selectedFiles.map((f) => f.relativePath));
    const unreadFiles = validated.ranking
      .filter((f) => !readPaths.has(f.relativePath))
      .map((f) => ({
        path: f.relativePath,
        nanoReason: nanoReasonsByPath.get(f.relativePath) ?? '',
        estimatedTokens: Math.ceil(f.size / 4)
      }));

    vscode.window.setStatusBarMessage(`README Generator AI: analizando ${selectedFiles.length} archivos...`, 4_000);
    const prompt = buildExtractionPrompt(selectedFiles, workspaceFolder.name, repositoryMap, {
      nanoReasonsByPath,
      unreadFiles
    });
    const extractionResult = await client.extractReadmeData(prompt);
    trace.mainModelTokenUsage = extractionResult.tokenUsage;
    const extraction = extractionResult.data;
    let finalReadmeData = extraction.data;
    let finalWarnings = nanoWarnings.concat(extraction.warnings);

    trace.warnings = finalWarnings;
    await saveTraceIfEnabled(workspaceFolder, settings.debugTrace, trace);

    const renderer = new TemplateRenderer(context.extensionUri);
    const templatePath = await renderer.resolveTemplatePath(settings.templatePath);
    const review = analyzeReadmeData(finalReadmeData);
    const initialRenderOptions = completeRenderOptions(finalReadmeData, createDefaultRenderOptions());
    const initialReviewData = prepareDataForReview(finalReadmeData, initialRenderOptions);
    const initialMarkdown = await renderer.render(templatePath, initialReviewData, initialRenderOptions);

    const editResult = await EditFormPanel.show(
      initialReviewData,
      initialMarkdown,
      finalWarnings,
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

function validateFileSelection(
  result: FileSelectionResult,
  inventory: CandidateFile[]
): { ranking: CandidateFile[]; warnings: string[] } {
  const byPath = new Map(inventory.map((file) => [file.relativePath, file]));
  const selected = new Map<string, CandidateFile>();
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

function summarizeLlmDiscarded(inventory: CandidateFile[], selectedRanking: CandidateFile[]): DiscardedFileSummary {
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
