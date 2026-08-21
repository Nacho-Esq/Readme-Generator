import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { AzureResponsesClient } from './azure/azureResponsesClient';
import { ensureConfigured, getPreSelectionDeployment, getReadDepthTokenBudget, getSettings } from './config';
import { clearCredentialsCommand, migrateCredentialsFromSettings, setApiKeyCommand, setEndpointCommand } from './credentials';
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
import { hashContent, loadRankingMemory, saveRankingMemory } from './pipeline/rankingMemory';
import { resolveStorageDir } from './storage/extensionStorage';
import { appendNewFilesFallback, buildRankingInsertionPrompt, getRankingInsertionSchema, mergeNewFilesIntoRanking, parseRankingPlacements } from './pipeline/rankingInsertion';
import { applyApprovedChanges, compareFichas, extractCodeFichas, extractHeadings, extractReadmeFichas, getPopulatedFichaPaths, reconcileSuspects } from './update/updatePipeline';
import { formatFichaValue, isFichaEmpty, parseFichaText } from './update/fichaUtils';
import { ApplyChange } from './update/applyPrompt';
import { UpdateCard, UpdateReviewPanel } from './update/updateReviewPanel';
import { ExtensionSettings, ReadmeData } from './types';
import { asErrorMessage, describePreSelectionError } from './utils/errors';
import { classifySensitiveFile, countRedactions, redactSecrets } from './utils/secretRedactor';
import { ProgressReporter, runWithProgress } from './ui/progressReporter';
import { resolveTargetFolders } from './ui/targetFolder';

