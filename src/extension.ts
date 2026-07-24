import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { AzureResponsesClient } from './azure/azureResponsesClient';
import { ensureConfigured, getPreSelectionDeployment, getReadDepthTokenBudget, getSettings } from './config';
import { buildContentSelectionPrompt } from './prompt/fileSelectionPrompt';
import { buildExtractionPrompt, UnreadFileInfo } from './prompt/promptBuilder';
import {
  analyzeReadmeData,
  completeRenderOptions,
  createDefaultRenderOptions,
  prepareDataForReview
} from './readme/reviewModel';
import { buildFileInventory, estimateTokensFromSize, PRE_SELECTION_MAX_BYTES_PER_FILE, readAllCandidateFiles, readRawContent, scanRepository, splitByTokenBudget } from './scanner/fileScanner';
import { analyzeRepository } from './scanner/repositoryAnalyzer';
import { CandidateFile, DiscardedFileSummary, FileSelectionItem, FileSelectionResult, RepositoryMap, SelectedFile } from './scanner/types';
import { TemplateRenderer } from './template/templateRenderer';
import { initTemplateSpec } from './template/templateSpec';
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
import { AutoSensitiveFile, RedactFn, SecurityReviewPanel } from './ui/securityReviewPanel';
import { loadRankingMemory, saveRankingMemory } from './pipeline/rankingMemory';
import { appendNewFilesFallback, buildRankingInsertionPrompt, getRankingInsertionSchema, mergeNewFilesIntoRanking, parseRankingPlacements } from './pipeline/rankingInsertion';
import { ReadmeData } from './types';
import { asErrorMessage, describePreSelectionError } from './utils/errors';
import { countRedactions, isEnvFile, redactSecrets } from './utils/secretRedactor';

let statusBarItem: vscode.StatusBarItem | undefined;
let updateStatusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand('readmeGeneratorAi.generateReadme', () =>
    generateReadme(context)
  );
  context.subscriptions.push(command);

  const updateCommand = vscode.commands.registerCommand('readmeGeneratorAi.updateReadme', () =>
    updateReadme(context)
  );
  context.subscriptions.push(updateCommand);

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

  updateStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  updateStatusBarItem.text = '$(sync) Update README';
  updateStatusBarItem.tooltip = 'Actualizar un README existente sin perder tu estructura';
  updateStatusBarItem.command = 'readmeGeneratorAi.updateReadme';
  updateStatusBarItem.show();
  context.subscriptions.push(updateStatusBarItem);
}

export function deactivate(): void {
  statusBarItem?.dispose();
  updateStatusBarItem?.dispose();
}

// Muestra un mensaje en la barra de estado ligado a la vida de una promesa: el
// mensaje permanece visible hasta que la operación termina, en lugar de
// desaparecer tras un tiempo fijo. Así se elimina el hueco sin feedback en los
// últimos segundos de las llamadas largas al modelo (parecía que el proceso
// había terminado o fallado cuando en realidad seguía ejecutándose).
function withStatusBar<T>(message: string, task: Thenable<T>): Thenable<T> {
  vscode.window.setStatusBarMessage(message, task);
  return task;
}

// Contexto preparado del repositorio: ficheros seleccionados y piezas de render,
// listos para la llamada grande. Lo comparten generar (extracción) y actualizar
// (revisión anclada). La preparación (escaneo, seguridad, ranking, lectura) es
// idéntica; solo cambia la llamada grande que hace cada modo con este contexto.
interface RepositoryContext {
  client: AzureResponsesClient;
  selectedFiles: SelectedFile[];
  repositoryMap: RepositoryMap;
  renderer: TemplateRenderer;
  templatePath: string;
  nanoReasonsByPath: Map<string, string>;
  unreadFiles: UnreadFileInfo[];
  nanoWarnings: string[];
  trace: GenerationTrace;
  debugTrace: boolean;
  // Info de reutilización de ranking (Paso 0 del actualizador). En generación:
  // reused=false, newlyRankedPaths=[], fullRerankForced=false, newDetectedCount=0.
  // newDetectedCount = ficheros detectados como nuevos; newlyRankedPaths = los que el
  // nano decidió colocar (los demás los descartó). Distinguirlos es clave para depurar.
  reuseInfo: { reused: boolean; newlyRankedPaths: string[]; fullRerankForced: boolean; newDetectedCount: number };
}

