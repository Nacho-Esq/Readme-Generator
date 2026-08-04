// ─────────────────────────────────────────────────────────────────────────────
// Actualizador de README — REDISEÑO v4 (en construcción, fase a fase)
// ─────────────────────────────────────────────────────────────────────────────
//
// OBJETIVOS (recordatorio permanente):
//  1. EDITAR el README existente, nunca regenerarlo. Solo se parchean los campos
//     que el humano apruebe; el resto del documento queda idéntico (garantizado
//     por un diff mecánico en el paso 6).
//  2. Comparar FICHAS (valor estructurado por campo de la plantilla) del README
//     contra las del código — NO prosa contra código, NO regenerar el README.
//  3. Dos direcciones: (A) el README afirma algo que el código no respalda;
//     (B) el código dice algo distinto/nuevo respecto al README.
//  4. Barato y fiable: 1 llamada cara (extracción del código) + varias nano;
//     evidencia obligatoria antes de molestar al humano.
//  5. El GENERADOR no se toca. Esta carpeta (src/update/) aísla el actualizador.
//
// Estos son STUBS: definen la estructura y los tipos para revisión. Cada paso se
// implementa en su fase. La orquestación (ranking, contexto del repo, panel,
// guardado) vive en extension.ts::updateReadme; aquí viven los PASOS puros.

import { AzureResponsesClient } from '../azure/azureResponsesClient';
import { buildExtractionPrompt, NanoContext } from '../prompt/promptBuilder';
import { RepositoryMap, SelectedFile } from '../scanner/types';
import { getAllFields, getFieldInstruction, PanelKind } from '../template/templateSpec';
import { ReadmeData, TokenUsage } from '../types';
import { buildComparePrompt, CompareItem, getCompareSchema, parseComparisons } from './comparePrompt';
import { buildReconcilePrompt, getReconcileSchema, parseReconciliations, ReconcileItem } from './reconcilePrompt';
import { ApplyChange, buildApplyPrompt } from './applyPrompt';
import { buildReadmeFichasPrompt } from './readmeFichasPrompt';
import { formatFichaValue, getFichaValue, isFichaEmpty, parseFichaText } from './fichaUtils';

// Resultado de comparar una ficha del README con la del código (paso 3).
//  - 'same'                → dicen esencialmente lo mismo → NO se toca; se conserva
//                            verbatim el texto del README. El humano no lo ve.
//  - 'readme_unsupported'  → el README afirma algo que el código no respalda.
//                            (Caso 1 del panel: normalmente "quitar/corregir".)
//  - 'code_differs'        → el código dice algo distinto o nuevo respecto al
//                            README. (Caso 2 del panel: "añadir/cambiar".)
export type ComparisonKind = 'same' | 'readme_unsupported' | 'code_differs';

export interface FieldComparison {
  path: string;         // ruta del campo en la plantilla (p. ej. usage.languages)
  label: string;        // etiqueta legible para el panel
  section: string;      // sección de la plantilla
  panelKind: PanelKind; // text | list | env
  readmeValue: unknown; // ficha extraída del README
  codeValue: unknown;   // ficha extraída del código
  kind: ComparisonKind;
  detail?: string;      // qué difiere (lo explica el modelo) — vacío si 'same'
}

// Un "sospechoso" (todo lo que NO es 'same') ya reconciliado (paso 4), listo para el
// panel. 'update' → aplicar proposedValue; 'remove' → quitar el dato; 'keep' → el paso 4
// decidió que en realidad se mantiene (no llega al panel).
export type Recommendation = 'update' | 'keep' | 'remove';

export interface VerifiedSuspect extends FieldComparison {
  recommendation: Recommendation;
  proposedValue: unknown; // valor sugerido para el README (vacío si 'remove')
  reason: string;         // qué se propone cambiar (o por qué se mantiene)
}

export interface ReadmeFichasResult {
  fichas: ReadmeData;
  warnings: string[];
  tokenUsage: TokenUsage;
}

// Paso 1 — README → fichas. Extracción PURA: el modelo copia fielmente lo que el
// README dice en cada campo (no redacta ni infiere). Reutiliza la extracción del
// generador (`extractReadmeData`); `deployment` permite usar el modelo nano (barato).
// La presencia (ficha no vacía) define el alcance de campos del README.
export async function extractReadmeFichas(
  client: AzureResponsesClient,
  readmeText: string,
  workspaceName: string,
  deployment?: string
): Promise<ReadmeFichasResult> {
  const prompt = buildReadmeFichasPrompt(readmeText, workspaceName);
  const result = await client.extractReadmeData(prompt, deployment);
  return {
    fichas: result.data.data,
    warnings: result.data.warnings,
    tokenUsage: result.tokenUsage
  };
}

