import { beforeEach, describe, expect, it, vi } from 'vitest';

// templateRenderer.ts importa `vscode` solo para el constructor de TemplateRenderer
// (que aquí no usamos, solo probamos la función pura renderTemplate). Como el módulo
// 'vscode' no existe fuera del editor, lo sustituimos por un doble vacío.
vi.mock('vscode', () => ({}));

import { createDefaultRenderOptions, RenderOptions } from '../readme/reviewModel';
import { renderTemplate } from './templateRenderer';
import { initTemplateSpec } from './templateSpec';

function render(template: string, data: Record<string, unknown>, options?: RenderOptions): string {
  initTemplateSpec(template);
  return renderTemplate(template, data, options ?? createDefaultRenderOptions());
}

// initTemplateSpec exige al menos un token válido; para probar el "aseo" final del
// render (líneas en blanco, recorte) sobre texto sin tokens, inicializamos aparte
// con una plantilla mínima y llamamos a renderTemplate directamente.
function renderRawText(template: string): string {
  initTemplateSpec('[[ dummy | M | text | i ]]\n');
  return renderTemplate(template, {}, createDefaultRenderOptions());
}

describe('renderTemplate: tipos de campo', () => {
  it('renderiza un campo de texto simple', () => {
    const out = render('Nombre: [[ project_name | M | text | i ]]\n', { project_name: 'Mi Proyecto' });
    expect(out).toBe('Nombre: Mi Proyecto\n');
  });

  it('renderiza una lista como viñetas', () => {
    const out = render('[[ scope.includes | M | list | i ]]\n', { scope: { includes: ['uno', 'dos'] } });
    expect(out).toBe('- uno\n- dos\n');
  });

  it('renderiza un campo env como lista de nombre/descripción', () => {
    const out = render('[[ vars | M | env | i ]]\n', {
      vars: [{ name: 'API_KEY', description: 'clave de acceso' }]
    });
    expect(out).toBe('- **API_KEY**: clave de acceso\n');
  });

  it('renderiza un campo code entre backticks', () => {
    const out = render('[[ cmds | M | code | i ]]\n', { cmds: ['npm install', 'npm test'] });
    expect(out).toBe('- `npm install`\n- `npm test`\n');
  });

  it('renderiza un campo raw tal cual, línea a línea', () => {
    const out = render('[[ diagram | M | raw | i ]]\n', { diagram: '```mermaid\nA --> B\n```' });
    expect(out).toBe('```mermaid\nA --> B\n```\n');
  });

  it('renderiza una imagen como sintaxis Markdown de imagen, usando project_name como alt', () => {
    const out = render('[[ screenshot_path | M | image | i ]]\n', {
      project_name: 'MiApp',
      screenshot_path: 'img/shot.png'
    });
    expect(out).toBe('![MiApp](img/shot.png)\n');
  });

  it('si la imagen no tiene valor, se elimina la línea entera', () => {
    const out = render('antes\n[[ screenshot_path | M | image | i ]]\ndespués\n', { screenshot_path: '' });
    expect(out).toBe('antes\ndespués\n');
  });

  it('varios tokens en la misma línea se sustituyen en sitio', () => {
    const out = render('[[ a | M | text | i ]] y [[ b | M | text | i ]]\n', { a: 'uno', b: 'dos' });
    expect(out).toBe('uno y dos\n');
  });
});

describe('renderTemplate: huecos pendientes de rellenar', () => {
  it('un campo con el valor centinela de relleno muestra el aviso con la instrucción del campo', () => {
    const out = render('[[ x | M | text | Instrucción de ejemplo ]]\n', { x: 'RELLENAR POR USUARIO' });
    expect(out).toContain('⚠️');
    expect(out).toContain('RELLENAR POR USUARIO');
    expect(out).toContain('Instrucción de ejemplo');
  });

  it('un campo de lista con el centinela en todos sus elementos también muestra el aviso', () => {
    const out = render('[[ x | M | list | Instrucción ]]\n', { x: ['RELLENAR POR USUARIO'] });
    expect(out).toContain('⚠️');
    expect(out).toContain('Instrucción');
  });
});

