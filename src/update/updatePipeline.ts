// ─────────────────────────────────────────────────────────────────────────────
// Actualizador de README — pasos puros de la tubería
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
// La orquestación (ranking, contexto del repo, panel, guardado) vive en
// extension.ts::updateReadme; aquí viven los PASOS puros de la tubería.

import { AzureResponsesClient } from '../azure/azureResponsesClient';
import { buildExtractionPrompt, NanoContext } from '../prompt/promptBuilder';
import { RepositoryMap, SelectedFile } from '../scanner/types';
import { FieldSpec, getAllFields, getFieldInstruction, PanelKind } from '../template/templateSpec';
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
// cambian entre el README (ya operado por stripRemovedStructure) y el aplicado, el
// modelo rompió la estructura.
export function extractHeadings(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+\S/.test(line));
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 6 (estructura) — desaparición determinista de secciones y subsecciones
// ─────────────────────────────────────────────────────────────────────────────
//
// Cuando el humano aprueba QUITAR campos, algunos huecos no son de valor sino de
// ESTRUCTURA: una subsección `### Etiqueta` o una sección entera `## N. Título` que
// se queda sin ningún campo con valor. Antes esto chocaba con el guardarraíl de
// encabezados (que exigía estructura idéntica) y abortaba. La solución es que la
// estructura la decidamos NOSOTROS de forma mecánica (sin modelo): eliminamos esos
// bloques aquí y dejamos que el modelo solo sustituya VALORES sobre el resultado ya
// operado. El guardarraíl se mantiene, pero comparando contra ese baseline.

export interface StructuralRemovalPlan {
  // Títulos de secciones que desaparecen enteras (`## N. Título`). Solo secciones sin
  // campos de rol humano (H), donde las fichas conocen con certeza todo el contenido.
  removedSectionTitles: string[];
  // Etiquetas de subsecciones (`### Etiqueta`) que desaparecen, en secciones que
  // sobreviven o que tienen campos H (cuya vacuidad se decide luego sobre el texto).
  removedFieldLabels: string[];
  // Rutas cubiertas por lo anterior: sus cambios ya no van al modelo (son mecánicos).
  structuralPaths: Set<string>;
}

// Decide, a partir de las rutas que el humano aprobó QUITAR y de las fichas actuales
// del README, qué bloques estructurales deben desaparecer. No toca texto: solo planifica.
export function planStructuralRemoval(removedPaths: Set<string>, readmeFichas: ReadmeData): StructuralRemovalPlan {
  const fields = getAllFields();
  const isPopulated = (field: FieldSpec): boolean =>
    !isFichaEmpty(getFichaValue(readmeFichas, field.path), field.panelKind);

  // Agrupar por sección omitible (sectionKey): solo esas pueden desaparecer enteras.
  const groups = new Map<string, { title: string; fields: FieldSpec[] }>();
  for (const field of fields) {
    if (!field.sectionKey) {
      continue;
    }
    let group = groups.get(field.sectionKey);
    if (!group) {
      group = { title: field.section, fields: [] };
      groups.set(field.sectionKey, group);
    }
    group.fields.push(field);
  }

  const removedSectionTitles: string[] = [];
  const structuralPaths = new Set<string>();
  const wholeSections = new Set<string>(); // sectionKey de secciones que se van enteras

  for (const [key, group] of groups) {
    const populated = group.fields.filter(isPopulated);
    if (populated.length === 0) {
      continue; // ya estaba vacía: el README no la muestra, nada que quitar.
    }
    if (populated.some((field) => !removedPaths.has(field.path))) {
      continue; // sobrevive al menos un campo con valor.
    }
    // Todos los campos con valor (según fichas) se quitan. Solo borramos la sección
    // entera de forma determinista si NO tiene campos humanos (H): las fichas no
    // extraen los H, así que en secciones con H la vacuidad se decide sobre el texto.
    if (group.fields.some((field) => field.role === 'H')) {
      continue;
    }
    removedSectionTitles.push(group.title);
    wholeSections.add(key);
    for (const field of populated) {
      structuralPaths.add(field.path);
    }
  }

  // Subsecciones `###` de campos quitados cuya sección NO se va entera: se borra su
  // bloque; si tras ello la sección queda sin contenido, collapse la elimina.
  const removedFieldLabels: string[] = [];
  for (const field of fields) {
    if (!removedPaths.has(field.path) || structuralPaths.has(field.path)) {
      continue;
    }
    if (field.sectionKey && wholeSections.has(field.sectionKey)) {
      continue;
    }
    if (field.headingField) {
      removedFieldLabels.push(field.label);
      structuralPaths.add(field.path);
    }
    // Campos en línea (headingField=false) en una sección que sobrevive: los quita el
    // modelo sustituyendo el valor en su sitio (no cambian encabezados).
  }

  return { removedSectionTitles, removedFieldLabels, structuralPaths };
}