// Devuelve las rutas de los campos M/A que el README tiene con valor (no vacíos).
// Define el ALCANCE del actualizador: SOLO estos campos se buscan en el código. Los
// que el humano descartó al generar, o borró después del README, quedan fuera y no se
// tocan.
export function getPopulatedFichaPaths(fichas: ReadmeData): Set<string> {
  const paths = new Set<string>();
  for (const field of getAllFields()) {
    if (field.role !== 'M' && field.role !== 'A') {
      continue;
    }
    if (!isFichaEmpty(getFichaValue(fichas, field.path), field.panelKind)) {
      paths.add(field.path);
    }
  }
  return paths;
}

// Paso 2 — Código → fichas (modelo GRANDE, la única llamada cara). Reutiliza la
// extracción del generador, pero ACOTADA por `scopePaths`: el modelo solo busca en el
// código los campos que el README ya documenta, con las instrucciones de la plantilla.
export async function extractCodeFichas(
  client: AzureResponsesClient,
  files: SelectedFile[],
  workspaceName: string,
  repositoryMap: RepositoryMap,
  scopePaths: Set<string>,
  nanoContext: NanoContext
): Promise<ReadmeFichasResult> {
  const prompt = buildExtractionPrompt(files, workspaceName, repositoryMap, nanoContext, scopePaths);
  const result = await client.extractReadmeData(prompt);
  return {
    fichas: result.data.data,
    warnings: result.data.warnings,
    tokenUsage: result.tokenUsage
  };
}

// Paso 3 — Comparar ficha a ficha. Devuelve una comparación por cada campo en alcance.
// Determinista: si el código está vacío para un campo → 'readme_unsupported' (el README
// afirma algo que el código no respalda), sin gastar modelo. Para los campos donde ambos
// tienen contenido, el modelo (una llamada en lote) decide 'same' vs 'differs' por
// SIGNIFICADO, fuertemente sesgado a 'same' (ver comparePrompt). Sin `deployment` usa el
// modelo grande (mejor juicio; la entrada son solo las fichas, sin código).
export async function compareFichas(
  client: AzureResponsesClient,
  scopePaths: Set<string>,
  readmeFichas: ReadmeData,
  codeFichas: ReadmeData,
  deployment?: string
): Promise<FieldComparison[]> {
  const comparisons: FieldComparison[] = getAllFields()
    .filter((field) => scopePaths.has(field.path))
    .map((field) => ({
      path: field.path,
      label: field.label,
      section: field.section,
      panelKind: field.panelKind,
      readmeValue: getFichaValue(readmeFichas, field.path),
      codeValue: getFichaValue(codeFichas, field.path),
      kind: 'same' as ComparisonKind
    }));

  // Código vacío → readme_unsupported (determinista, sin modelo).
  const toCompare: FieldComparison[] = [];
  for (const comp of comparisons) {
    if (isFichaEmpty(comp.codeValue, comp.panelKind)) {
      comp.kind = 'readme_unsupported';
      comp.detail = 'El código no aporta información para este campo.';
    } else {
      toCompare.push(comp);
    }
  }

  // Ambos con contenido → el nano decide same/differs por significado.
  if (toCompare.length > 0) {
    const items: CompareItem[] = toCompare.map((comp) => ({
      path: comp.path,
      label: comp.label,
      readmeText: formatFichaValue(comp.readmeValue, comp.panelKind),
      codeText: formatFichaValue(comp.codeValue, comp.panelKind)
    }));
    const result = await client.callWithSchema(
      buildComparePrompt(items),
      'ficha_comparison',
      getCompareSchema(),
      deployment
    );
    const byPath = new Map(parseComparisons(result.data).map((c) => [c.path, c]));
    for (const comp of toCompare) {
      const verdict = byPath.get(comp.path);
      if (verdict && verdict.status === 'differs') {
        comp.kind = 'code_differs';
        comp.detail = verdict.detail || 'El código difiere de lo que dice el README.';
      } else if (verdict && verdict.detail) {
        comp.detail = verdict.detail;
      }
    }
  }

  return comparisons;
}