// Umbral de ficheros nuevos por encima del cual el actualizador descarta la inserción
// incremental y hace un ranking completo fresco (p. ej. movimiento masivo de carpetas).
const FULL_RERANK_NEW_RATIO = 0.4;

// Ranking del nano de una generación anterior, recuperado de la traza. En el modo
// actualizar se reutiliza: un fichero importante antes lo sigue siendo, así que no
// se re-rankea todo, solo los ficheros NUEVOS (los que no están en knownPaths).
interface ReuseRanking {
  previousSelection: FileSelectionItem[];
  knownPaths: Set<string>;
}

// Escanea el repo, aplica la capa de seguridad, resuelve el ranking (nano completo
// o reutilizado), lee los archivos clave y extrae los datos estructurados. Lo
// comparten generar (extracción) y actualizar (revisión anclada). La capa de
// seguridad vive aquí, en un único sitio, para que ambos flujos protejan los datos
// sensibles de forma idéntica. Con `options.reuseRanking` se salta el nano salvo
// para los ficheros nuevos.
async function prepareRepositoryContext(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  settings: ReturnType<typeof getSettings>,
  options?: { reuseRanking?: ReuseRanking }
): Promise<RepositoryContext | undefined> {
  const candidates = await withStatusBar(
    'README Generator AI: escaneando repositorio...',
    scanRepository(workspaceFolder)
  );
  if (candidates.length === 0) {
    vscode.window.showErrorMessage('No se encontraron archivos relevantes para analizar.');
    return undefined;
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

  const inventoryByPath = new Map(inventory.selectorInventory.map(f => [f.relativePath, f]));
  const autoSensitiveFiles: AutoSensitiveFile[] = inventory.selectorInventory
    .map(f => classifySensitiveFile(f.relativePath))
    .filter((f): f is AutoSensitiveFile => f !== null);

  const redact: RedactFn = async (paths) => {
    const result = [];
    for (const relativePath of paths) {
      const file = inventoryByPath.get(relativePath);
      if (!file) {
        continue;
      }
      const read = await readRawContent(file, PRE_SELECTION_MAX_BYTES_PER_FILE);
      if (!read) {
        continue;
      }
      const content = redactSecrets(read.content, relativePath);
      result.push({ path: relativePath, content, redactionCount: countRedactions(content) });
    }
    return result;
  };

  const securityResult = await SecurityReviewPanel.show(
    { autoSensitiveFiles, candidateFiles: inventory.selectorInventory.map(f => ({ relativePath: f.relativePath })) },
    context.extensionUri,
    redact
  );
  if (securityResult.action === 'cancel') {
    return undefined;
  }
  const excludedPaths = new Set(securityResult.excludePaths);
  const contentOverrides = new Map(securityResult.redactedFiles.map(f => [f.path, f.content]));
  trace.securitySummary = {
    excludedPaths: securityResult.excludePaths,
    redactedFiles: securityResult.redactedFiles.map(f => ({ path: f.path, redactionCount: countRedactions(f.content) }))
  };
  const sendableInventory = inventory.selectorInventory.filter(f => !excludedPaths.has(f.relativePath));
  if (sendableInventory.length === 0) {
    vscode.window.showErrorMessage('No quedan archivos para analizar después de excluir los marcados como confidenciales.');
    return undefined;
  }

  const preSelectionDeployment = getPreSelectionDeployment(settings);
  const allCandidateFiles = await withStatusBar(
    `README Generator AI: leyendo repositorio completo (${sendableInventory.length} archivos)...`,
    readAllCandidateFiles(sendableInventory, PRE_SELECTION_MAX_BYTES_PER_FILE, { overrides: contentOverrides, exclude: excludedPaths })
  );
  trace.preSelectionDeployment = preSelectionDeployment;
  trace.mainModelDeployment = settings.deployment;
  trace.preSelectionFilesSentCount = allCandidateFiles.length;

  // --- Resolución del ranking: nano completo o reutilizado (solo ficheros nuevos) ---
  let rankedFiles: CandidateFile[];
  let nanoReasonsByPath: Map<string, string>;
  let nanoWarnings: string[];

  let reused = false;
  let newlyRankedPaths: string[] = [];
  const reuse = options?.reuseRanking;
  const newCandidates = reuse
    ? allCandidateFiles.filter((f) => !reuse.knownPaths.has(f.relativePath))
    : [];
  // Si demasiados ficheros son nuevos (p. ej. movimiento masivo de carpetas), la
  // inserción incremental deja de tener sentido y podría degradar el ranking: en su
  // lugar se hace un ranking completo fresco, como el del generador.
  const tooManyNew =
    reuse !== undefined &&
    allCandidateFiles.length > 0 &&
    newCandidates.length / allCandidateFiles.length > FULL_RERANK_NEW_RATIO;

  if (reuse && !tooManyNew) {
    reused = true;
    const previous = validateFileSelection(
      { selectedFiles: reuse.previousSelection, discardedFiles: [], warnings: [] },
      sendableInventory
    );
    const reasons = new Map<string, string>(reuse.previousSelection.map((item) => [item.path, item.reason]));
    let ranking = previous.ranking;
    let warnings = previous.warnings;

    if (newCandidates.length > 0) {
      // Paso 0b: el nano coloca los ficheros nuevos en su posición respecto al ranking
      // existente (orden viejo FIJO); la fusión es mecánica.
      const insertionPrompt = buildRankingInsertionPrompt(reuse.previousSelection, newCandidates, repositoryMap);
      trace.selectionPrompt = insertionPrompt;
      try {
        const nanoResult = await withStatusBar(
          `README Generator AI: colocando ${newCandidates.length} archivo(s) nuevo(s) en el ranking...`,
          client.callWithSchema(insertionPrompt, 'ranking_insertion', getRankingInsertionSchema(), preSelectionDeployment)
        );
        const placements = parseRankingPlacements(nanoResult.data);
        const merged = mergeNewFilesIntoRanking(ranking, newCandidates, placements);
        ranking = merged.ranking;
        newlyRankedPaths = merged.insertedPaths;
        for (const placement of placements) {
          if (placement.decision === 'keep') {
            reasons.set(placement.path, placement.reason);
          } else {
            warnings = warnings.concat(`Nano descartó el fichero nuevo ${placement.path}: ${placement.reason || 'sin razón'}`);
          }
        }
        warnings = warnings.concat(merged.warnings);
        trace.nanoTokenUsage = nanoResult.tokenUsage;
      } catch (error) {
        // Fallback seguro: si la colocación falla, los nuevos se añaden al final.
        const appended = appendNewFilesFallback(ranking, newCandidates);
        ranking = appended.ranking;
        newlyRankedPaths = appended.insertedPaths;
        warnings = warnings.concat(`No se pudieron colocar los archivos nuevos, se añaden al final: ${asErrorMessage(error)}`);
      }
    } else {
      trace.selectionPrompt = '(ranking reutilizado de la generación previa; sin archivos nuevos)';
    }

    if (ranking.length === 0) {
      vscode.window.showErrorMessage('El ranking previo no contiene archivos válidos en el repositorio actual.');
      return undefined;
    }

    rankedFiles = ranking;
    nanoReasonsByPath = reasons;
    nanoWarnings = warnings;
    trace.llmSelection = ranking.map((f) => ({ path: f.relativePath, reason: reasons.get(f.relativePath) ?? '' }));
  } else {
    const contentPrompt = buildContentSelectionPrompt(repositoryMap, allCandidateFiles);
    trace.selectionPrompt = contentPrompt;
    let nanoResult;
    try {
      nanoResult = await withStatusBar(
        `README Generator AI: seleccionando archivos clave con modelo ligero...`,
        client.preSelectImportantFiles(contentPrompt, preSelectionDeployment)
      );
    } catch (error) {
      vscode.window.showErrorMessage(describePreSelectionError(error, preSelectionDeployment));
      return undefined;
    }
    const validated = validateFileSelection(nanoResult.data, sendableInventory);
    if (validated.ranking.length === 0) {
      vscode.window.showErrorMessage(
        `El modelo '${preSelectionDeployment}' no devolvió ninguna ruta de archivo válida. ` +
        `Verifica que el modelo de pre-selección esté configurado correctamente.`
      );
      return undefined;
    }
    trace.llmSelection = nanoResult.data.selectedFiles;
    trace.llmDiscardedFiles = nanoResult.data.discardedFiles;
    trace.nanoTokenUsage = nanoResult.tokenUsage;
    rankedFiles = validated.ranking;
    nanoReasonsByPath = new Map(nanoResult.data.selectedFiles.map((item) => [item.path, item.reason]));
    nanoWarnings = nanoResult.data.warnings.concat(validated.warnings);
    if (tooManyNew) {
      // Re-ranking completo intencionado por el umbral (había memoria, pero demasiados nuevos).
      nanoWarnings = nanoWarnings.concat(
        `Más del ${Math.round(FULL_RERANK_NEW_RATIO * 100)}% de los ficheros son nuevos; se hizo un ranking completo en lugar de incremental.`
      );
    }
  }

  const llmDiscardedSummary = [summarizeLlmDiscarded(sendableInventory, rankedFiles)];
  trace.llmDiscardedSummary = llmDiscardedSummary;
  repositoryMap.discardedSummary = inventory.discardedSummary.concat(llmDiscardedSummary);
  trace.repositoryMap = repositoryMap;

  const { fitting, overflow } = splitByTokenBudget(rankedFiles, tokenBudget);

  let filesToRead: CandidateFile[] = [...fitting];

  if (overflow.length > 0) {
    const inputCostPerToken = getInputCostPerToken(settings.deployment);
    const overflowInfo = overflow.map((f) => ({
      path: f.relativePath,
      nanoReason: nanoReasonsByPath.get(f.relativePath) ?? '',
      estimatedTokens: estimateTokensFromSize(f.size)
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
    `README Generator AI: preparando ${filesToRead.length} archivos...`,
    6_000
  );
  // Reutilizamos el contenido ya leído para el nano en lugar de releer del disco:
  // evita una segunda pasada de I/O y garantiza que el modelo grande ve lo mismo que el nano.
  const readByPath = new Map(allCandidateFiles.map((f) => [f.relativePath, f]));
  const selectedFiles = filesToRead
    .map((f) => readByPath.get(f.relativePath))
    .filter((f): f is SelectedFile => f !== undefined);
  if (selectedFiles.length === 0) {
    vscode.window.showErrorMessage('No se pudieron leer los archivos seleccionados.');
    return undefined;
  }
  trace.finalReadFiles = buildFinalReadFileTrace(selectedFiles);
  trace.warnings = nanoWarnings;
  await saveTraceIfEnabled(workspaceFolder, settings.debugTrace, trace);

  const readPaths = new Set(selectedFiles.map((f) => f.relativePath));
  const unreadFiles = rankedFiles
    .filter((f) => !readPaths.has(f.relativePath))
    .map((f) => ({
      path: f.relativePath,
      nanoReason: nanoReasonsByPath.get(f.relativePath) ?? '',
      estimatedTokens: estimateTokensFromSize(f.size)
    }));

  // Memoria de ranking: se escribe SIEMPRE (independiente de debugTrace), tanto en
  // generación como en actualización. seenPaths = inventario considerable actual (lo
  // que pasa el filtro heurístico y no se excluye por seguridad); así los ficheros
  // borrados desaparecen también de la memoria de forma natural.
  try {
    await saveRankingMemory(workspaceFolder, {
      workspaceName: workspaceFolder.name,
      mode: reuse ? 'update' : 'generate',
      ranking: rankedFiles.map((f) => ({ path: f.relativePath, reason: nanoReasonsByPath.get(f.relativePath) ?? '' })),
      seenPaths: sendableInventory.map((f) => f.relativePath)
    });
  } catch (error) {
    vscode.window.showWarningMessage(`No se pudo guardar la memoria de ranking: ${asErrorMessage(error)}`);
  }

  const renderer = new TemplateRenderer(context.extensionUri);
  const templatePath = await renderer.resolveTemplatePath(settings.templatePath);
  initTemplateSpec(await fs.readFile(templatePath, 'utf8'));

  return {
    client,
    selectedFiles,
    repositoryMap,
    renderer,
    templatePath,
    nanoReasonsByPath,
    unreadFiles,
    nanoWarnings,
    trace,
    debugTrace: settings.debugTrace,
    reuseInfo: { reused, newlyRankedPaths, fullRerankForced: tooManyNew, newDetectedCount: newCandidates.length }
  };
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

    const ctx = await prepareRepositoryContext(context, workspaceFolder, settings);
    if (!ctx) {
      return;
    }
    const { renderer, templatePath } = ctx;

    const extractionResult = await withStatusBar(
      `README Generator AI: analizando ${ctx.selectedFiles.length} archivos...`,
      ctx.client.extractReadmeData(
        buildExtractionPrompt(ctx.selectedFiles, workspaceFolder.name, ctx.repositoryMap, {
          nanoReasonsByPath: ctx.nanoReasonsByPath,
          unreadFiles: ctx.unreadFiles
        })
      )
    );
    ctx.trace.mainModelTokenUsage = extractionResult.tokenUsage;
    const finalReadmeData = extractionResult.data.data;
    const finalWarnings = ctx.nanoWarnings.concat(extractionResult.data.warnings);
    ctx.trace.warnings = finalWarnings;
    await saveTraceIfEnabled(workspaceFolder, ctx.debugTrace, ctx.trace);

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
        const dataForRender = prepareDataForReview(data, completedOptions);
        return renderer.render(templatePath, dataForRender, completedOptions);
      }
    );
    if (editResult.action !== 'save') {
      return;
    }

    const finalRenderOptions = completeRenderOptions(editResult.data, editResult.renderOptions);
    const finalDataForRender = prepareDataForReview(editResult.data, finalRenderOptions);
    const finalMarkdown = await renderer.render(templatePath, finalDataForRender, finalRenderOptions);
    const outputUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, 'README.generated.md'));
    await vscode.workspace.fs.writeFile(outputUri, new TextEncoder().encode(finalMarkdown));

    const document = await vscode.workspace.openTextDocument(outputUri);
    await vscode.window.showTextDocument(document, { preview: false });
    vscode.window.showInformationMessage('README.generated.md generado correctamente.');
  } catch (error) {
    vscode.window.showErrorMessage(`No se pudo generar el README: ${asErrorMessage(error)}`);
  }
}

