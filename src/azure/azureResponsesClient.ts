import { ExtensionSettings, ExtractionResult, TokenUsage } from '../types';
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
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface ApiCallResult<T> {
  data: T;
  tokenUsage: TokenUsage;
}

export class AzureResponsesClient {
  constructor(private readonly settings: ExtensionSettings) {}

  async preSelectImportantFiles(prompt: string, deploymentOverride?: string): Promise<ApiCallResult<FileSelectionResult>> {
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

    return {
      data: parseFileSelectionResult(extractResponseText(response)),
      tokenUsage: extractTokenUsage(response)
    };
  }

  async extractReadmeData(prompt: string, deploymentOverride?: string): Promise<ApiCallResult<ExtractionResult>> {
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
          name: 'readme_extraction_result',
          strict: true,
          schema: getExtractionJsonSchema()
        }
      }
    });

    return {
      data: parseExtractionResult(extractResponseText(response)),
      tokenUsage: extractTokenUsage(response)
    };
  }

  // Llamada genérica con json_schema estricto que devuelve el texto crudo de salida.
  // La reutilizan pasos que definen su propio schema (p. ej. la inserción de ranking
  // del actualizador) sin duplicar la fontanería de postResponse.
  async callWithSchema(
    prompt: string,
    schemaName: string,
    schema: object,
    deploymentOverride?: string
  ): Promise<ApiCallResult<string>> {
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
          name: schemaName,
          strict: true,
          schema
        }
      }
    });

    return {
      data: extractResponseText(response),
      tokenUsage: extractTokenUsage(response)
    };
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

function extractTokenUsage(response: ResponsesApiResponse): TokenUsage {
  return {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0
  };
}

function parseFileSelectionResult(text: string): FileSelectionResult {
  const parsed = safeJsonParse<FileSelectionResult>(text) || safeJsonParse<FileSelectionResult>(extractJsonObject(text));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.selectedFiles)) {
    throw new Error('Azure OpenAI response was not valid file selection JSON.');
  }
  const parseItems = (arr: unknown): FileSelectionResult['selectedFiles'] =>
    Array.isArray(arr)
      ? arr
          .filter((item): item is { path: string; reason?: string } => item && typeof item.path === 'string')
          .map((item) => ({ path: item.path, reason: typeof item.reason === 'string' ? item.reason : '' }))
      : [];
  return {
    selectedFiles: parseItems(parsed.selectedFiles),
    discardedFiles: parseItems(parsed.discardedFiles),
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