describe('renderTemplate: omisión de campos y secciones', () => {
  it('omitFields elimina la línea completa del campo', () => {
    const out = render('[[ x | M | text | i ]]\n', { x: 'valor' }, {
      omitFields: { x: true },
      omitSections: {}
    });
    // renderTemplate siempre añade un salto de línea final, aunque el cuerpo quede vacío.
    expect(out).toBe('\n');
    expect(out).not.toContain('valor');
  });

  it('omitSections elimina la sección entera (encabezado con token S hasta el siguiente)', () => {
    const template = [
      '## 1. Uno [[ uno | S | ctx ]]',
      '[[ a.x | M | text | i ]]',
      '## 2. Extra [[ extra | S | ctx ]]',
      '[[ extra.x | M | text | i ]]',
      '## 3. Tres [[ tres | S | ctx ]]',
      '[[ c.x | M | text | i ]]'
    ].join('\n');
    const out = render(template, { a: { x: 'aa' }, extra: { x: 'valor' }, c: { x: 'cc' } }, {
      omitFields: {},
      omitSections: { extra: true }
    });
    expect(out).not.toContain('Extra');
    expect(out).not.toContain('valor');
    expect(out).toContain('Uno');
    expect(out).toContain('Tres');
  });

  it('el contexto del token de sección (rol S) no aparece en el README renderizado', () => {
    const template = [
      '## 3. Experiencia de usuario [[ experiencia | S | Este texto es solo para el modelo y no debe filtrarse al README. ]]',
      '### Canales [[ usage.channels | M | csv | i ]]'
    ].join('\n');
    const out = render(template, { usage: { channels: 'web, CLI' } });
    expect(out).toContain('web, CLI');
    expect(out).not.toContain('solo para el modelo');
  });

  it('el encabezado de sección se renderiza sin su token de sección', () => {
    const template = ['## 4. Arquitectura [[ arquitectura | S | contexto ]]', '[[ arch.x | M | text | i ]]'].join('\n');
    const out = render(template, { arch: { x: 'v' } });
    expect(out).toContain('## 1. Arquitectura');
    expect(out).not.toContain('[[');
    expect(out).not.toContain('arquitectura | S');
  });

  it('un campo con etiqueta en su encabezado (### Label) se renderiza como subsección con el valor debajo', () => {
    const template = '### Diagrama lógico [[ architecture.logical_flow | M | text | i ]]\n';
    const out = render(template, { architecture: { logical_flow: 'contenido del diagrama' } });
    expect(out).toBe('### Diagrama lógico\n\ncontenido del diagrama\n');
  });

  it('tras omitir una sección, los encabezados numerados se renumeran de forma consecutiva', () => {
    const template = [
      '## 1. Extra [[ extra | S | ctx ]]',
      '[[ extra.x | M | text | i ]]',
      '## 2. Segunda [[ segunda | S | ctx ]]',
      '[[ y | M | text | i ]]'
    ].join('\n');
    const out = render(template, { extra: { x: 'v' }, y: 'w' }, {
      omitFields: {},
      omitSections: { extra: true }
    });
    expect(out).toContain('## 1. Segunda');
    expect(out).not.toContain('## 2.');
  });
});

describe('renderTemplate: limpieza del resultado', () => {
  it('colapsa 3 o más líneas en blanco seguidas a solo una', () => {
    const out = renderRawText('a\n\n\n\nb\n');
    expect(out).toBe('a\n\nb\n');
  });

  it('quita líneas en blanco iniciales y añade un único salto de línea final', () => {
    const out = renderRawText('\n\n\ncontenido\n\n\n');
    expect(out).toBe('contenido\n');
  });
});