// Paso 4 — Reconciliar sospechosos (nano, sin mirar código). Convierte cada sospechoso
// del Paso 3 en una propuesta lista para el panel: qué acción (update/keep/remove) y el
// valor propuesto. readme_unsupported (código vacío) → 'remove' (determinista). Para los
// code_differs, un nano en lote reconcilia README+código y puede además decidir 'keep'
// (segundo filtro de falsos positivos, sin coste de código).
export async function reconcileSuspects(
  client: AzureResponsesClient,
  suspects: FieldComparison[],
  deployment?: string
): Promise<VerifiedSuspect[]> {
  const result: VerifiedSuspect[] = [];
  const toReconcile: FieldComparison[] = [];

  for (const suspect of suspects) {
    if (suspect.kind === 'readme_unsupported') {
      result.push({
        ...suspect,
        recommendation: 'remove',
        proposedValue: emptyValueFor(suspect.panelKind),
        reason: suspect.detail ?? 'El código no aporta información para este campo.'
      });
    } else {
      toReconcile.push(suspect);
    }
  }

  if (toReconcile.length > 0) {
    const items: ReconcileItem[] = toReconcile.map((suspect) => ({
      path: suspect.path,
      label: suspect.label,
      instruction: getFieldInstruction(suspect.path) ?? '',
      panelKind: suspect.panelKind,
      readmeText: formatFichaValue(suspect.readmeValue, suspect.panelKind),
      codeText: formatFichaValue(suspect.codeValue, suspect.panelKind),
      detail: suspect.detail ?? ''
    }));
    const response = await client.callWithSchema(
      buildReconcilePrompt(items),
      'ficha_reconcile',
      getReconcileSchema(),
      deployment
    );
    const byPath = new Map(parseReconciliations(response.data).map((r) => [r.path, r]));
    for (const suspect of toReconcile) {
      const reconciliation = byPath.get(suspect.path);
      if (reconciliation && reconciliation.recommendation === 'update') {
        result.push({
          ...suspect,
          recommendation: 'update',
          proposedValue: parseFichaText(reconciliation.proposedValue, suspect.panelKind),
          reason: reconciliation.reason
        });
      } else {
        // 'keep' o sin respuesta → se mantiene el README (no llega al panel).
        result.push({
          ...suspect,
          recommendation: 'keep',
          proposedValue: suspect.readmeValue,
          reason: reconciliation?.reason ?? ''
        });
      }
    }
  }

  return result;
}

function emptyValueFor(panelKind: PanelKind): unknown {
  return panelKind === 'text' ? '' : [];
}

// Paso 6 — Aplicar los cambios aprobados al README. Atajo MECÁNICO: los campos de tipo
// 'update' cuyo valor actual aparece LITERAL exactamente una vez se sustituyen sin modelo.
// El resto (formato que no calza, o 'remove') los teje el modelo con una instrucción de
// reemplazo puntual. `deployment` = modelo nano. El guardarraíl de estructura lo aplica el
// llamador comparando `extractHeadings` antes/después.
export async function applyApprovedChanges(
  client: AzureResponsesClient,
  readmeText: string,
  changes: ApplyChange[],
  deployment?: string
): Promise<string> {
  let text = readmeText;
  const remaining: ApplyChange[] = [];

  for (const change of changes) {
    const canReplaceMechanically =
      change.action === 'update' &&
      change.currentText.trim().length > 0 &&
      text.split(change.currentText).length === 2; // aparece exactamente una vez
    if (canReplaceMechanically) {
      text = text.split(change.currentText).join(change.newText);
    } else {
      remaining.push(change);
    }
  }

  if (remaining.length === 0) {
    return text;
  }

  const response = await client.completeText(buildApplyPrompt(text, remaining), deployment);
  return cleanMarkdown(response.data);
}

// Encabezados markdown (líneas #…) en orden. Guardarraíl estructural del Paso 6: si
// cambian entre el README original y el aplicado, el modelo rompió la estructura.
export function extractHeadings(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+\S/.test(line));
}

// El modelo debería devolver Markdown sin envolver, pero a veces lo encierra en una valla
// ```markdown. La quitamos y normalizamos el salto de línea final.
function cleanMarkdown(text: string): string {
  let result = text.trim();
  const fenced = result.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  if (fenced) {
    result = fenced[1];
  }
  return result.trimEnd() + '\n';
}