// Modo actualizar (REDISEÑO v4 — en reconstrucción, fase a fase).
//
// Objetivo: EDITAR el README existente, nunca regenerarlo. Se comparan las FICHAS
// (el valor por campo de la plantilla) del README contra las del código en dos
// direcciones, se verifican los sospechosos con evidencia, el humano decide en el
// panel y solo se parchean los campos aprobados (con guardarraíl de diff). El
// generador NO se toca; la lógica del actualizador vive aislada en src/update/.
//
// Tubería (se implementa paso a paso; stubs en src/update/updatePipeline.ts):
//   Paso 0  Ranking           reutiliza traza + nano solo para ficheros nuevos.
//   Paso 1  README → fichas    (nano)      extractReadmeFichas
//   Paso 2  Código → fichas     (grande)    extractCodeFichas
//   Paso 3  Comparar            (nano)      compareFichas
//   Paso 4  Verificar           (nano)      verifySuspects
//   Paso 5  Panel               (webview)   UpdateReviewPanel
//   Paso 6  Aplicar+guardarraíl             applyApprovedChanges
async function updateReadme(context: vscode.ExtensionContext): Promise<void> {
  try {
    const workspaceFolder = getActiveWorkspaceFolder();
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('Abre un repositorio local en VS Code antes de actualizar el README.');
      return;
    }

    const settings = getSettings();
    if (!(await ensureConfigured(settings))) {
      return;
    }

    const target = await detectReadmeFile(workspaceFolder);
    if (target === undefined) {
      return;
    }
    if (target === null) {
      const choice = await vscode.window.showInformationMessage(
        'No se encontró un README existente (README.md o README.generated.md) para actualizar.',
        'Generar uno nuevo'
      );
      if (choice === 'Generar uno nuevo') {
        await generateReadme(context);
      }
      return;
    }

    // Paso 0 — Lectura del repo con ranking reutilizado (o completo si no hay
    // memoria previa). Reutiliza el filtro heurístico + la capa de seguridad del
    // generador vía prepareRepositoryContext, y deja el spec de plantilla listo.
    const previous = await loadPreviousRanking(workspaceFolder);
    const ctx = await prepareRepositoryContext(
      context,
      workspaceFolder,
      settings,
      previous ? { reuseRanking: previous } : undefined
    );
    if (!ctx) {
      return;
    }

    // Validación del Paso 0: todavía no extraemos ni comparamos. Reportamos qué se
    // ha leído y cuántos ficheros nuevos ha rankeado el nano frente a la memoria.
    const { reused, newlyRankedPaths, fullRerankForced, newDetectedCount } = ctx.reuseInfo;
    const resumen = reused
      ? `ranking reutilizado; ${newDetectedCount} nuevo(s) DETECTADO(s), ${newlyRankedPaths.length} colocado(s) por el nano`
      : fullRerankForced
        ? `demasiados ficheros nuevos (${newDetectedCount}): ranking completo fresco`
        : 'ranking completo (sin memoria previa)';
    vscode.window.showInformationMessage(
      `Paso 0 OK sobre ${target.label}: ${resumen}. ${ctx.selectedFiles.length} fichero(s) leído(s). ` +
      `Pendientes los pasos 1-6 (extraer, comparar, verificar, panel, aplicar).`
    );
  } catch (error) {
    vscode.window.showErrorMessage(`No se pudo actualizar el README: ${asErrorMessage(error)}`);
  }
}

