import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { AzureResponsesClient } from './azure/azureResponsesClient';
import { ensureConfigured, getPreSelectionDeployment, getReadDepthTokenBudget, getSettings } from './config';
import { buildContentSelectionPrompt } from './prompt/fileSelectionPrompt';
import { buildExtractionPrompt } from './prompt/promptBuilder';
import { buildUpdateJudgePrompt } from './prompt/updateJudgePrompt';
import { buildReconcilePrompt, ReconcileChange } from './prompt/reconcilePrompt';
import {
  analyzeReadmeData,
  completeRenderOptions,
  createDefaultRenderOptions,
  prepareDataForReview
} from './readme/reviewModel';
import { buildPlanFromJudge, isEmpty, UpdatePlan } from './readme/updatePlanner';
import { buildFileInventory, estimateTokensFromSize, PRE_SELECTION_MAX_BYTES_PER_FILE, readAllCandidateFiles, readRawContent, scanRepository, splitByTokenBudget } from './scanner/fileScanner';
import { analyzeRepository } from './scanner/repositoryAnalyzer';
import { CandidateFile, DiscardedFileSummary, FileSelectionItem, FileSelectionResult, SelectedFile } from './scanner/types';
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
import { ResolvedChange, UpdateReviewPanel } from './ui/updateReviewPanel';
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

interface RepositoryExtraction {
  data: ReadmeData;
  warnings: string[];
  renderer: TemplateRenderer;
  templatePath: string;
}

// Ranking del nano de una generación anterior, recuperado de la traza. En el modo
// actualizar se reutiliza: un fichero importante antes lo sigue siendo, así que no
// se re-rankea todo, solo los ficheros NUEVOS (los que no están en knownPaths).
interface ReuseRanking {
  previousSelection: FileSelectionItem[];
  knownPaths: Set<string>;
}

