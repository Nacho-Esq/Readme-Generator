import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import nunjucks from 'nunjucks';
import { ReadmeData } from '../types';
import { createDefaultRenderOptions, FILL_PLACEHOLDER, RenderOptions } from '../readme/reviewModel';

export class TemplateRenderer {
  constructor(private readonly extensionUri: vscode.Uri) {}

  async resolveTemplatePath(configuredPath: string): Promise<string> {
    if (configuredPath) {
      return configuredPath;
    }
    return path.join(this.extensionUri.fsPath, 'templates', 'readme_plantilla.md.jinja');
  }

  async render(templatePath: string, data: ReadmeData, renderOptions: RenderOptions = createDefaultRenderOptions()): Promise<string> {
    const template = await fs.readFile(templatePath, 'utf8');
    const env = new nunjucks.Environment(undefined, {
      autoescape: false,
      throwOnUndefined: false,
      trimBlocks: false,
      lstripBlocks: false
    });

    const context = { ...data, renderOptions };
    return emphasizePlaceholders(env.renderString(template, context)).trimEnd() + '\n';
  }
}

function emphasizePlaceholders(markdown: string): string {
  return markdown.replaceAll(FILL_PLACEHOLDER, `**${FILL_PLACEHOLDER}**`);
}
