import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTemplateSpec } from '../template/templateSpec';
import { ExtensionSettings } from '../types';
import { AzureResponsesClient } from './azureResponsesClient';

// extractReadmeData/preSelectImportantFiles construyen su JSON schema a partir de
// la plantilla README (vía promptBuilder/templateSpec), así que necesitan una
// plantilla inicializada aunque el test no verifique el schema en sí.
beforeEach(() => {
  initTemplateSpec('[[ project_name | M | text | Nombre del proyecto ]]\n');
});

function settings(overrides: Partial<ExtensionSettings> = {}): ExtensionSettings {
  return {
    apiKey: 'test-key',
    endpoint: 'https://mi-recurso.openai.azure.com',
    deployment: 'gpt-grande',
    preSelectionDeployment: '',
    templatePath: '',
    readDepth: 'básico',
    ...overrides
  };
}

function fakeFetch(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    text: async () => JSON.stringify(body)
  })) as unknown as typeof fetch;
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('AzureResponsesClient: construcción de la URL', () => {
  it('añade /openai/v1/responses cuando el endpoint es solo el recurso base', async () => {
    const captured: string[] = [];
    global.fetch = vi.fn(async (url: string) => {
      captured.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify({ output_text: '{"data":{},"warnings":[]}' }) } as never;
    }) as unknown as typeof fetch;

    const client = new AzureResponsesClient(settings({ endpoint: 'https://mi-recurso.openai.azure.com' }));
    await client.extractReadmeData('prompt');
    expect(captured[0]).toBe('https://mi-recurso.openai.azure.com/openai/v1/responses');
  });

  it('no duplica /responses si el endpoint ya apunta directamente a la API de responses', async () => {
    const captured: string[] = [];
    global.fetch = vi.fn(async (url: string) => {
      captured.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify({ output_text: '{"data":{},"warnings":[]}' }) } as never;
    }) as unknown as typeof fetch;

    const client = new AzureResponsesClient(settings({ endpoint: 'https://mi-recurso.openai.azure.com/openai/v1/responses' }));
    await client.extractReadmeData('prompt');
    expect(captured[0]).toBe('https://mi-recurso.openai.azure.com/openai/v1/responses');
  });

  it('quita barras finales sobrantes del endpoint configurado', async () => {
    const captured: string[] = [];
    global.fetch = vi.fn(async (url: string) => {
      captured.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify({ output_text: '{"data":{},"warnings":[]}' }) } as never;
    }) as unknown as typeof fetch;

    const client = new AzureResponsesClient(settings({ endpoint: 'https://mi-recurso.openai.azure.com/' }));
    await client.extractReadmeData('prompt');
    expect(captured[0]).toBe('https://mi-recurso.openai.azure.com/openai/v1/responses');
  });
});

describe('AzureResponsesClient.extractReadmeData', () => {
  it('extrae data y warnings desde output_text', async () => {
    global.fetch = fakeFetch({
      output_text: JSON.stringify({ data: { project_name: 'X' }, warnings: ['ojo con esto'] }),
      usage: { input_tokens: 100, output_tokens: 20 }
    });
    const client = new AzureResponsesClient(settings());
    const result = await client.extractReadmeData('prompt');
    expect(result.data.data).toEqual({ project_name: 'X' });
    expect(result.data.warnings).toEqual(['ojo con esto']);
    expect(result.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it('extrae el texto desde output[].content[] cuando no hay output_text', async () => {
    global.fetch = fakeFetch({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ data: {}, warnings: [] }) }] }]
    });
    const client = new AzureResponsesClient(settings());
    const result = await client.extractReadmeData('prompt');
    expect(result.data.warnings).toEqual([]);
  });

  it('si el texto de salida no es JSON directo, intenta extraer el objeto {...} embebido', async () => {
    global.fetch = fakeFetch({
      output_text: `Aquí tienes el resultado:\n${JSON.stringify({ data: { a: '1' }, warnings: [] })}\nFin.`
    });
    const client = new AzureResponsesClient(settings());
    const result = await client.extractReadmeData('prompt');
    expect(result.data.data).toEqual({ a: '1' });
  });

  it('lanza un error si la respuesta no contiene "data"', async () => {
    global.fetch = fakeFetch({ output_text: JSON.stringify({ warnings: [] }) });
    const client = new AzureResponsesClient(settings());
    await expect(client.extractReadmeData('prompt')).rejects.toThrow(/not valid extraction JSON/);
  });

  it('lanza un error si Azure devuelve una respuesta HTTP no-ok, incluyendo el mensaje de error', async () => {
    global.fetch = fakeFetch({ error: { message: 'Incorrect API key provided' } }, false, 401);
    const client = new AzureResponsesClient(settings());
    await expect(client.extractReadmeData('prompt')).rejects.toThrow(/Incorrect API key provided/);
  });

  it('lanza un error si no hay ningún texto de salida en la respuesta', async () => {
    global.fetch = fakeFetch({ output: [] });
    const client = new AzureResponsesClient(settings());
    await expect(client.extractReadmeData('prompt')).rejects.toThrow(/did not contain output text/);
  });
});

describe('AzureResponsesClient.preSelectImportantFiles', () => {
  it('parsea selectedFiles/discardedFiles/warnings y usa el deployment override si se indica', async () => {
    const bodies: string[] = [];
    global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(init.body as string);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            output_text: JSON.stringify({
              selectedFiles: [{ path: 'src/index.ts', reason: 'entrypoint' }],
              discardedFiles: [{ path: 'test/x.spec.ts', reason: 'test' }],
              warnings: []
            })
          })
      } as never;
    }) as unknown as typeof fetch;

    const client = new AzureResponsesClient(settings({ deployment: 'gpt-grande' }));
    const result = await client.preSelectImportantFiles('prompt', 'nano-override');

    expect(result.data.selectedFiles).toEqual([{ path: 'src/index.ts', reason: 'entrypoint' }]);
    expect(result.data.discardedFiles).toEqual([{ path: 'test/x.spec.ts', reason: 'test' }]);
    expect(JSON.parse(bodies[0]).model).toBe('nano-override');
  });

  it('descarta silenciosamente items sin "path" de tipo string en vez de romper', async () => {
    global.fetch = fakeFetch({
      output_text: JSON.stringify({
        selectedFiles: [{ path: 'ok.ts', reason: 'x' }, { reason: 'sin path' }, { path: 123, reason: 'path no string' }],
        discardedFiles: [],
        warnings: []
      })
    });
    const client = new AzureResponsesClient(settings());
    const result = await client.preSelectImportantFiles('prompt');
    expect(result.data.selectedFiles).toEqual([{ path: 'ok.ts', reason: 'x' }]);
  });

  it('lanza un error si selectedFiles no es un array', async () => {
    global.fetch = fakeFetch({ output_text: JSON.stringify({ discardedFiles: [], warnings: [] }) });
    const client = new AzureResponsesClient(settings());
    await expect(client.preSelectImportantFiles('prompt')).rejects.toThrow(/not valid file selection JSON/);
  });
});