interface ReadmeTarget {
  uri: vscode.Uri;
  label: string;
}

// Localiza el README a actualizar. Devuelve null si no hay ninguno (para ofrecer
// generar) y undefined si el usuario cancela el selector cuando hay varios.
async function detectReadmeFile(workspaceFolder: vscode.WorkspaceFolder): Promise<ReadmeTarget | null | undefined> {
  const names = ['README.md', 'README.generated.md'];
  const existing: ReadmeTarget[] = [];
  for (const name of names) {
    const uri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, name));
    if (await fileExists(uri)) {
      existing.push({ uri, label: name });
    }
  }
  if (existing.length === 0) {
    return null;
  }
  if (existing.length === 1) {
    return existing[0];
  }
  const pick = await vscode.window.showQuickPick(
    existing.map((entry) => entry.label),
    { placeHolder: '¿Qué README quieres actualizar?' }
  );
  if (!pick) {
    return undefined;
  }
  return existing.find((entry) => entry.label === pick);
}

// Recupera la memoria de ranking de la última generación/actualización (fichero
// dedicado `ranking.json`, escrito siempre). knownPaths = todos los ficheros que el
// nano ha considerado, para distinguir los nuevos. undefined si no hay memoria
// utilizable (→ el actualizador hará una pasada completa como fallback).
async function loadPreviousRanking(workspaceFolder: vscode.WorkspaceFolder): Promise<ReuseRanking | undefined> {
  const memory = await loadRankingMemory(workspaceFolder);
  if (!memory || memory.ranking.length === 0) {
    return undefined;
  }
  const knownPaths = new Set<string>(
    memory.seenPaths.length ? memory.seenPaths : memory.ranking.map((entry) => entry.path)
  );
  return { previousSelection: memory.ranking, knownPaths };
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function readFileText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return new TextDecoder().decode(bytes);
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

const KEY_MATERIAL_PATTERN = /(?:\.(?:pem|key|pfx|p12|keystore|jks|asc|gpg)|(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519))$/i;
const CREDENTIAL_FILE_PATTERN = /(?:(?:^|\/)\.(?:npmrc|netrc|pgpass|htpasswd)|\.tfvars|(?:^|\/)(?:secrets?|credentials?)\.[^/]+)$/i;

function classifySensitiveFile(relativePath: string): AutoSensitiveFile | null {
  if (KEY_MATERIAL_PATTERN.test(relativePath)) {
    return { path: relativePath, suggested: 'exclude', reason: 'Material criptográfico / clave privada' };
  }
  if (isEnvFile(relativePath)) {
    return { path: relativePath, suggested: 'redact', reason: 'Variables de entorno (.env)' };
  }
  if (CREDENTIAL_FILE_PATTERN.test(relativePath)) {
    return { path: relativePath, suggested: 'redact', reason: 'Posibles credenciales' };
  }
  return null;
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