// Escanea el repo, aplica la capa de seguridad, resuelve el ranking (nano completo
// o reutilizado), lee los archivos clave y extrae los datos estructurados. Lo
// comparten generar (README nuevo) y actualizar (produce newData). La capa de
// seguridad vive aquí, en un único sitio, para que ambos flujos protejan los datos
// sensibles de forma idéntica. Con `options.reuseRanking` se salta el nano salvo
// para los ficheros nuevos.
async function runRepositoryExtraction(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  settings: ReturnType<typeof getSettings>,
  options?: { reuseRanking?: ReuseRanking }
): Promise<RepositoryExtraction | undefined> {
  vscode.window.setStatusBarMessage('README Generator AI: escaneando repositorio...', 4_000);
  const candidates = await scanRepository(workspaceFolder);
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

  vscode.window.setStatusBarMessage(
    `README Generator AI: leyendo repositorio completo (${sendableInventory.length} archivos)...`,
    6_000
  );
  const preSelectionDeployment = getPreSelectionDeployment(settings);
  const allCandidateFiles = await readAllCandidateFiles(sendableInventory, PRE_SELECTION_MAX_BYTES_PER_FILE, { overrides: contentOverrides, exclude: excludedPaths });
  trace.preSelectionDeployment = preSelectionDeployment;
  trace.mainModelDeployment = settings.deployment;
  trace.preSelectionFilesSentCount = allCandidateFiles.length;

  // --- Resolución del ranking: nano completo o reutilizado (solo ficheros nuevos) ---
  let rankedFiles: CandidateFile[];
  let nanoReasonsByPath: Map<string, string>;
  let nanoWarnings: string[];

  const reuse = options?.reuseRanking;
  if (reuse) {
    const previous = validateFileSelection(
      { selectedFiles: reuse.previousSelection, discardedFiles: [], warnings: [] },
      sendableInventory
    );
    const reasons = new Map<string, string>(reuse.previousSelection.map((item) => [item.path, item.reason]));
    let ranking = previous.ranking;
    let warnings = previous.warnings;

    const newCandidates = allCandidateFiles.filter((f) => !reuse.knownPaths.has(f.relativePath));
    if (newCandidates.length > 0) {
      const newPrompt = buildContentSelectionPrompt(repositoryMap, newCandidates);
      trace.selectionPrompt = newPrompt;
      vscode.window.setStatusBarMessage(`README Generator AI: rankeando ${newCandidates.length} archivo(s) nuevo(s)...`, 4_000);
      try {
        const nanoResult = await client.preSelectImportantFiles(newPrompt, preSelectionDeployment);
        const newValidated = validateFileSelection(nanoResult.data, sendableInventory);
        const existing = new Set(ranking.map((f) => f.relativePath));
        const newlySelected = newValidated.ranking.filter((f) => !existing.has(f.relativePath));
        ranking = [...ranking, ...newlySelected];
        for (const item of nanoResult.data.selectedFiles) {
          reasons.set(item.path, item.reason);
        }
        warnings = warnings.concat(nanoResult.data.warnings, newValidated.warnings);
        trace.nanoTokenUsage = nanoResult.tokenUsage;
        trace.llmDiscardedFiles = nanoResult.data.discardedFiles;
      } catch (error) {
        // Si el nano falla con los ficheros nuevos, seguimos con el ranking previo.
        warnings = warnings.concat(`No se pudieron rankear los archivos nuevos: ${asErrorMessage(error)}`);
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
    vscode.window.setStatusBarMessage(`README Generator AI: seleccionando archivos clave con modelo ligero...`, 4_000);
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
    nanoWarnings = nanoResult.data.warnings.concat(validated.warnings);
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

  const renderer = new TemplateRenderer(context.extensionUri);
  const templatePath = await renderer.resolveTemplatePath(settings.templatePath);
  initTemplateSpec(await fs.readFile(templatePath, 'utf8'));

  vscode.window.setStatusBarMessage(`README Generator AI: analizando ${selectedFiles.length} archivos...`, 4_000);
  const prompt = buildExtractionPrompt(selectedFiles, workspaceFolder.name, repositoryMap, {
    nanoReasonsByPath,
    unreadFiles
  });
  const extractionResult = await client.extractReadmeData(prompt);
  trace.mainModelTokenUsage = extractionResult.tokenUsage;
  const extraction = extractionResult.data;
  const finalWarnings = nanoWarnings.concat(extraction.warnings);

  trace.warnings = finalWarnings;
  await saveTraceIfEnabled(workspaceFolder, settings.debugTrace, trace);

  return { data: extraction.data, warnings: finalWarnings, renderer, templatePath };
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

    const analysis = await runRepositoryExtraction(context, workspaceFolder, settings);
    if (!analysis) {
      return;
    }
    const { data: finalReadmeData, warnings: finalWarnings, renderer, templatePath } = analysis;

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

// Modo actualizar: refresca la información de un README existente sin cambiar su
// estructura. Reutiliza el ranking del nano de la generación anterior (solo rankea
// ficheros nuevos), el modelo grande relee el proyecto y extrae newData, un segundo
// paso (juez) decide campo a campo qué información es realmente nueva frente a lo que
// el README ya dice, y solo eso llega al panel de revisión.
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

    const readmeText = await readFileText(target.uri);

    // Memoria de la generación previa: se reutiliza el ranking del nano. Si no hay
    // traza (README heredado o debugTrace apagado), se hace una pasada completa.
    const previous = await loadPreviousRanking(workspaceFolder);
    if (!previous) {
      vscode.window.showInformationMessage(
        'No hay memoria de una generación previa; se hará una pasada completa de análisis del repositorio.'
      );
    }

    // 1) Datos frescos del repo (seguridad completa + extracción). Reutiliza el
    //    ranking del nano; solo rankea ficheros nuevos.
    const analysis = await runRepositoryExtraction(
      context,
      workspaceFolder,
      settings,
      previous ? { reuseRanking: previous } : undefined
    );
    if (!analysis) {
      return;
    }
    const newData = analysis.data;

    // 2) Juez: compara el repo con el README actual, campo a campo (solo M/A), y
    //    devuelve únicamente los campos con información materialmente nueva.
    vscode.window.setStatusBarMessage('README Generator AI: comparando el repositorio con el README actual...', 8_000);
    const client = new AzureResponsesClient(settings);
    const judge = await client.judgeUpdate(buildUpdateJudgePrompt(readmeText, newData));
    const plan = buildPlanFromJudge(judge.data.changes, newData);
    if (plan.changes.length === 0) {
      vscode.window.showInformationMessage(
        `${target.label} ya está al día: no se detectó información nueva que actualizar.`
      );
      return;
    }

    // 3) Panel de revisión (todo aceptado por defecto) + previsualización bajo demanda.
    const result = await UpdateReviewPanel.show(
      plan,
      context.extensionUri,
      target.label,
      async (resolved) => reconcile(client, readmeText, plan, resolved)
    );
    if (result.action !== 'save') {
      return;
    }

    // 4) Reconciliación final con los cambios aprobados + guardado.
    const changes = toReconcileChanges(plan, result.resolved);
    let finalMarkdown = readmeText;
    if (changes.length > 0) {
      vscode.window.setStatusBarMessage('README Generator AI: aplicando cambios al README...', 6_000);
      finalMarkdown = await reconcile(client, readmeText, plan, result.resolved);
    }

    await vscode.workspace.fs.writeFile(target.uri, new TextEncoder().encode(finalMarkdown));
    const document = await vscode.workspace.openTextDocument(target.uri);
    await vscode.window.showTextDocument(document, { preview: false });
    vscode.window.showInformationMessage(`${target.label} actualizado correctamente.`);
  } catch (error) {
    vscode.window.showErrorMessage(`No se pudo actualizar el README: ${asErrorMessage(error)}`);
  }
}

async function reconcile(
  client: AzureResponsesClient,
  readmeText: string,
  plan: UpdatePlan,
  resolved: ResolvedChange[]
): Promise<string> {
  const changes = toReconcileChanges(plan, resolved);
  if (changes.length === 0) {
    return readmeText;
  }
  const response = await client.reconcileReadme(buildReconcilePrompt(readmeText, changes));
  return cleanReconciled(response.data);
}

// Traduce las decisiones del panel a la lista de cambios que recibe la
// reconciliación. 'keep' se descarta (el README se deja como está); 'accept' toma
// el valor propuesto; 'edit' toma el valor editado a mano. Se filtran valores
// vacíos para no pedir aplicar un cambio sin contenido.
function toReconcileChanges(plan: UpdatePlan, resolved: ResolvedChange[]): ReconcileChange[] {
  const byPath = new Map(plan.changes.map((change) => [change.path, change]));
  const out: ReconcileChange[] = [];
  for (const decision of resolved) {
    if (decision.decision === 'keep') {
      continue;
    }
    const change = byPath.get(decision.path);
    if (!change) {
      continue;
    }
    const value = decision.decision === 'edit' ? decision.value : change.newValue;
    if (isEmpty(value, change.panelKind)) {
      continue;
    }
    out.push({ section: change.section, label: change.label, panelKind: change.panelKind, value });
  }
  return out;
}

// El modelo debería devolver Markdown sin envolver, pero a veces lo encierra en una
// valla ```markdown. La quitamos y normalizamos el salto de línea final.
function cleanReconciled(text: string): string {
  let result = text.trim();
  const fenced = result.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  if (fenced) {
    result = fenced[1];
  }
  return result.trimEnd() + '\n';
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

// Recupera el ranking del nano de la traza de la última generación/actualización.
// knownPaths = todos los ficheros que el nano vio (seleccionados + descartados),
// para distinguir los ficheros nuevos. undefined si no hay traza utilizable.
async function loadPreviousRanking(workspaceFolder: vscode.WorkspaceFolder): Promise<ReuseRanking | undefined> {
  const jsonUri = vscode.Uri.joinPath(workspaceFolder.uri, '.readme-generator-ai', 'last-run.json');
  try {
    const bytes = await vscode.workspace.fs.readFile(jsonUri);
    const trace = JSON.parse(new TextDecoder().decode(bytes)) as Partial<GenerationTrace>;
    const selection = Array.isArray(trace.llmSelection) ? trace.llmSelection : [];
    if (selection.length === 0) {
      return undefined;
    }
    const discarded = Array.isArray(trace.llmDiscardedFiles) ? trace.llmDiscardedFiles : [];
    const knownPaths = new Set<string>([...selection, ...discarded].map((item) => item.path));
    return { previousSelection: selection, knownPaths };
  } catch {
    return undefined;
  }
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
