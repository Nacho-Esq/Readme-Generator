import { ExtensionSettings, ExtractionResult } from '../types';
import { getExtractionJsonSchema } from '../prompt/promptBuilder';
import { getFileSelectionJsonSchema } from '../prompt/fileSelectionPrompt';
import { FileSelectionResult } from '../scanner/types';

interface ResponsesApiOutputContent {
  type?: string;
  text?: string;
}

interface ResponsesApiOutputItem {
  type?: string;
  content?: ResponsesApiOutputContent[];
}

interface ResponsesApiResponse {
  output_text?: string;
  output?: ResponsesApiOutputItem[];
  error?: {
    message?: string;
  };
}

export class AzureResponsesClient {
  constructor(private readonly settings: ExtensionSettings) {}

  async preSelectImportantFiles(prompt: string, deploymentOverride?: string): Promise<FileSelectionResult> {
    const response = await this.postResponse({
      model: deploymentOverride ?? this.settings.deployment,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: prompt
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'file_selection_result',
          strict: true,
          schema: getFileSelectionJsonSchema()
        }
      }
    });

    return parseFileSelectionResult(extractResponseText(response));
  }

  async extractReadmeData(prompt: string): Promise<ExtractionResult> {
    const response = await this.postResponse({
      model: this.settings.deployment,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: prompt
            }
          ]
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'readme_extraction_result',
          strict: true,
          schema: getExtractionJsonSchema()
        }
      }
    });

    return parseExtractionResult(extractResponseText(response));
  }

  private async postResponse(body: object): Promise<ResponsesApiResponse> {
    const response = await fetch(this.buildResponsesUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.settings.apiKey
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    const payload = text ? safeJsonParse<ResponsesApiResponse>(text) : {};
    if (!response.ok) {
      const message = payload?.error?.message || text || `HTTP ${response.status}`;
      throw new Error(`Azure OpenAI Responses API error: ${message}`);
    }
    return payload || {};
  }

  private buildResponsesUrl(): string {
    const endpoint = this.settings.endpoint.replace(/\/+$/, '');
    if (/\/responses(\?|$)/i.test(endpoint)) {
      return endpoint;
    }

    const base = endpoint.includes('/openai/')
      ? endpoint
      : `${endpoint}/openai/v1`;

    return `${base.replace(/\/+$/, '')}/responses`;
  }
}

function parseFileSelectionResult(text: string): FileSelectionResult {
  const parsed = safeJsonParse<FileSelectionResult>(text) || safeJsonParse<FileSelectionResult>(extractJsonObject(text));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.selectedFiles)) {
    throw new Error('Azure OpenAI response was not valid file selection JSON.');
  }
  return {
    selectedFiles: parsed.selectedFiles
      .filter((item) => item && typeof item.path === 'string')
      .map((item) => ({
        path: item.path,
        reason: typeof item.reason === 'string' ? item.reason : ''
      })),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
  };
}

function extractResponseText(response: ResponsesApiResponse): string {
  if (response.output_text) {
    return response.output_text;
  }

  const chunks: string[] = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') {
        chunks.push(content.text);
      }
    }
  }

  const text = chunks.join('\n').trim();
  if (!text) {
    throw new Error('Azure OpenAI response did not contain output text.');
  }
  return text;
}

function parseExtractionResult(text: string): ExtractionResult {
  const parsed = safeJsonParse<ExtractionResult>(text) || safeJsonParse<ExtractionResult>(extractJsonObject(text));
  if (!parsed || typeof parsed !== 'object' || !parsed.data) {
    throw new Error('Azure OpenAI response was not valid extraction JSON.');
  }
  return {
    data: parsed.data,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
  };
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return text;
  }
  return text.slice(start, end + 1);
}

function safeJsonParse<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
