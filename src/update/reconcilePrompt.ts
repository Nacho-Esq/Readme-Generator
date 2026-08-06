import { PanelKind } from '../template/templateSpec';
import { extractJsonObject, safeJsonParse } from '../utils/json';
import { indent } from '../utils/text';

// Paso 4 del actualizador — reconciliación de sospechosos. Para cada campo donde el
// README y el código difieren de verdad, el modelo propone el valor CORREGIDO del campo
// combinando ambos (mantiene lo bueno del README, corrige lo que el código contradice,
// añade lo que falta). NO mira el código: solo reconcilia las dos fichas ya extraídas.

export interface ReconcileItem {
  path: string;
  label: string;
  instruction: string;
  panelKind: PanelKind;
  readmeText: string;
  codeText: string;
  detail: string;
}

export interface Reconciliation {
  path: string;
  recommendation: 'update' | 'keep';
  proposedValue: string;
  reason: string;
}

export function buildReconcilePrompt(items: ReconcileItem[]): string {
  const blocks = items
    .map(
      (item) =>
        `── Campo: ${item.label} (${item.path}) ── [formato: ${formatHint(item.panelKind)}]\n` +
        `Instrucción de la plantilla: ${item.instruction || '(sin instrucción)'}\n` +
        `README dice:\n${indent(item.readmeText)}\n` +
        `Código dice:\n${indent(item.codeText)}\n` +
        `Diferencia detectada: ${item.detail || '(no especificada)'}`
    )
    .join('\n\n');

  return [
    'Eres un asistente experto en documentación técnica de proyectos de software.',
    'Para cada CAMPO, el README dice una cosa y del código se ha extraído otra, y hay una diferencia real. Tu tarea es proponer el valor CORREGIDO del campo para el README, combinando ambos con criterio.',
    '',
    'Cómo reconciliar:',
    '- Parte del valor del README y corrígelo con lo que dice el código: quita lo que el código contradice o no respalda, y añade los datos concretos que el código aporta y el README no recoge.',
    '- Conserva el estilo y el nivel de detalle del README; no lo reescribas entero ni cambies lo que ya era correcto.',
    '- Respeta el FORMATO del campo (indicado en cada bloque): texto, lista (un elemento por línea) o variables de entorno (una por línea, formato "NOMBRE: descripción").',
    '- Si al mirarlo con calma crees que el README ya estaba bien y la diferencia era irrelevante, responde recommendation "keep" y deja `proposedValue` igual al valor del README.',
    '- En caso contrario, recommendation "update" y `proposedValue` con el valor corregido completo.',
    '- En `reason`, una frase IMPERSONAL de qué se cambia y por qué (p. ej. "Se añade X porque el código lo usa"; "Se quita Y porque el código no lo respalda"). NUNCA en primera persona ("he cambiado", "quito").',
    '',
    'Devuelve solo JSON válido con el schema. Incluye TODOS los campos de la lista, cada uno con su `path` exacto.',
    '',
    'Campos:',
    blocks
  ].join('\n');
}

export function getReconcileSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['reconciliations'],
    properties: {
      reconciliations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'recommendation', 'proposedValue', 'reason'],
          properties: {
            path: { type: 'string', description: 'Ruta exacta del campo, tal cual aparece en la lista.' },
            recommendation: { type: 'string', enum: ['update', 'keep'] },
            proposedValue: { type: 'string', description: 'Valor corregido completo, en el formato del campo. Si keep, igual al valor del README.' },
            reason: { type: 'string' }
          }
        }
      }
    }
  };
}

export function parseReconciliations(text: string): Reconciliation[] {
  const parsed = safeJsonParse(text) ?? safeJsonParse(extractJsonObject(text));
  const reconciliations = (parsed as { reconciliations?: unknown })?.reconciliations;
  if (!Array.isArray(reconciliations)) {
    throw new Error('La respuesta de reconciliación no es un JSON válido con `reconciliations`.');
  }
  return reconciliations
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => typeof item.path === 'string')
    .map((item) => ({
      path: item.path as string,
      recommendation: item.recommendation === 'keep' ? 'keep' : 'update',
      proposedValue: typeof item.proposedValue === 'string' ? (item.proposedValue as string) : '',
      reason: typeof item.reason === 'string' ? (item.reason as string) : ''
    }));
}

function formatHint(panelKind: PanelKind): string {
  if (panelKind === 'list') {
    return 'lista (un elemento por línea)';
  }
  if (panelKind === 'env') {
    return 'variables de entorno (NOMBRE: descripción por línea)';
  }
  return 'texto';
}