let statusBarItem: vscode.StatusBarItem | undefined;
let updateStatusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // Migración única de credenciales de settings.json → SecretStorage. Fire-and-forget:
  // no debe bloquear la activación; es casi instantánea y solo actúa la primera vez.
  void migrateCredentialsFromSettings(context);

  // Los comandos de generar/actualizar reciben, cuando se invocan desde el menú
  // contextual del explorador sobre una carpeta, la URI de esa carpeta como primer
  // argumento. Desde la paleta o la barra de estado el argumento llega undefined y la
  // carpeta objetivo se resuelve preguntando (QuickPick) si hay varias candidatas.
  const command = vscode.commands.registerCommand('readmeGeneratorAi.generateReadme', (resource?: vscode.Uri) =>
    generateReadme(context, resource)
  );
  context.subscriptions.push(command);

  context.subscriptions.push(
    vscode.commands.registerCommand('readmeGeneratorAi.setApiKey', () => setApiKeyCommand(context)),
    vscode.commands.registerCommand('readmeGeneratorAi.setEndpoint', () => setEndpointCommand(context)),
    vscode.commands.registerCommand('readmeGeneratorAi.clearCredentials', () => clearCredentialsCommand(context))
  );

  const updateCommand = vscode.commands.registerCommand('readmeGeneratorAi.updateReadme', (resource?: vscode.Uri) =>
    updateReadme(context, resource)
  );
  context.subscriptions.push(updateCommand);

  const openTraceCommand = vscode.commands.registerCommand('readmeGeneratorAi.openLastTrace', () =>
    openLastTrace(context)
  );
  context.subscriptions.push(openTraceCommand);

  const openDataCommand = vscode.commands.registerCommand('readmeGeneratorAi.openGeneratedData', () =>
    openGeneratedData(context)
  );
  context.subscriptions.push(openDataCommand);

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
  // Advertencias útiles para el USUARIO que genera el README: huecos de cobertura del
  // repo que dejan secciones incompletas (p. ej. falta de fichero de entorno). Se
  // muestran en el panel. Las emite el nano de selección con el prompt de cobertura.
  userWarnings: string[];
  // Advertencias de PROCESO/diagnóstico (rutas fuera del inventario, ficheros nuevos
  // descartados, re-ranking forzado...). Solo interesan al desarrollador de la
  // extensión: van a la traza, nunca al panel del usuario.
  processWarnings: string[];
  trace: GenerationTrace;
  // Carpeta de datos privada de la extensión para este proyecto (fuera del repo).
  // undefined solo si no hay workspace abierto; el guardado se salta con seguridad.
  storageDir: vscode.Uri | undefined;
  // Info de reutilización de ranking (Paso 0 del actualizador). En generación:
  // reused=false, newlyRankedPaths=[], fullRerankForced=false, newDetectedCount=0.
  // newDetectedCount = ficheros detectados como nuevos; newlyRankedPaths = los que el
  // nano decidió colocar (los demás los descartó). Distinguirlos es clave para depurar.
  reuseInfo: { reused: boolean; newlyRankedPaths: string[]; fullRerankForced: boolean; newDetectedCount: number; changedDetectedCount: number };
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
  // Hash de contenido por fichero de la pasada anterior, para detectar cambiados.
  previousHashes: Map<string, string>;
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
  settings: ExtensionSettings,
  reporter: ProgressReporter,
  options?: { reuseRanking?: ReuseRanking }
): Promise<RepositoryContext | undefined> {
  reporter.phase('scan');
  const candidates = await scanRepository(workspaceFolder);
  if (candidates.length === 0) {
    vscode.window.showErrorMessage('No se encontraron archivos relevantes para analizar.');
    return undefined;
  }

  const client = new AzureResponsesClient(settings);
  // Carpeta de datos privada de la extensión para este proyecto (fuera del repo).
  const storageDir = resolveStorageDir(context, workspaceFolder);
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

  // Espera humana: congelamos la barra mientras el usuario revisa la capa de seguridad.
  reporter.freeze('Esperando la revisión de seguridad…');
  const securityResult = await SecurityReviewPanel.show(
    { autoSensitiveFiles, candidateFiles: inventory.selectorInventory.map(f => ({ relativePath: f.relativePath })) },
    context.extensionUri,
    redact
  );
  reporter.unfreeze();
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
  reporter.phaseWithMessage('read', `Leyendo el repositorio completo (${sendableInventory.length} archivos)…`);
  const allCandidateFiles = await readAllCandidateFiles(sendableInventory, PRE_SELECTION_MAX_BYTES_PER_FILE, { overrides: contentOverrides, exclude: excludedPaths });
  trace.preSelectionDeployment = preSelectionDeployment;
  trace.mainModelDeployment = settings.deployment;
  trace.preSelectionFilesSentCount = allCandidateFiles.length;

  // --- Resolución del ranking: nano completo o reutilizado (solo ficheros nuevos) ---
  let rankedFiles: CandidateFile[];
  let nanoReasonsByPath: Map<string, string>;
  let userWarnings: string[];
  let processWarnings: string[];

  // Hash de contenido de cada candidato: permite guardar la "foto" del proyecto para
  // que la próxima pasada sepa qué ficheros han cambiado (no solo cuáles son nuevos).
  const currentHashes = new Map(allCandidateFiles.map((f) => [f.relativePath, hashContent(f.content)]));

  let reused = false;
  let newlyRankedPaths: string[] = [];
  const reuse = options?.reuseRanking;
  // NUEVOS: nunca vistos. CAMBIADOS: vistos pero con hash distinto → hay que re-evaluar su
  // importancia (un fichero que antes no aportaba puede aportar ahora, o viceversa). Ambos
  // se vuelven a colocar en el ranking.
  const newCandidates = reuse
    ? allCandidateFiles.filter((f) => !reuse.knownPaths.has(f.relativePath))
    : [];
  const changedCandidates = reuse
    ? allCandidateFiles.filter(
        (f) =>
          reuse.knownPaths.has(f.relativePath) &&
          reuse.previousHashes.has(f.relativePath) &&
          reuse.previousHashes.get(f.relativePath) !== currentHashes.get(f.relativePath)
      )
    : [];
  const toPlace = [...newCandidates, ...changedCandidates];
  const changedPaths = new Set(changedCandidates.map((f) => f.relativePath));
  // Si hay que recolocar demasiados ficheros (nuevos + cambiados; p. ej. movimiento masivo
  // o refactor grande), la inserción incremental deja de tener sentido: se hace un ranking
  // completo fresco, como el del generador.
  const tooManyNew =
    reuse !== undefined &&
    allCandidateFiles.length > 0 &&
    toPlace.length / allCandidateFiles.length > FULL_RERANK_NEW_RATIO;

  if (reuse && !tooManyNew) {
    reused = true;
    const previous = validateFileSelection(
      { selectedFiles: reuse.previousSelection, discardedFiles: [], warnings: [] },
      sendableInventory
    );
    const reasons = new Map<string, string>(reuse.previousSelection.map((item) => [item.path, item.reason]));
    // Base FIJA del ranking: lo previo MENOS los ficheros cambiados (esos se recolocan por
    // si su importancia ha cambiado). Los no tocados conservan su orden.
    const baseSelection = reuse.previousSelection.filter((item) => !changedPaths.has(item.path));
    let ranking = previous.ranking.filter((f) => !changedPaths.has(f.relativePath));
    // En reutilización el nano solo COLOCA ficheros (nuevos + cambiados) en el ranking
    // base; no hay análisis de cobertura del README, así que todo lo que surge es proceso.
    let warnings = previous.warnings;

    if (toPlace.length > 0) {
      // Paso 0b: el nano coloca los ficheros nuevos Y cambiados en su posición respecto al
      // ranking base (orden de los no tocados FIJO); la fusión es mecánica.
      const insertionPrompt = buildRankingInsertionPrompt(baseSelection, toPlace, repositoryMap);
      trace.selectionPrompt = insertionPrompt;
      reporter.phaseWithMessage('ranking', `Recolocando ${toPlace.length} archivo(s) (nuevos + cambiados) en el ranking…`);
      try {
        const nanoResult = await client.callWithSchema(insertionPrompt, 'ranking_insertion', getRankingInsertionSchema(), preSelectionDeployment);
        const placements = parseRankingPlacements(nanoResult.data);
        const merged = mergeNewFilesIntoRanking(ranking, toPlace, placements);
        ranking = merged.ranking;
        newlyRankedPaths = merged.insertedPaths;
        for (const placement of placements) {
          if (placement.decision === 'keep') {
            reasons.set(placement.path, placement.reason);
          } else {
            warnings = warnings.concat(`Nano descartó el fichero ${placement.path}: ${placement.reason || 'sin razón'}`);
          }
        }
        warnings = warnings.concat(merged.warnings);
        trace.nanoTokenUsage = nanoResult.tokenUsage;
      } catch (error) {
        // Fallback seguro: si la colocación falla, se añaden al final.
        const appended = appendNewFilesFallback(ranking, toPlace);
        ranking = appended.ranking;
        newlyRankedPaths = appended.insertedPaths;
        warnings = warnings.concat(`No se pudieron recolocar los archivos, se añaden al final: ${asErrorMessage(error)}`);
      }
    } else {
      reporter.phase('ranking');
      trace.selectionPrompt = '(ranking reutilizado de la generación previa; sin archivos nuevos ni cambiados)';
    }

    if (ranking.length === 0) {
      vscode.window.showErrorMessage('El ranking previo no contiene archivos válidos en el repositorio actual.');
      return undefined;
    }

    rankedFiles = ranking;
    nanoReasonsByPath = reasons;
    userWarnings = [];
    processWarnings = warnings;
    trace.llmSelection = ranking.map((f) => ({ path: f.relativePath, reason: reasons.get(f.relativePath) ?? '' }));
  } else {
    const contentPrompt = buildContentSelectionPrompt(repositoryMap, allCandidateFiles);
    trace.selectionPrompt = contentPrompt;
    reporter.phaseWithMessage('ranking', 'Seleccionando los archivos clave con el modelo ligero…');
    let nanoResult;
    try {
      nanoResult = await client.preSelectImportantFiles(contentPrompt, preSelectionDeployment);
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
    // Del nano de selección: advertencias de cobertura del README → usuario.
    userWarnings = nanoResult.data.warnings;
    // De la validación (rutas fuera del inventario): diagnóstico → proceso.
    processWarnings = validated.warnings;
    if (tooManyNew) {
      // Re-ranking completo intencionado por el umbral (había memoria, pero demasiados
      // ficheros nuevos o cambiados).
      processWarnings = processWarnings.concat(
        `Más del ${Math.round(FULL_RERANK_NEW_RATIO * 100)}% de los ficheros son nuevos o cambiados; se hizo un ranking completo en lugar de incremental.`
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
    reporter.freeze('Esperando tu decisión sobre el presupuesto de lectura…');
    const budgetResult = await BudgetWarningPanel.show(
      overflowInfo,
      inputCostPerToken,
      context.extensionUri
    );
    reporter.unfreeze();
    if (budgetResult.action === 'expand' && budgetResult.selectedPaths.length > 0) {
      const overflowByPath = new Map(overflow.map((f) => [f.relativePath, f]));
      const extras = budgetResult.selectedPaths
        .map((p) => overflowByPath.get(p))
        .filter((f): f is CandidateFile => f !== undefined);
      filesToRead = [...fitting, ...extras];
    }
  }

  vscode.window.setStatusBarMessage(
    `CAI Readme-Generator: preparando ${filesToRead.length} archivos...`,
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
  // La traza (depuración) conserva TODO: primero proceso, luego cobertura de usuario.
  trace.warnings = processWarnings.concat(userWarnings);
  await saveTrace(storageDir, trace);

  const readPaths = new Set(selectedFiles.map((f) => f.relativePath));
  const unreadFiles = rankedFiles
    .filter((f) => !readPaths.has(f.relativePath))
    .map((f) => ({
      path: f.relativePath,
      nanoReason: nanoReasonsByPath.get(f.relativePath) ?? '',
      estimatedTokens: estimateTokensFromSize(f.size)
    }));

  // Memoria de ranking: se escribe SIEMPRE, tanto en generación como en
  // actualización. seenPaths = inventario considerable actual (lo que pasa el filtro
  // heurístico y no se excluye por seguridad); así los ficheros borrados desaparecen
  // también de la memoria de forma natural.
  if (storageDir) {
    try {
      await saveRankingMemory(storageDir, {
        workspaceName: workspaceFolder.name,
        mode: reuse ? 'update' : 'generate',
        ranking: rankedFiles.map((f) => ({ path: f.relativePath, reason: nanoReasonsByPath.get(f.relativePath) ?? '' })),
        seenPaths: sendableInventory.map((f) => f.relativePath),
        fileHashes: Object.fromEntries(currentHashes)
      });
    } catch (error) {
      vscode.window.showWarningMessage(`No se pudo guardar la memoria de ranking: ${asErrorMessage(error)}`);
    }
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
    userWarnings,
    processWarnings,
    trace,
    storageDir,
    reuseInfo: { reused, newlyRankedPaths, fullRerankForced: tooManyNew, newDetectedCount: newCandidates.length, changedDetectedCount: changedCandidates.length }
  };
}

// Orquestador de "Generar README". Resuelve la(s) carpeta(s) objetivo (raíz del
// workspace, una subcarpeta elegida en el menú contextual, o la elección del usuario
// en un QuickPick cuando hay varias candidatas) y ejecuta la generación para cada una.
// Con `resource` (menú contextual sobre una carpeta) genera directamente para ESA
// carpeta sin preguntar.
async function generateReadme(context: vscode.ExtensionContext, resource?: vscode.Uri): Promise<void> {
  const targets = await resolveTargetFolders(resource);
  if (!targets || targets.length === 0) {
    return;
  }

  const settings = await getSettings(context);
  if (!(await ensureConfigured(settings))) {
    return;
  }

  for (const target of targets) {
    await runGenerateForFolder(context, target, settings);
  }
}

// Generación para UNA carpeta objetivo. Toda la operación transcurre bajo una barra de
// progreso discreta en la barra inferior (ProgressLocation.Window) que refleja el
// avance real por fases.
async function runGenerateForFolder(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  settings: ExtensionSettings
): Promise<void> {
  await runWithProgress(`CAI Readme-Generator · ${workspaceFolder.name}`, async (reporter) => {
    try {
      const ctx = await prepareRepositoryContext(context, workspaceFolder, settings, reporter);
      if (!ctx) {
        return;
      }
      const { renderer, templatePath } = ctx;

      reporter.phaseWithMessage('model', `Analizando ${ctx.selectedFiles.length} archivos con el modelo principal…`);
      const extractionResult = await ctx.client.extractReadmeData(
        buildExtractionPrompt(ctx.selectedFiles, workspaceFolder.name, ctx.repositoryMap, {
          nanoReasonsByPath: ctx.nanoReasonsByPath,
          unreadFiles: ctx.unreadFiles
        })
      );
      ctx.trace.mainModelTokenUsage = extractionResult.tokenUsage;
      const finalReadmeData = extractionResult.data.data;
      // Panel: solo lo accionable por el usuario (cobertura del nano + avisos de contenido
      // del modelo grande). Las advertencias de proceso NO se muestran aquí.
      const userWarnings = ctx.userWarnings.concat(extractionResult.data.warnings);
      // Traza (depuración): TODO, incluidas las de proceso.
      ctx.trace.warnings = ctx.processWarnings.concat(userWarnings);
      await saveTrace(ctx.storageDir, ctx.trace);

      reporter.phase('render');
      const review = analyzeReadmeData(finalReadmeData);
      const initialRenderOptions = completeRenderOptions(finalReadmeData, createDefaultRenderOptions());
      const initialReviewData = prepareDataForReview(finalReadmeData, initialRenderOptions);
      const initialMarkdown = await renderer.render(templatePath, initialReviewData, initialRenderOptions);

      // Espera humana: el panel de edición bloquea hasta que el usuario guarda o cierra.
      reporter.freeze('Esperando tu revisión en el panel de edición…');
      const editResult = await EditFormPanel.show(
        initialReviewData,
        initialMarkdown,
        userWarnings,
        context.extensionUri,
        review,
        initialRenderOptions,
        async (data, renderOptions) => {
          const completedOptions = completeRenderOptions(data, renderOptions);
          const dataForRender = prepareDataForReview(data, completedOptions);
          return renderer.render(templatePath, dataForRender, completedOptions);
        }
      );
      reporter.unfreeze('Guardando el README…');
      if (editResult.action !== 'save') {
        return;
      }

      const finalRenderOptions = completeRenderOptions(editResult.data, editResult.renderOptions);
      const finalDataForRender = prepareDataForReview(editResult.data, finalRenderOptions);
      const finalMarkdown = await renderer.render(templatePath, finalDataForRender, finalRenderOptions);
      const outputUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, 'README.generated.md'));
      await vscode.workspace.fs.writeFile(outputUri, new TextEncoder().encode(finalMarkdown));
      reporter.done();

      const document = await vscode.workspace.openTextDocument(outputUri);
      await vscode.window.showTextDocument(document, { preview: false });
      void notifyGeneratedWithTrace('README.generated.md generado correctamente.', ctx.storageDir);
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo generar el README: ${asErrorMessage(error)}`);
    }
  });
}

// Aviso de éxito con acceso directo a la traza. No bloquea el flujo (fire-and-forget):
// el README ya está escrito y abierto; el botón solo abre la traza si el usuario quiere.
async function notifyGeneratedWithTrace(message: string, storageDir: vscode.Uri | undefined): Promise<void> {
  if (!storageDir) {
    vscode.window.showInformationMessage(message);
    return;
  }
  const pick = await vscode.window.showInformationMessage(message, 'Ver traza');
  if (pick === 'Ver traza') {
    await openLastGenerationTrace(storageDir);
  }
}

// Modo actualizar.
//
// Objetivo: EDITAR el README existente, nunca regenerarlo. Se comparan las FICHAS
// (el valor por campo de la plantilla) del README contra las del código en dos
// direcciones, se verifican los sospechosos con evidencia, el humano decide en el
// panel y solo se parchean los campos aprobados (con guardarraíl de diff). El
// generador NO se toca; la lógica del actualizador vive aislada en src/update/.
//
// Tubería (pasos puros en src/update/updatePipeline.ts):
//   Paso 0  Ranking           reutiliza traza + nano solo para ficheros nuevos.
//   Paso 1  README → fichas    (nano)      extractReadmeFichas
//   Paso 2  Código → fichas     (grande)    extractCodeFichas
//   Paso 3  Comparar            (nano)      compareFichas
//   Paso 4  Verificar           (nano)      verifySuspects
//   Paso 5  Panel               (webview)   UpdateReviewPanel
//   Paso 6  Aplicar+guardarraíl             applyApprovedChanges
// Orquestador de "Update README". Resuelve la(s) carpeta(s) objetivo igual que el
// generador (menú contextual sobre una carpeta, o QuickPick con "Todas" si hay varias
// candidatas) y actualiza el README de cada una.
async function updateReadme(context: vscode.ExtensionContext, resource?: vscode.Uri): Promise<void> {
  const targets = await resolveTargetFolders(resource);
  if (!targets || targets.length === 0) {
    return;
  }

  const settings = await getSettings(context);
  if (!(await ensureConfigured(settings))) {
    return;
  }

  for (const target of targets) {
    await runUpdateForFolder(context, target, settings);
  }
}

// Actualización para UNA carpeta objetivo. La detección del README y el eventual
// selector (cuando hay README.md y README.generated.md) ocurren antes de la barra de
// progreso; la tubería pesada transcurre bajo ProgressLocation.Window.
async function runUpdateForFolder(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  settings: ExtensionSettings
): Promise<void> {
  const target = await detectReadmeFile(workspaceFolder);
  if (target === undefined) {
    return;
  }
  if (target === null) {
    const choice = await vscode.window.showInformationMessage(
      `No se encontró un README existente (README.md o README.generated.md) en ${workspaceFolder.name} para actualizar.`,
      'Generar uno nuevo'
    );
    if (choice === 'Generar uno nuevo') {
      await runGenerateForFolder(context, workspaceFolder, settings);
    }
    return;
  }

  await runWithProgress(`CAI Readme-Generator · Actualizar ${workspaceFolder.name}`, async (reporter) => {
    try {
      // Paso 0 — Lectura del repo con ranking reutilizado (o completo si no hay
      // memoria previa). Reutiliza el filtro heurístico + la capa de seguridad del
      // generador vía prepareRepositoryContext, y deja el spec de plantilla listo.
      const storageDir = resolveStorageDir(context, workspaceFolder);
      const previous = storageDir ? await loadPreviousRanking(storageDir) : undefined;
      const ctx = await prepareRepositoryContext(
        context,
        workspaceFolder,
        settings,
        reporter,
        previous ? { reuseRanking: previous } : undefined
      );
      if (!ctx) {
        return;
      }

      // Resumen del Paso 0 (informativo; el flujo continúa al Paso 1).
      const { reused, newlyRankedPaths, fullRerankForced, newDetectedCount, changedDetectedCount } = ctx.reuseInfo;
      const paso0 = reused
        ? `ranking reutilizado (${newDetectedCount} nuevo(s), ${changedDetectedCount} cambiado(s), ${newlyRankedPaths.length} recolocado(s))`
        : fullRerankForced
          ? `ranking completo (demasiados nuevos/cambiados: ${newDetectedCount + changedDetectedCount})`
          : 'ranking completo';
      void paso0;

      // A partir de aquí van las llamadas al modelo (fichas README, fichas código,
      // comparar, reconciliar): todo el tramo largo. Entramos en la fase 'model', que
      // avanza con creep por tiempo; el texto se refresca en cada paso sin saltar el %.
      reporter.phase('model');

      // Paso 1 — README → fichas. Extracción PURA del README con el modelo nano.
      const readmeText = await readFileText(target.uri);
      reporter.message('Leyendo el README actual (fichas)…');
      const readmeFichas = await extractReadmeFichas(ctx.client, readmeText, workspaceFolder.name, getPreSelectionDeployment(settings));

      // Alcance: SOLO los campos M/A que el README ya documenta (rellenos en el Paso 1).
      // Los que el humano descartó al generar, o borró después, quedan fuera y NO se
      // buscan en el código.
      const scopePaths = getPopulatedFichaPaths(readmeFichas.fichas);
      if (scopePaths.size === 0) {
        vscode.window.showInformationMessage(
          `${target.label} no tiene campos reconocibles de la plantilla; no hay nada que comparar.`
        );
        return;
      }

      // Paso 2 — Código → fichas (modelo grande), acotado a los campos en alcance, con
      // las instrucciones de la plantilla.
      reporter.message(`Analizando el código para ${scopePaths.size} campo(s)…`);
      const codeFichas = await extractCodeFichas(
        ctx.client,
        ctx.selectedFiles,
        workspaceFolder.name,
        ctx.repositoryMap,
        scopePaths,
        { nanoReasonsByPath: ctx.nanoReasonsByPath, unreadFiles: ctx.unreadFiles }
      );

      // Paso 3 — Comparar fichas (nano): por cada campo, same / readme_unsupported /
      // code_differs. Los 'same' se descartan; el resto son sospechosos.
      // Comparación con el modelo GRANDE (sin override): la entrada es pequeña (solo las
      // fichas, sin código) y juzga mucho mejor "¿es lo mismo con otras palabras?".
      reporter.message('Comparando el README con el código…');
      const comparisons = await compareFichas(ctx.client, scopePaths, readmeFichas.fichas, codeFichas.fichas);
      const suspects = comparisons.filter((c) => c.kind !== 'same');

      // Paso 4 — Reconciliar sospechosos (nano): propone el valor corregido y puede decidir
      // 'keep' (segundo filtro de falsos positivos). Solo update/remove llegan al panel.
      let verified: Awaited<ReturnType<typeof reconcileSuspects>> = [];
      if (suspects.length > 0) {
        reporter.message('Preparando propuestas de cambio…');
        verified = await reconcileSuspects(ctx.client, suspects, getPreSelectionDeployment(settings));
      }
      const proposals = verified.filter((v) => v.recommendation !== 'keep');

      // Volcado silencioso de las propuestas para inspección (debug); el panel es la UI.
      // Va al almacenamiento privado de la extensión (fuera del repo), como el resto de
      // datos. Se salta si no hay storageDir (sin workspace) o si falla: es solo debug.
      if (storageDir) {
        try {
          await vscode.workspace.fs.createDirectory(storageDir);
          await vscode.workspace.fs.writeFile(
            vscode.Uri.joinPath(storageDir, 'last-update-preview.json'),
            new TextEncoder().encode(JSON.stringify(proposals, null, 2))
          );
        } catch (error) {
          vscode.window.showWarningMessage(`No se pudo guardar la vista previa de la actualización: ${asErrorMessage(error)}`);
        }
      }

      if (proposals.length === 0) {
        vscode.window.showInformationMessage(
          `${target.label} ya está al día: no se detectaron cambios que proponer.`
        );
        return;
      }

      // Paso 5 — Panel de revisión: el humano decide por cada propuesta.
      const cards: UpdateCard[] = proposals.map((p) => ({
        path: p.path,
        label: p.label,
        section: p.section,
        panelKind: p.panelKind,
        recommendation: p.recommendation === 'remove' ? 'remove' : 'update',
        currentText: formatFichaValue(p.readmeValue, p.panelKind),
        proposedText: formatFichaValue(p.proposedValue, p.panelKind),
        reason: p.reason
      }));
      // Espera humana: congelamos la barra mientras el usuario decide en el panel.
      reporter.freeze('Esperando tu revisión de los cambios propuestos…');
      const result = await UpdateReviewPanel.show(cards, context.extensionUri, target.label);
      reporter.unfreeze();
      if (result.action !== 'save') {
        return;
      }

      // Paso 6 — Traducir las decisiones del panel a cambios y aplicarlos sobre el README.
      const proposalsByPath = new Map(proposals.map((p) => [p.path, p]));
      const changes: ApplyChange[] = [];
      for (const decision of result.resolved) {
        if (decision.decision === 'keep') {
          continue;
        }
        const proposal = proposalsByPath.get(decision.path);
        if (!proposal) {
          continue;
        }
        const newValue = decision.decision === 'edit'
          ? parseFichaText(decision.value ?? '', proposal.panelKind)
          : proposal.recommendation === 'remove'
            ? (proposal.panelKind === 'text' ? '' : [])
            : proposal.proposedValue;
        changes.push({
          section: proposal.section,
          label: proposal.label,
          action: isFichaEmpty(newValue, proposal.panelKind) ? 'remove' : 'update',
          currentText: formatFichaValue(proposal.readmeValue, proposal.panelKind),
          newText: formatFichaValue(newValue, proposal.panelKind)
        });
      }

      if (changes.length === 0) {
        vscode.window.showInformationMessage(`No hay cambios que aplicar en ${target.label}.`);
        return;
      }

      reporter.phase('render');
      const newMarkdown = await applyApprovedChanges(ctx.client, readmeText, changes, getPreSelectionDeployment(settings));

      // Guardarraíl estructural: los encabezados (#) no pueden haber cambiado.
      if (extractHeadings(readmeText).join('\n') !== extractHeadings(newMarkdown).join('\n')) {
        vscode.window.showErrorMessage(
          `No se aplicaron los cambios: la operación habría alterado la estructura (encabezados) de ${target.label}. Inténtalo de nuevo.`
        );
        return;
      }

      await vscode.workspace.fs.writeFile(target.uri, new TextEncoder().encode(newMarkdown));
      reporter.done();
      const updatedDoc = await vscode.workspace.openTextDocument(target.uri);
      await vscode.window.showTextDocument(updatedDoc, { preview: false });
      vscode.window.showInformationMessage(`${target.label} actualizado: ${changes.length} cambio(s) aplicado(s).`);
    } catch (error) {
      vscode.window.showErrorMessage(`No se pudo actualizar el README: ${asErrorMessage(error)}`);
    }
  });
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
async function loadPreviousRanking(storageDir: vscode.Uri): Promise<ReuseRanking | undefined> {
  const memory = await loadRankingMemory(storageDir);
  if (!memory || memory.ranking.length === 0) {
    return undefined;
  }
  const knownPaths = new Set<string>(
    memory.seenPaths.length ? memory.seenPaths : memory.ranking.map((entry) => entry.path)
  );
  return { previousSelection: memory.ranking, knownPaths, previousHashes: new Map(Object.entries(memory.fileHashes)) };
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

async function openLastTrace(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = getActiveWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('Abre un repositorio local en VS Code antes de abrir la traza.');
    return;
  }
  const storageDir = resolveStorageDir(context, workspaceFolder);
  if (!storageDir) {
    vscode.window.showWarningMessage('No hay ninguna traza de CAI Readme-Generator para este proyecto.');
    return;
  }
  await openLastGenerationTrace(storageDir);
}

// Ficheros de datos que la extensión genera para un proyecto (en el almacenamiento
// privado, fuera del repo). El orden define el que se ofrece en el selector.
const GENERATED_DATA_FILES: Array<{ file: string; label: string; detail: string }> = [
  { file: 'ranking.json', label: '$(list-ordered) ranking.json', detail: 'Memoria: ranking del modelo, ficheros vistos y hashes (la usa el actualizador)' },
  { file: 'last-run.md', label: '$(markdown) last-run.md', detail: 'Traza legible de la última ejecución (descartados, ranking, coste…)' },
  { file: 'last-run.json', label: '$(json) last-run.json', detail: 'Traza completa de la última ejecución en JSON' },
  { file: 'last-update-preview.json', label: '$(json) last-update-preview.json', detail: 'Propuestas de la última actualización del README (debug)' }
];

// Comando de acceso a los datos generados. Como viven fuera del repo (en
// context.storageUri), el explorador de VS Code no los muestra: este comando ofrece
// un selector para abrirlos, más la opción de revelar la carpeta en el sistema.
async function openGeneratedData(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolder = getActiveWorkspaceFolder();
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('Abre un repositorio local en VS Code para ver los datos generados.');
    return;
  }
  const storageDir = resolveStorageDir(context, workspaceFolder);
  if (!storageDir) {
    vscode.window.showWarningMessage('No hay almacenamiento disponible para este proyecto.');
    return;
  }

  type DataItem = vscode.QuickPickItem & { uri?: vscode.Uri; reveal?: boolean };
  const items: DataItem[] = [];
  for (const entry of GENERATED_DATA_FILES) {
    const uri = vscode.Uri.joinPath(storageDir, entry.file);
    if (await fileExists(uri)) {
      items.push({ label: entry.label, detail: entry.detail, uri });
    }
  }

  if (items.length === 0) {
    vscode.window.showInformationMessage(
      'CAI Readme-Generator aún no ha generado datos para este proyecto. Genera o actualiza un README primero.'
    );
    return;
  }

  items.push({ label: '$(folder-opened) Abrir carpeta en el explorador del sistema', reveal: true });
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Datos de CAI Readme-Generator para este proyecto (fuera del repositorio)'
  });
  if (!pick) {
    return;
  }
  if (pick.reveal) {
    await vscode.commands.executeCommand('revealFileInOS', storageDir);
    return;
  }
  if (pick.uri) {
    const document = await vscode.workspace.openTextDocument(pick.uri);
    await vscode.window.showTextDocument(document, { preview: false });
  }
}

// Guarda la traza (siempre; ya no está condicionada por ningún ajuste). No lanza:
// si falla, avisa y deja continuar el flujo, porque la traza es de depuración y su
// fallo no debe abortar la generación. No-op si no hay storageDir (sin workspace).
async function saveTrace(storageDir: vscode.Uri | undefined, trace: GenerationTrace): Promise<void> {
  if (!storageDir) {
    return;
  }
  try {
    await saveGenerationTrace(storageDir, trace);
  } catch (error) {
    vscode.window.showWarningMessage(`No se pudo guardar la traza de CAI Readme-Generator: ${asErrorMessage(error)}`);
  }
}
