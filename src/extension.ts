import * as path from 'path';
import * as vscode from 'vscode';
import { AzureResponsesClient } from './azure/azureResponsesClient';
import { ensureConfigured, getSettings } from './config';
import { buildExtractionPrompt } from './prompt/promptBuilder';
import {
  analyzeReadmeData,
  completeRenderOptions,
  createDefaultRenderOptions,
  prepareDataForReview
} from './readme/reviewModel';
import { rankFiles } from './scanner/fileRanker';
import { readSelectedFiles, scanRepository } from './scanner/fileScanner';
import { TemplateRenderer } from './template/templateRenderer';
import { EditFormPanel } from './ui/editFormPanel';
import { PreviewPanel } from './ui/previewPanel';
import { asErrorMessage } from './utils/errors';

let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand('readmeGeneratorAi.generateReadme', () =>
    generateReadme(context)
  );
  context.subscriptions.push(command);

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

    const ranked = await rankFiles(candidates);
    const selectedFiles = await readSelectedFiles(
      ranked,
      settings.maxFiles,
      settings.maxBytesPerFile,
      settings.maxTotalBytes
    );
    if (selectedFiles.length === 0) {
      vscode.window.showErrorMessage('No se pudieron leer los archivos seleccionados.');
      return;
    }

    vscode.window.setStatusBarMessage(`README Generator AI: analizando ${selectedFiles.length} archivos...`, 4_000);
    const prompt = buildExtractionPrompt(selectedFiles, workspaceFolder.name);
    const client = new AzureResponsesClient(settings);
    const extraction = await client.extractReadmeData(prompt);

    const renderer = new TemplateRenderer(context.extensionUri);
    const templatePath = await renderer.resolveTemplatePath(settings.templatePath);
    const review = analyzeReadmeData(extraction.data);
    const initialRenderOptions = completeRenderOptions(extraction.data, createDefaultRenderOptions());
    const initialReviewData = prepareDataForReview(extraction.data, initialRenderOptions);
    const initialMarkdown = await renderer.render(templatePath, initialReviewData, initialRenderOptions);

    const previewAction = await PreviewPanel.show(
      initialMarkdown,
      extraction.warnings,
      context.extensionUri,
      review,
      initialRenderOptions,
      async (renderOptions) => {
        const completedOptions = completeRenderOptions(extraction.data, renderOptions);
        const reviewData = prepareDataForReview(extraction.data, completedOptions);
        return renderer.render(templatePath, reviewData, completedOptions);
      }
    );
    if (previewAction.action !== 'edit') {
      return;
    }

    const renderOptions = completeRenderOptions(extraction.data, previewAction.renderOptions);
    const reviewData = prepareDataForReview(extraction.data, renderOptions);
    const editResult = await EditFormPanel.show(reviewData, extraction.warnings, context.extensionUri, renderOptions);
    if (editResult.action !== 'save') {
      return;
    }

    const finalMarkdown = await renderer.render(templatePath, editResult.data, editResult.renderOptions);
    const outputUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, 'README.generated.md'));
    await vscode.workspace.fs.writeFile(outputUri, new TextEncoder().encode(finalMarkdown));

    const document = await vscode.workspace.openTextDocument(outputUri);
    await vscode.window.showTextDocument(document, { preview: false });
    vscode.window.showInformationMessage('README.generated.md generado correctamente.');
  } catch (error) {
    vscode.window.showErrorMessage(`No se pudo generar el README: ${asErrorMessage(error)}`);
  }
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
