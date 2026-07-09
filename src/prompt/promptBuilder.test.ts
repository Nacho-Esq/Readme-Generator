import { beforeEach, describe, expect, it } from 'vitest';
import { RepositoryMap, SelectedFile } from '../scanner/types';
import { initTemplateSpec } from '../template/templateSpec';
import { buildExtractionPrompt, getExtractionJsonSchema } from './promptBuilder';

const SAMPLE_TEMPLATE = [
  '## 1. Resumen',
  '- **Nombre**: [[ project_name | M | text | Nombre del proyecto ]]',
  '- **Estado**: [[ summary.status | H | text | Estado ]]'
].join('\n');

function emptyRepositoryMap(overrides: Partial<RepositoryMap> = {}): RepositoryMap {
  return {
    workspaceName: 'mi-repo',
    technologies: [],
    entrypoints: [],
    modules: [],
    documentation: [],
    structure: [],
    discardedSummary: [],
    stats: { candidateFiles: 0, sourceFiles: 0, documentationFiles: 0, totalBytes: 0 },
    ...overrides
  };
}

function file(relativePath: string, content: string, truncated = false): SelectedFile {
  return { uri: {} as never, relativePath, size: content.length, content, truncated };
}

beforeEach(() => {
  initTemplateSpec(SAMPLE_TEMPLATE);
});

describe('buildExtractionPrompt', () => {
  it('incluye el nombre del workspace y las instrucciones por campo (solo campos M)', () => {
    const prompt = buildExtractionPrompt([], 'mi-repo', emptyRepositoryMap(), {
      nanoReasonsByPath: new Map(),
      unreadFiles: []
    });
    expect(prompt).toContain('Nombre del workspace: mi-repo');
    expect(prompt).toContain('project_name: Nombre del proyecto');
    expect(prompt).not.toContain('summary.status: Estado');
  });

  it('incluye el contenido y la ruta de cada archivo seleccionado', () => {
    const prompt = buildExtractionPrompt(
      [file('src/index.ts', 'console.log(1)')],
      'mi-repo',
      emptyRepositoryMap(),
      { nanoReasonsByPath: new Map(), unreadFiles: [] }
    );
    expect(prompt).toContain('### FILE: src/index.ts');
    expect(prompt).toContain('console.log(1)');
  });

  it('marca los archivos truncados', () => {
    const prompt = buildExtractionPrompt(
      [file('big.ts', 'contenido', true)],
      'mi-repo',
      emptyRepositoryMap(),
      { nanoReasonsByPath: new Map(), unreadFiles: [] }
    );
    expect(prompt).toContain('[TRUNCATED]');
  });

  it('incluye la razón del nano cuando existe para un archivo', () => {
    const prompt = buildExtractionPrompt(
      [file('src/index.ts', 'x')],
      'mi-repo',
      emptyRepositoryMap(),
      { nanoReasonsByPath: new Map([['src/index.ts', 'es el entrypoint']]), unreadFiles: [] }
    );
    expect(prompt).toContain('Relevancia segun selector: es el entrypoint');
  });

  it('no incluye el bloque de "archivos no leídos" si no hay ninguno', () => {
    const prompt = buildExtractionPrompt([], 'mi-repo', emptyRepositoryMap(), {
      nanoReasonsByPath: new Map(),
      unreadFiles: []
    });
    expect(prompt).not.toContain('Archivos no leidos por presupuesto de tokens');
  });

  it('incluye el bloque de "archivos no leídos" con la estimación de tokens cuando hay overflow', () => {
    const prompt = buildExtractionPrompt([], 'mi-repo', emptyRepositoryMap(), {
      nanoReasonsByPath: new Map(),
      unreadFiles: [{ path: 'grande.ts', nanoReason: 'importante', estimatedTokens: 5000 }]
    });
    expect(prompt).toContain('Archivos no leidos por presupuesto de tokens');
    expect(prompt).toContain('grande.ts (~5000 tokens estimados) — importante');
  });

  it('formatea el mapa del repositorio: tecnologías, entrypoints, módulos, documentación y descartes', () => {
    const prompt = buildExtractionPrompt([], 'mi-repo', emptyRepositoryMap({
      technologies: [{ name: 'TypeScript', evidence: ['tsconfig.json'] }],
      entrypoints: ['src/index.ts'],
      modules: [{ name: 'src', path: 'src', fileCount: 3, kind: 'source' }],
      documentation: ['README.md'],
      discardedSummary: [{ reason: 'lockfile', count: 2, examples: ['package-lock.json'], stage: 'local' }],
      stats: { candidateFiles: 10, sourceFiles: 5, documentationFiles: 1, totalBytes: 1000 }
    }), { nanoReasonsByPath: new Map(), unreadFiles: [] });

    expect(prompt).toContain('TypeScript (tsconfig.json)');
    expect(prompt).toContain('src/index.ts');
    expect(prompt).toContain('src [source, 3 archivos]');
    expect(prompt).toContain('README.md');
    expect(prompt).toContain('lockfile (local): 2 archivos; ejemplos: package-lock.json');
  });

  it('cuando no hay tecnologías/entrypoints/módulos/documentación detectados, indica "No detectado(s)/a"', () => {
    const prompt = buildExtractionPrompt([], 'mi-repo', emptyRepositoryMap(), {
      nanoReasonsByPath: new Map(),
      unreadFiles: []
    });
    expect(prompt).toContain('No detectadas');
    expect(prompt).toContain('No detectados');
    expect(prompt).toContain('No detectada');
  });
});

describe('getExtractionJsonSchema', () => {
  it('requiere "data" y "warnings", y data sigue el schema derivado de la plantilla', () => {
    const schema = getExtractionJsonSchema() as any;
    expect(schema.required).toEqual(['data', 'warnings']);
    expect(schema.properties.data.properties).toHaveProperty('project_name');
    expect(schema.properties.data.properties).not.toHaveProperty('summary');
  });
});