const SECTION_HEADING_REGEX = /^##\s+(?:\d+\.\s+)?(.+?)\s*$/;
const SUBSECTION_HEADING_REGEX = /^###\s+(.+?)\s*$/;
const ANY_HEADING_REGEX = /^#{1,6}\s+\S/;
const SEPARATOR_REGEX = /^-{3,}\s*$/;

function normKey(text: string): string {
  return text.trim().toLowerCase();
}

// Aplica el plan sobre el Markdown: elimina los bloques `## N. Título` y `### Etiqueta`
// indicados, colapsa cualquier sección que quede sin contenido, y renumera/asea. Puro.
export function stripRemovedStructure(
  markdown: string,
  removedFieldLabels: string[],
  removedSectionTitles: string[]
): string {
  if (removedFieldLabels.length === 0 && removedSectionTitles.length === 0) {
    return markdown;
  }
  const fieldSet = new Set(removedFieldLabels.map(normKey));
  const sectionSet = new Set(removedSectionTitles.map(normKey));

  // 1) Borrado de bloques indicados. `section` borra hasta el siguiente `## `;
  //    `field` borra un bloque `###` hasta el siguiente encabezado o separador.
  const afterBlocks: string[] = [];
  let mode: 'none' | 'section' | 'field' = 'none';
  for (const line of markdown.split('\n')) {
    if (mode === 'section') {
      if (/^##\s/.test(line)) {
        mode = 'none';
      } else {
        continue;
      }
    }
    if (mode === 'field') {
      if (ANY_HEADING_REGEX.test(line) || SEPARATOR_REGEX.test(line)) {
        mode = 'none';
      } else {
        continue;
      }
    }
    const sectionTitle = matchHeadingTitle(line, SECTION_HEADING_REGEX);
    if (sectionTitle !== undefined && sectionSet.has(normKey(sectionTitle))) {
      mode = 'section';
      continue;
    }
    const fieldTitle = matchHeadingTitle(line, SUBSECTION_HEADING_REGEX);
    if (fieldTitle !== undefined && fieldSet.has(normKey(fieldTitle))) {
      mode = 'field';
      continue;
    }
    afterBlocks.push(line);
  }

  // 2) Colapso de secciones vacías: una `## N. Título` cuyo cuerpo (hasta la siguiente
  //    `## `) no tenga NINGUNA línea con contenido (ni encabezados, ni texto) se elimina.
  const afterCollapse = collapseEmptySections(afterBlocks);

  // 3) Aseo de separadores/blancos y renumeración final de las secciones supervivientes.
  return renumberSections(tidySeparators(afterCollapse));
}

function matchHeadingTitle(line: string, regex: RegExp): string | undefined {
  const match = line.match(regex);
  return match ? match[1] : undefined;
}

function collapseEmptySections(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const isSection = SECTION_HEADING_REGEX.test(lines[i]) && /^##\s/.test(lines[i]);
    if (!isSection) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !/^##\s/.test(lines[j])) {
      j += 1;
    }
    const hasContent = lines.slice(i + 1, j).some((line) => line.trim() !== '' && !SEPARATOR_REGEX.test(line));
    if (hasContent) {
      for (let k = i; k < j; k++) {
        out.push(lines[k]);
      }
    }
    i = j; // sin contenido → se descarta la sección entera (encabezado incluido).
  }
  return out;
}

// Elimina separadores `---` sobrantes: iniciales, finales y duplicados consecutivos
// (con solo líneas en blanco entre medias). Deja un único `---` entre bloques.
function tidySeparators(lines: string[]): string {
  const kept: string[] = [];
  for (const line of lines) {
    if (SEPARATOR_REGEX.test(line)) {
      let prev = kept.length - 1;
      while (prev >= 0 && kept[prev].trim() === '') {
        prev -= 1;
      }
      if (prev < 0 || SEPARATOR_REGEX.test(kept[prev])) {
        continue; // separador inicial o duplicado.
      }
    }
    kept.push(line);
  }
  while (kept.length > 0) {
    const last = kept[kept.length - 1];
    if (last.trim() === '' || SEPARATOR_REGEX.test(last)) {
      kept.pop();
    } else {
      break;
    }
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trimEnd() + '\n';
}

// Renumera las secciones `## N. Título` de forma secuencial. Espejo de la función del
// mismo nombre en templateRenderer (que no se puede importar aquí: arrastra 'vscode').
function renumberSections(markdown: string): string {
  let counter = 0;
  return markdown
    .split('\n')
    .map((line) => {
      const match = line.match(/^##\s+\d+\.\s+(.*)$/);
      if (!match) {
        return line;
      }
      counter += 1;
      return `## ${counter}. ${match[1]}`;
    })
    .join('\n');
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
