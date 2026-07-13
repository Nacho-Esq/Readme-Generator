# CLAUDE.md — Readme-Generator AI

> Contexto persistente para agentes Claude. Lee este fichero completo antes de realizar cualquier cambio en el repositorio.

---

## 1. Propósito del proyecto

**Readme-Generator AI** es una extensión de VS Code que automatiza la creación de documentación técnica (`README.generated.md`) para proyectos software existentes mediante Azure OpenAI.

- Está específicamente diseñada para proyectos de **agentes conversacionales y chatbots de IA** — la plantilla y los prompts están optimizados para este tipo de proyectos y no está previsto generalizarlos a otros tipos de proyecto.
- El proceso combina análisis heurístico del repositorio con dos llamadas a Azure OpenAI: un modelo ligero (nano) que lee todo el repositorio y genera un ranking de ficheros por importancia, y un modelo potente que lee los ficheros más importantes y extrae la información estructurada.
- Antes de enviar contenido a cualquier modelo, la extensión detecta ficheros sensibles (`.env`, material criptográfico, ficheros de credenciales) y muestra un panel interactivo de dos etapas donde el usuario decide, por fichero, si se **codifica** (se ocultan sus valores), se **excluye** por completo o se envía tal cual; en la segunda etapa puede revisar y editar a mano lo codificado antes de que salga nada.
- El usuario puede revisar y completar la información antes de generar el README final a través de un panel interactivo en VS Code.
- El proyecto está **en desarrollo activo** y aún no está distribuido públicamente.
- Toda la salida (README generado, prompts, plantilla, UI) está en **español**.

---

## 2. Tech stack y dependencias críticas

| Tecnología | Versión | Rol |
|---|---|---|
| TypeScript | 5.5.4 | Lenguaje principal, strict mode, ES2022, CommonJS |
| VS Code Extension API | ^1.92.0 | Plataforma de la extensión |
| Azure OpenAI Responses API | — | LLM para selección de ficheros y extracción de datos |
| `vsce` | ^2.31.1 | Empaquetado y publicación de la extensión |
| Node.js | ^20 | Runtime |

**Dependencias de producción**: **ninguna**. El render es un parser/renderer propio (`templateSpec.ts` + `templateRenderer.ts`); `nunjucks` y `@types/nunjucks` se eliminaron por completo de `package.json` y del lockfile. El resto son devDependencies o APIs de VS Code. *(El analizador detecta "Nunjucks" como tecnología del repo analizado en `repositoryAnalyzer.ts`, pero eso no implica ninguna dependencia de esta extensión.)*

**No hay**: ESLint, Prettier, testing framework, Redux ni ningún gestor de estado externo.

---

## 3. Estructura del repositorio

```
Readme-Generator/
├── src/                          # Código fuente TypeScript
│   ├── extension.ts              # Entry point: activa la extensión y orquesta el flujo completo
│   ├── config.ts                 # Lectura y validación de VS Code settings
│   ├── types.ts                  # Interfaces compartidas (ReadmeData, ExtensionSettings, etc.)
│   ├── azure/
│   │   └── azureResponsesClient.ts  # HTTP client — preSelectImportantFiles() (nano) y extractReadmeData() (principal)
│   ├── prompt/
│   │   ├── fileSelectionPrompt.ts   # buildContentSelectionPrompt() para el nano + JSON schema compartido + buildFileSelectionMetadata() para el trace
│   │   └── promptBuilder.ts         # Prompt + JSON schema para la fase de extracción de datos
│   ├── scanner/
│   │   ├── fileScanner.ts           # scanRepository(), buildFileInventory(), readAllCandidateFiles(), readRawContent(), splitByTokenBudget(); constantes MAX_FILE_BYTES y PRE_SELECTION_MAX_BYTES_PER_FILE
│   │   ├── repositoryAnalyzer.ts    # Detección de stack tecnológico, módulos, entrypoints
│   │   └── types.ts                 # Tipos del scanner (CandidateFile, SelectedFile, RepositoryMap, ReadDepth, etc.)
│   ├── readme/
│   │   └── reviewModel.ts           # Análisis de campos vacíos/pendientes y opciones de render (campos derivados del parser de la plantilla)
│   ├── template/
│   │   ├── templateSpec.ts          # Parser de la plantilla: extrae tokens [[ ruta | ROL | tipo? | instrucción ]], fuente de instrucciones para el modelo y para el panel
│   │   └── templateRenderer.ts      # Renderer propio (sin Nunjucks): sustituye tokens por valores, aplica omitFields/omitSections y placeholders
│   ├── trace/
│   │   └── generationTrace.ts       # Guardado del debug trace en .readme-generator-ai/
│   ├── ui/
│   │   ├── budgetWarningPanel.ts    # Panel webview para ficheros fuera del presupuesto de tokens
│   │   ├── editFormPanel.ts         # Panel webview de revisión: formulario + preview en tiempo real (ver §9)
│   │   └── securityReviewPanel.ts   # Panel webview de protección de datos sensibles (ver §10)
│   └── utils/
│       ├── errors.ts                # asErrorMessage() + describePreSelectionError() (mensaje tipado por error de Azure, ver §7)
│       └── secretRedactor.ts        # Detección de .env y redacción agresiva de secretos: redactSecrets(), countRedactions() (ver §10)
├── templates/
│   └── readme.template.md           # Plantilla Markdown del README. Legible por humanos y fuente de instrucciones para el modelo. Formato de token: [[ ruta | M/H(?) | tipo? | instrucción ]]
├── dist/                            # Compilado TypeScript (no editar manualmente)
├── package.json                     # Metadatos, comandos VS Code, configuración de la extensión
├── tsconfig.json                    # Configuración TypeScript
└── README.md                        # Documentación de la extensión en español
```

---

## 4. Arquitectura y flujo de datos

El flujo completo se inicia con el comando `readmeGeneratorAi.generateReadme` y pasa por 9 fases secuenciales. El pipeline usa **dos modelos LLM distintos**: un modelo ligero (nano) para el ranking de ficheros y un modelo potente para la extracción de datos. Antes de cualquier llamada LLM se ejecuta la fase de protección de datos sensibles.

```mermaid
flowchart TD
    A[Usuario ejecuta comando] --> B[Scan del repositorio]
    B --> C[Pre-filtro heurístico]
    C --> D[Análisis de repositorio]
    D --> E[Panel de seguridad — 2 etapas: clasificar + verificar/editar]
    E -->|Cancelar / cerrar ventana| Z[Fin sin fichero]
    E -->|Continuar| F[Lectura masiva — codificados via overrides, excluidos fuera]
    F --> G{Ranking LLM nano}
    G -->|OK| H[Ficheros rankeados por importancia]
    G -->|Error| Y[Mensaje de error tipado y fin — sin fallback]
    H --> J[Selección modelo principal — reutiliza contenido en memoria]
    J --> K[Extracción LLM principal → ReadmeData]
    K --> L[Render plantilla → markdown inicial]
    L --> M[Panel de revisión EditFormPanel]
    M -->|Guardar| N[Render final → README.generated.md]
    M -->|Cancelar| Z
```

### Detalle de cada fase

**Fase 1 — Scan** [`src/scanner/fileScanner.ts` → `scanRepository()`]
- Descubre todos los ficheros (`**/*`) y filtra por **listas de exclusión** (no por allowlist de extensiones)
- Excluye directorios (`IGNORE_DIRECTORIES`): `node_modules`, `.git`, `.readme-generator-ai`, `dist`, `build`, `venv`, `.venv`, `__pycache__`, `coverage`
- Excluye extensiones binarias/ruido (`IGNORE_EXTENSIONS`): imágenes, `.svg`, audio/vídeo, `.pdf`, `.lock`, binarios compilados, archivos comprimidos, fuentes, bases de datos, etc.
- Solo se admiten ficheros con tamaño `> 0` y `<= MAX_FILE_BYTES` (**2 MB**, umbral único y alto). Por encima se descartan en el escaneo.

**Fase 2 — Pre-filtro heurístico** [`src/scanner/fileScanner.ts` → `buildFileInventory()` / `discardReason()`]
- Descarta automáticamente, **solo por nombre/ruta** (no lee contenido): lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `go.sum`, `bun.lockb`, etc.), la propia salida del generador (`README.generated.md`, para no reingerirla), fixtures y snapshots de tests (`/__snapshots__/`, `/fixtures/`, `/fixture/`), y assets minificados (`.min.js`, `.bundle.js`)
- Es **conservador a propósito**: ante la duda incluye. El límite de tamaño (2 MB) ya se aplica en la Fase 1, y `dist/`/`build/` ya se excluyen como directorios. Otros generados (clientes GraphQL/OpenAPI, etc.) **no** se descartan aquí: pasan al nano, que tiene su propia fase de descarte.
- Produce `FileInventory { selectorInventory, discardedSummary }`
- `selectorInventory` = ficheros candidatos que pasarán al modelo nano

**Fase 3 — Analyze** [`src/scanner/repositoryAnalyzer.ts`]
- Produce `RepositoryMap`: tecnologías detectadas, entrypoints, módulos, documentación existente

**Fase 4 — Protección de datos sensibles** [`src/utils/secretRedactor.ts` + `src/ui/securityReviewPanel.ts` + `classifySensitiveFile()` en `extension.ts`]
- **Autodetección** (por nombre): `classifySensitiveFile()` marca con un disposition sugerido los ficheros sensibles del `selectorInventory` — material criptográfico (`.pem`, `.key`, `id_rsa`, `.pfx`, …) → *No enviar*; `.env` (vía `isEnvFile()`) y ficheros de credenciales (`.npmrc`, `.netrc`, `.tfvars`, `secrets.*`, `credentials.*`) → *Codificar*. `.env.example`/`sample`/`template`/`dist` **no** se autodetectan (se envían enteros por defecto).
- **Panel de dos etapas** (`SecurityReviewPanel.show(input, extensionUri, redact)`):
  - *Etapa 1 — clasificar*: el usuario asigna a cada fichero **Enviar / Codificar / No enviar**. Los autodetectados llegan con su disposition sugerido; el resto, en un árbol por directorio, con default *Enviar*.
  - *Etapa 2 — verificar*: al continuar, la extensión lee y redacta (callback `redact`) los marcados como *Codificar* y los muestra **ya codificados**, con contador de valores ocultados, **editables a mano**, y opción de bajarlos a *No enviar*. Nada se envía hasta "Confirmar".
- **Fail-closed**: cancelar o **cerrar la ventana** aborta el flujo completo sin ninguna llamada LLM.
- Resultado `SecurityReviewResult { action, excludePaths[], redactedFiles[{path, content}] }`. La extensión deriva un `Set` de exclusión y un `Map` de **content overrides** (contenido final ya redactado/editado), y registra `trace.securitySummary`.

**Fase 5 — Lectura masiva (nano)** [`src/scanner/fileScanner.ts` → `readAllCandidateFiles()`]
- Lee el contenido de **todos** los ficheros del `selectorInventory` salvo los excluidos por el usuario (`sendableInventory`)
- Límite por fichero: `PRE_SELECTION_MAX_BYTES_PER_FILE = 200.000 bytes` (200KB) — sin límite total de tokens
- Para los ficheros codificados usa el **content override** (contenido ya redactado/editado en la Fase 4); el resto se lee tal cual del disco. La firma es `readAllCandidateFiles(files, maxBytes, { overrides, exclude })`
- Produce `SelectedFile[]` que se envía al modelo nano

**Fase 6 — Ranking LLM nano** [`src/prompt/fileSelectionPrompt.ts` + `src/azure/azureResponsesClient.ts`]
- Llama al modelo ligero (`preSelectionDeployment`, por defecto `test-plantillas-gpt-5.4-nano`) con el contenido de todos los ficheros enviables
- El nano **no extrae información del proyecto** — solo identifica dónde está la lógica central y genera un ranking ordenado de más a menos importante, descartando ficheros irrelevantes
- Devuelve `FileSelectionResult { selectedFiles[{path, reason}], discardedFiles, warnings[] }`
- **Sin fallback heurístico**: el nano es el único responsable del orden. Si la llamada falla, el flujo **se aborta** con un mensaje de error tipado (`describePreSelectionError()`, ver §7) — p. ej. si el repo excede la ventana de contexto, se sugiere usar un deployment con mayor contexto.

**Fase 7 — Selección para el modelo principal** [`extension.ts`]
- Toma los ficheros del ranking del nano que caben en el presupuesto (`splitByTokenBudget`) más los que el usuario añada en el `BudgetWarningPanel`
- **No relee del disco**: reutiliza el contenido ya cargado en la Fase 5 (`allCandidateFiles`) mediante un `Map` por ruta → una sola pasada de I/O y el modelo grande ve exactamente lo mismo que el nano
- Respeta `tokenBudget` según `readDepth` (básico: 30k, detallado: 90k, profundo: 180k) — **solo para el modelo principal**. Lectura completa o saltar, **nunca trunca**

**Fase 8 — Extracción LLM principal** [`src/prompt/promptBuilder.ts` + `src/azure/azureResponsesClient.ts`]
- Llama al modelo potente (`deployment`) con el contenido de los ficheros seleccionados + `RepositoryMap`
- Extrae `ReadmeData` estructurado vía JSON schema estricto

**Fase 9 — Review** [`src/ui/editFormPanel.ts`]
- Muestra el panel webview con formulario (izquierda) + preview markdown en tiempo real (derecha)
- El usuario completa campos vacíos, descarta secciones opcionales y guarda
- El resultado es `README.generated.md` en la raíz del workspace analizado

---

## 5. Componentes principales

| Módulo | Fichero | Responsabilidad |
|--------|---------|-----------------|
| Orquestación | `src/extension.ts` | Entry point, registro de comandos, flujo completo |
| Configuración | `src/config.ts` | `getSettings()`, `ensureConfigured()`, `getReadDepthTokenBudget()`, `getPreSelectionDeployment()` |
| Tipos compartidos | `src/types.ts` | `ExtensionSettings`, `ExtractionResult`, `TokenUsage`. `ReadmeData` es un alias laxo (`Record<string, unknown>`): la estructura real se deriva de la plantilla |
| Azure client | `src/azure/azureResponsesClient.ts` | `preSelectImportantFiles()` (nano, Fase 6), `extractReadmeData()` (principal, Fase 8) — ambas con JSON schema estricto |
| Prompt del nano | `src/prompt/fileSelectionPrompt.ts` | `buildContentSelectionPrompt()` (Fase 6), `buildFileSelectionMetadata()` (trace), `getFileSelectionJsonSchema()` |
| Prompt de extracción | `src/prompt/promptBuilder.ts` | Construye el prompt y schema para la Fase 8 |
| Parser de plantilla | `src/template/templateSpec.ts` | Parsea `readme.template.md` → campos con ruta, rol M/H/A, tipo, label y sección. **Fuente única** de la estructura de datos, el schema, las instrucciones y las secciones del panel |
| Scanner | `src/scanner/fileScanner.ts` | `scanRepository()`, `buildFileInventory()` (Fase 2), `readAllCandidateFiles()`/`readRawContent()` (Fase 5), `splitByTokenBudget()` |
| Analyzer | `src/scanner/repositoryAnalyzer.ts` | `analyzeRepository()` → `RepositoryMap` |
| Redactor de secretos | `src/utils/secretRedactor.ts` | `isEnvFile()` — detecta `.env` por nombre; `redactSecrets()` — redacción agresiva en 3 pasadas; `countRedactions()` |
| Errores | `src/utils/errors.ts` | `asErrorMessage()`; `describePreSelectionError()` — mensaje tipado por error de Azure en la llamada al nano |
| Panel de seguridad | `src/ui/securityReviewPanel.ts` | Webview de la Fase 4 en dos etapas (clasificar + verificar/editar); recibe un callback `redact` para leer y redactar |
| Panel de presupuesto | `src/ui/budgetWarningPanel.ts` | Webview para ficheros que no caben en el token budget del modelo principal |
| Modelo de revisión | `src/readme/reviewModel.ts` | `analyzeReadmeData()`, `prepareDataForReview()`, `completeRenderOptions()`; consume los campos derivados del parser (`getAllFields()`) |
| Renderer | `src/template/templateRenderer.ts` | `render(templatePath, data, options)` — renderer propio sin Nunjucks; sustituye tokens por valores según tipo (text/csv/list/env/code/raw/image), aplica `omitFields`/`omitSections` y `FILL_PLACEHOLDER`. Cachea el texto de la plantilla por ruta (`templateCache`) para no releer disco en cada pulsación del preview; instancia nueva por generación |
| Panel de edición | `src/ui/editFormPanel.ts` | Webview con formulario + preview en tiempo real (Fase 9) |
| Trace | `src/trace/generationTrace.ts` | Guarda debug trace en `.readme-generator-ai/last-run.{json,md}` |
| Template | `templates/readme.template.md` | Plantilla Markdown con 14 secciones. Legible por humanos; los tokens `[[ ruta \| ROL \| tipo? \| instrucción ]]` son a la vez el prompt del modelo y la guía del humano |

---

## 6. Configuración (VS Code settings)

Toda la configuración se lee desde VS Code settings con el prefijo `readmeGeneratorAi.*`. **No hay `.env`**.

| Setting | Tipo | Default | Descripción |
|---------|------|---------|-------------|
| `apiKey` | string | `""` | API key de Azure OpenAI (**requerido**, scope `machine`) |
| `endpoint` | string | `""` | URL del recurso Azure OpenAI (**requerido**, scope `machine`) |
| `deployment` | string | `"test-plantillas-gpt-5.2-codex"` | Deployment del modelo principal/potente (**requerido**, scope `machine`) |
| `preSelectionDeployment` | string | `""` | Deployment del modelo ligero (nano) para el ranking de ficheros. Si vacío, usa `test-plantillas-gpt-5.4-nano` (scope `machine`) |
| `templatePath` | string | `""` | Ruta a plantilla Markdown personalizada (vacío = `templates/readme.template.md` bundleada). Si se personaliza, debe respetar el formato de tokens `[[ ruta \| ROL(?) \| tipo? \| instrucción ]]`. |
| `readDepth` | `básico`\|`detallado`\|`profundo`\|`personalizado` | `"básico"` | Presupuesto de tokens del **modelo principal** para leer ficheros (básico: 30k, detallado: 90k, profundo: 180k; `personalizado` usa `readDepthCustomBudget`, mín. 1k). No afecta al modelo nano. |
| `readDepthCustomBudget` | number | — | Presupuesto de tokens a medida cuando `readDepth = personalizado` (`getReadDepthTokenBudget` aplica `max(1000, valor)`; default 30k si vacío). |
| `debugTrace` | boolean | `true` | Si `true`, guarda trace en `.readme-generator-ai/` |

**Nota sobre límites de lectura**: ambos modelos leen ficheros hasta un máximo de 200KB por fichero (`PRE_SELECTION_MAX_BYTES_PER_FILE`, constante hardcodeada en `fileScanner.ts`). Este límite no es configurable. El nano no tiene límite total de tokens; el modelo principal respeta el `tokenBudget` de `readDepth`.

Los tres primeros settings son **obligatorios**. Si falta alguno, `ensureConfigured()` muestra un error y abre la UI de configuración de VS Code.

---

## 7. Integración con Azure OpenAI

### Endpoint y autenticación

El cliente en `src/azure/azureResponsesClient.ts` usa la **Azure OpenAI Responses API** (`POST /openai/v1/responses`). No hay SDK de Azure — es un cliente HTTP directo. Ambas llamadas LLM van al mismo endpoint pero con deployments distintos.

### Dos modelos y dos llamadas LLM en el pipeline

**Llamada 1 — Ranking de ficheros (modelo nano)** (`preSelectImportantFiles`):
- Modelo: `settings.preSelectionDeployment` (override) o `DEFAULT_PRE_SELECTION_DEPLOYMENT = 'test-plantillas-gpt-5.4-nano'`
- Input: contenido de todos los ficheros enviables (codificados y sin los excluidos según la Fase 4) + `RepositoryMap`
- Output: `FileSelectionResult { selectedFiles[{path, reason}], discardedFiles, warnings[] }` — ranking ordenado de más a menos importante
- Schema: definido en `src/prompt/fileSelectionPrompt.ts` → `getFileSelectionJsonSchema()`
- El nano **no extrae datos del proyecto**, solo localiza e identifica ficheros por relevancia
- **Errores**: sin fallback. El `catch` usa `describePreSelectionError(error, deployment)` para mostrar un mensaje específico según el error de Azure (contexto excedido → sugiere modelo con más ventana; 401 → `apiKey`/`endpoint`; 404 → nombre de deployment; 429 → límite de tasa; filtro de contenido; red) y un mensaje genérico si el texto no se reconoce.

**Llamada 2 — Extracción de datos (modelo principal)** (`extractReadmeData`):
- Modelo: `settings.deployment` (modelo potente, configurable)
- Input: contenido de los ficheros seleccionados por el nano (codificados y sin excluidos, idéntico a lo que vio el nano) + `RepositoryMap`
- Output: `ExtractionResult { data: ReadmeData, warnings[] }`
- Schema: definido en `src/prompt/promptBuilder.ts` → `getExtractionJsonSchema()`

### Parámetros LLM

- Temperatura, `max_tokens` y similares **no están expuestos** — los controla la configuración de cada deployment en Azure.
- `strict: true` en el JSON schema — el modelo debe devolver exactamente la estructura definida.

### Riesgo crítico con los schemas

El schema de extracción se **deriva de la plantilla** (`buildDataJsonSchema()` en `templateSpec.ts`): los campos, tipos y `required` salen de los tokens. Una ruta o tipo mal escritos en un token producen un schema incoherente que **romperá silenciosamente la extracción** o lanzará una excepción. El schema del nano (`fileSelectionPrompt.ts`) sigue siendo manual. `strict: true` exige que el modelo devuelva exactamente la estructura definida.

---

## 8. Sistema de plantillas

### Fichero de plantilla

`templates/readme.template.md` — Markdown puro legible por humanos. Tiene 14 secciones. Cada hueco de dato es un **token** con la instrucción para el modelo integrada:

```
[[ ruta.del.campo | ROL(?) | tipo? | instrucción ]]
```

- **`ruta.del.campo`**: ruta dentro de `ReadmeData` (p. ej. `summary.what_is`).
- **`ROL`**: `M` = lo busca/rellena el **modelo**; `H` = lo rellena el **humano** (el modelo ni lo intenta, se excluye del prompt y del JSON schema). Añadir `?` hace el campo omitible (`omitFields`).
- **`tipo`**: determina el TIPO de dato y cómo se renderiza. **Sin tipo → string (texto en línea)**. Tipos de lista (`string[]`): `list` (viñetas), `csv` (unida por comas), `code` (backticks). Otros: `env` (variables nombre+descripción), `raw` (contenido en crudo, p. ej. Mermaid), `image` (imagen Markdown). **Un campo que sea lista DEBE declarar su tipo**; sin él, el modelo lo trata como string.
- **`instrucción`**: prompt para el modelo y guía para el humano. **No aparece** en el README final.

El **label** del panel se deriva de la negrita que precede al token (`- **Qué es**:`); para tokens sin negrita, del título de su `##`. La **sección del panel** es el `## N. Título` que contiene el token (14 secciones + "General" para la cabecera). Las secciones opcionales usan marcadores `<!--section:clave-->…<!--/section-->` y se omiten enteras cuando `omitSections[clave]` es `true`.

### La plantilla como FUENTE ÚNICA

`src/template/templateSpec.ts` parsea la plantilla una vez al inicio del flujo (`initTemplateSpec`) y de ella **deriva toda la estructura de datos**. No hay estructura de campos hardcodeada en ningún otro fichero (se eliminaron `fieldInstructions.ts`, `fieldMetadata.ts`, `emptyReadmeData` y las subinterfaces de `ReadmeData`). `initTemplateSpec` **falla rápido** si la plantilla no contiene ningún token `[[ … ]]` válido (lanza un error en lugar de seguir con un schema/prompt vacíos).

Expone:
- `getAllFields()` / `getFormSections()` → campos (path, rol, tipo JSON, label, sección) y su agrupación para el panel.
- `buildDataJsonSchema()` → JSON Schema de Azure (rutas + tipos derivados, excluyendo campos H).
- `buildEmptyData({ excludeHuman })` → objeto vacío con la forma exacta; con `excludeHuman` para el ejemplo de salida del prompt.
- `buildFieldInstructionText()` → instrucciones de los campos que rellena el modelo (M **y A**) para el prompt. Para un campo `env` añade automáticamente las sub-instrucciones `.name`/`.description` derivadas de su tipo (no de un path hardcodeado).
- `getFieldInstruction(path)` → instrucción individual (placeholder del panel); resuelve los sub-campos de `env` detectando que el padre del path es de tipo `env`.
- `isHumanField(path)` → `true` si el campo es H.
- `isReviewField(path)` → `true` si el campo es A (el modelo lo rellena como un M, pero requiere revisión humana).
- `fieldKey(path)` → clave normalizada para `omitFields`.

**El tipo `ReadmeData` (en `types.ts`) es ahora un alias laxo (`Record<string, unknown>`)**: el acceso a los datos es dinámico por ruta. **Añadir un campo nuevo = una sola línea en la plantilla** (token con su ruta, rol, tipo e instrucción); el modelo lo busca, aparece en el schema, en el panel y en el README sin tocar código.

### `RenderOptions` — control de secciones

`completeRenderOptions()` en `src/readme/reviewModel.ts` calcula qué secciones/campos omitir. El renderer usa `renderOptions.omitFields` (para campos marcados con `?`) y `renderOptions.omitSections` (para bloques `<!--section:clave-->`). El usuario puede descartar campos desde el formulario.

### Placeholder de campos vacíos

Los campos sin información llevan el marcador `RELLENAR POR USUARIO` (constante `FILL_PLACEHOLDER`). La template los resalta visualmente.

---

## 9. UI — Panel de revisión (`EditFormPanel`)

### Componente activo: `src/ui/editFormPanel.ts`

Es el panel de UI de la Fase 9. Implementa una webview de VS Code con:
- **Columna izquierda**: listado de advertencias; **bloque "Campos a revisar"** (los campos de rol **A** que el modelo sí rellenó — `review.reviewNeeded` —, con su valor precargado y editable para que el humano lo verifique/corrija, badge ámbar "revisar"); y **bloque "Campos pendientes"** (los campos vacíos que el usuario debe completar — `review.missing` —, incluidos los campos A que el modelo dejó vacíos, badge rojo "pendiente"). Ambos bloques permiten descartar campos.
- **Columna derecha**: preview markdown en tiempo real (debounce 150ms)
- **Flujo de mensajes**: cambio en formulario → `collect()` JS → `postMessage()` → extensión → re-render (renderer propio) → webview actualiza preview

El resultado es `EditResult { action: 'save' | 'cancel', data: ReadmeData, renderOptions }`.

### Histórico: `previewPanel.ts` (eliminado)

Antes existía un panel de **previsualización de solo lectura** (`PreviewPanel`) que se mostraba tras la extracción: campos pendientes con botones *Mantener/Eliminar sección* y, a la derecha, el markdown generado, más un botón *Editar campos* que abría el formulario. Era un flujo de dos pasos (*ver* → *editar*). `EditFormPanel` es un superconjunto que integra ambas funciones en un único panel (preview en vivo + edición + descarte de campos en el sitio), así que `src/ui/previewPanel.ts` se **eliminó** del repositorio. No reintroducir un panel de preview separado.

---

## 10. Capa de seguridad — protección de datos sensibles

### Objetivo

Evitar que API keys, contraseñas u otros valores confidenciales lleguen a los modelos LLM. El fichero original en disco del usuario **nunca se modifica** — la redacción se aplica únicamente sobre la copia en RAM que se usa para construir los prompts.

### Módulo de redacción: `src/utils/secretRedactor.ts`

Módulo puro (sin imports de vscode). Exporta `isEnvFile()`, `redactSecrets()`, `countRedactions()` y la constante `REDACTADO`.

**`isEnvFile(relativePath: string): boolean`**
- Detecta ficheros `.env` por nombre (`.env`, `.env.local`, `.env.production`, `config.env`, …), excluyendo `.env.example|sample|template|dist`.

**`redactSecrets(content: string, relativePath: string): string`** — redactor agresivo en 3 pasadas, línea a línea:
1. **Asignaciones estilo env/shell** (`.env`, `.sh`, `.properties`, `.ini`, `.toml`, …): redacta el valor de `(export )?CLAVE = valor`, con `export`, indentación, comillas y espacios alrededor del `=`. En estos ficheros se redactan **todos** los valores (cualquier valor es sospechoso).
2. **Clave-valor estructurado** (JSON/YAML/código): redacta el valor solo si el **nombre de la clave** parece secreto (`secret|token|password|api[_-]?key|private|auth|...`), preservando config inocua (`port: 8080`).
3. **Escáner de tokens** (red de seguridad, sin importar el contexto): enmascara JWT, claves AWS/GitHub/OpenAI/Slack, credenciales embebidas en URL, valores de connection strings y cadenas largas de alta entropía (base64/hex).

Es **deliberadamente agresivo** (puede sobre-redactar algo inocuo); la etapa 2 del panel deja al usuario revisarlo y revertirlo editando.

`countRedactions(content)` cuenta los `[REDACTADO]` resultantes (para mostrar "N valores codificados" y para la traza).

### Panel interactivo de dos etapas: `src/ui/securityReviewPanel.ts`

Clase estática con `show(input, extensionUri, redact)` que devuelve `Promise<SecurityReviewResult>`. Webview de **una sola ventana con dos etapas** (mensajería bidireccional; la redacción ocurre en la extensión vía el callback `redact`, no en el webview):

- **Etapa 1 — clasificar**: por cada fichero, disposition **Enviar / Codificar / No enviar**. Sección de autodetectados (con disposition sugerido) + árbol de candidatos por directorio (default *Enviar*).
- **Etapa 2 — verificar**: al continuar, la extensión redacta los marcados como *Codificar* y los devuelve al webview, que los muestra **ya codificados**, con `<textarea>` editable y opción de bajarlos a *No enviar*.
- **Fail-closed**: `onDidDispose` resuelve `cancel` — cerrar la ventana **detiene** el flujo.
- El JSON inyectado en el `<script>` escapa `<` (`<`) para que contenido de repo no confiable no rompa el bloque (mismo arreglo aplicado en `budgetWarningPanel.ts`).

```typescript
type RedactFn = (paths: string[]) => Promise<Array<{ path: string; content: string; redactionCount: number }>>;

interface SecurityReviewResult {
  action: 'continue' | 'cancel';
  excludePaths: string[];                              // no se envían a ningún modelo
  redactedFiles: Array<{ path: string; content: string }>; // contenido final ya redactado/editado
}
```

### Integración en `extension.ts`

- `classifySensitiveFile(path)` produce la lista de autodetectados con su disposition sugerido.
- El callback `redact` lee cada fichero (`readRawContent`) y aplica `redactSecrets`.
- Del resultado se derivan `excludedPaths: Set<string>` y `contentOverrides: Map<path, content>`, y se rellena `trace.securitySummary`.
- `sendableInventory` = `selectorInventory` menos los excluidos. Ambas lecturas (`readAllCandidateFiles`) reciben `{ overrides: contentOverrides, exclude: excludedPaths }`, de modo que los codificados usan el contenido verificado/editado y los excluidos no se leen nunca.

### Qué cubre y qué no cubre

| Tipo de fichero | Cobertura |
|----------------|-----------|
| `.env`, `.env.local`, `.env.production`, etc. | ✅ Autodetectado → *Codificar* (todos los valores) |
| Material criptográfico (`.pem`, `.key`, `id_rsa`, `.pfx`, …) | ✅ Autodetectado → *No enviar* por defecto |
| Ficheros de credenciales (`.npmrc`, `.netrc`, `.tfvars`, `secrets.*`, …) | ✅ Autodetectado → *Codificar* |
| `.env.example`, `.env.sample` | ✅ Se envían enteros por defecto; el usuario puede codificarlos/excluirlos en el panel |
| Secrets en JSON/YAML/código marcados por el usuario | ✅ Redacción agresiva por clave + escáner de tokens |
| Secrets en ficheros **no** marcados ni autodetectados | ⚠️ No se redactan — no se escanea el contenido de todos los ficheros (latencia/falsos positivos) |

---

## 11. Workflow de desarrollo

### Requisitos previos

- VS Code instalado
- Node.js ^20
- `npm install`

### Desarrollo local

```bash
npm run compile     # Compila TypeScript a dist/ (equivale a: tsc -p ./)
npm run watch       # Compilación en modo watch para desarrollo activo
```

Pulsar **F5** en VS Code abre una ventana "Extension Development Host" donde la extensión está activa para pruebas manuales.

### Empaquetado y publicación

```bash
npm run package     # Genera readme-generator-ai-X.X.X.vsix
npm run publish     # Publica en VS Code Marketplace (requiere token de publisher)
```

### Debug traces

Con `debugTrace: true` (default), cada ejecución guarda en el repositorio analizado:
- `.readme-generator-ai/last-run.json` — trace completo en JSON
- `.readme-generator-ai/last-run.md` — trace legible en markdown

El comando `readmeGeneratorAi.openLastTrace` abre el trace de la última ejecución. El trace incluye `selectionPrompt`, que contiene el contenido de los ficheros enviados al nano — **ya redactado/sin los excluidos** (refleja exactamente lo que se envió). Incluye además `securitySummary` (y la sección "🔒 Protección de datos sensibles" en el markdown) con los ficheros excluidos y los codificados por el usuario, con el nº de valores ocultados por fichero.

---

## 12. Decisiones de diseño y restricciones

| Decisión | Razón / Implicación |
|----------|---------------------|
| **Sin tests automatizados** | Las pruebas se hacen manualmente vía F5 + Extension Development Host |
| **Sin ESLint/Prettier** | El estilo se mantiene manualmente; no introducir linters sin autorización |
| **Solo español** | Prompts, plantilla, UI y README generado están en español; no hay internacionalización prevista |
| **Azure Responses API** (no Chat Completions) | Permite structured outputs con JSON schema estricto; no migrar a otro endpoint sin autorización |
| **Sin temperatura/max_tokens en cliente** | Controlados por el deployment Azure; no añadir estos parámetros al cliente sin autorización |
| **Modelo nano para ranking, modelo potente para extracción** | El nano lee todo el proyecto (barato, sin límite de tokens total) y genera un ranking por importancia. El potente solo lee los ficheros más relevantes (costoso, limitado por `readDepth`). Esta separación es intencional y no debe colapsarse en una sola llamada. |
| **Token budget solo para el modelo principal** | El `readDepth` (30k/90k/180k tokens) limita exclusivamente la lectura del modelo potente. El nano no tiene límite de tokens total — leer todo el proyecto es el objetivo. No mezclar ambos presupuestos. |
| **Lectura completa o saltar, nunca truncar** | El modelo principal lee ficheros completos o los salta si no caben en el budget. Un fichero truncado es peor que no leerlo. Esta lógica está en `readAllCandidateFiles()` + `splitByTokenBudget()`. |
| **Límite por fichero unificado en 200KB** | Ambos modelos usan `PRE_SELECTION_MAX_BYTES_PER_FILE = 200_000`. No es configurable; es suficientemente alto para cualquier fichero de código real y evita abusos con ficheros binarios enormes. |
| **Token budget basado en readDepth** | Evita costes imprevistos en el modelo principal; los tres niveles están calibrados — no cambiar los valores sin autorización |
| **Plantilla como fuente única de TODO** | `readme.template.md` es la única fuente de la estructura de datos, el JSON schema, las instrucciones del modelo, los roles M/H y las secciones del panel. Todo se deriva de los tokens en runtime (`templateSpec.ts`). Se eliminaron `fieldInstructions.ts`, `fieldMetadata.ts`, `emptyReadmeData` y las subinterfaces de `ReadmeData`. Añadir/cambiar un campo = editar la plantilla, sin tocar código. No reintroducir estructura de campos hardcodeada en otros ficheros. |
| **Configuración solo via VS Code settings** | No hay `.env`; `apiKey` y `endpoint` son scope `machine` por seguridad |
| **El nano es el único que ordena (sin fallback heurístico)** | Decisión explícita: no existe ranking heurístico de respaldo. Si el nano falla, el flujo se aborta con un mensaje tipado (`describePreSelectionError`). El riesgo de desbordar la ventana de contexto en repos enormes se gestiona con ese mensaje (sugerir un modelo con más contexto), no truncando ni leyendo parcialmente. No reintroducir un fallback ni recortar el contenido enviado al nano sin autorización. |
| **Umbral único de tamaño de fichero: 2 MB** | `MAX_FILE_BYTES = 2_000_000` en el escaneo (Fase 1). Alto a propósito para no dejar fuera código real; por encima se descarta. No confundir con `PRE_SELECTION_MAX_BYTES_PER_FILE` (200KB), que limita cuánto se **lee** de cada fichero. |
| **Lectura única del contenido (sin doble I/O)** | El contenido se lee una sola vez para el nano (`allCandidateFiles`) y el modelo principal lo **reutiliza desde memoria**. Garantiza consistencia entre lo que vio el nano y lo que lee el modelo grande. No reintroducir una segunda lectura de disco. |
| **Salida como `README.generated.md`** | No sobreescribe un `README.md` existente del proyecto analizado. Se descarta como candidato en re-ejecuciones para no reingerirla. |
| **Autodetección por nombre, redacción por contenido** | La *autodetección* de ficheros sensibles es solo por nombre (no se escanea el contenido de todos los ficheros: latencia y falsos positivos). Pero la *redacción* de un fichero marcado (`redactSecrets`) sí es **content-aware** y agresiva. No introducir un escaneo de contenido de todo el repo. |
| **Redacción agresiva con verificación humana** | `redactSecrets` puede sobre-redactar (mejor pasarse que filtrar). La etapa 2 del panel (verificar/editar) es la red de seguridad final. La redacción no depende de una allowlist fija de nombres de variable: en `.env` redacta todos los valores; en ficheros estructurados combina heurística de nombre de clave + escáner de tokens. |
| **Fail-closed en el panel de seguridad** | Cancelar o cerrar la ventana del panel aborta el flujo sin enviar nada. Para una compuerta de datos sensibles, el default seguro es no enviar. |
| **Los ficheros originales en disco no se modifican** | La redacción ocurre solo sobre la copia en RAM (content overrides). El fichero del usuario permanece intacto. |
| **`.env.example` y `.env.sample` se envían enteros** | Son plantillas públicas; sus valores (`API_KEY=pon-aqui-tu-clave`) son documentación útil. No se autodetectan, pero aparecen en el panel para que el usuario los codifique/excluya si lo desea. |

---

## 13. Zonas críticas — ficheros de alto riesgo

Antes de modificar cualquiera de estos ficheros, explicar al usuario exactamente qué se va a cambiar y esperar confirmación:

| Fichero | Riesgo |
|---------|--------|
| `src/prompt/promptBuilder.ts` | Contiene el JSON schema de extracción; cualquier error rompe la Fase 8 |
| `src/prompt/fileSelectionPrompt.ts` | Contiene el JSON schema de selección y el prompt del nano; cualquier error rompe la Fase 6 |
| `templates/readme.template.md` | **Fuente única** de campos, tipos, roles, instrucciones y marcadores `<!--section:X-->`. Una ruta o tipo mal escritos rompen el schema, el panel o el render (ver §8) |
| `src/template/templateSpec.ts` | Parser que deriva de la plantilla la estructura, el schema, las instrucciones y las secciones del panel. Un error rompe prompt, schema, panel y render |
| `src/ui/editFormPanel.ts` | Webview complejo con HTML/CSS/JS inline y patrón de mensajería; cambios de layout pueden romper el formulario |
| `src/utils/secretRedactor.ts` | Cambios en los patrones de detección o en la lógica de redacción pueden provocar fugas de datos sensibles al LLM |
| `src/ui/securityReviewPanel.ts` | Webview de dos etapas con mensajería bidireccional y callback de redacción; un fallo puede saltarse la compuerta de seguridad o romper la verificación |

---

## 14. Instrucciones para agentes Claude

### Comportamiento obligatorio

1. **Scope mínimo**: realizar únicamente los cambios solicitados. No añadir funcionalidades, no refactorizar, no mejorar código fuera del scope de la tarea.

2. **Declaración previa**: antes de modificar cualquier fichero, listar explícitamente los ficheros que se van a cambiar y por qué. Si la tarea afecta a más de 2 ficheros, pedir confirmación explícita al usuario.

3. **Confirmación ante impacto amplio**: si un cambio puede afectar al comportamiento visible para el usuario (prompts, plantilla, schemas LLM, UI webview), describir el impacto y esperar confirmación antes de proceder.

4. **Verificación tras cambios**: ejecutar `npm run compile` y confirmar que no hay errores TypeScript antes de declarar la tarea como completada.

5. **Priorizar estabilidad**: ante la duda entre un cambio elegante y uno conservador, elegir siempre el más conservador que resuelva el problema.

### Prohibiciones sin autorización explícita

- No modificar prompts en `src/prompt/` (ni texto de sistema, ni instrucciones de campo)
- No modificar la plantilla `templates/readme.template.md` salvo que la tarea lo requiera explícitamente (cambios en tokens afectan al prompt del modelo, al JSON schema y al render)
- No modificar los JSON schemas en `promptBuilder.ts` o `fileSelectionPrompt.ts`
- No añadir parámetros al cliente Azure (temperatura, max_tokens, etc.)
- No cambiar los valores de token budget en `src/config.ts`
- No añadir límites de tokens al modelo nano — debe leer todo el proyecto sin presupuesto total
- No reintroducir un fallback heurístico de ranking ni recortar/truncar el contenido que se envía al nano — el nano es el único responsable del orden (ver §12)
- No modificar `PRE_SELECTION_MAX_BYTES_PER_FILE` ni `MAX_FILE_BYTES` sin autorización
- No añadir dependencias npm sin autorización
- No introducir ESLint, Prettier ni tests automatizados sin autorización
- No renombrar comandos VS Code (`readmeGeneratorAi.*`) — son contratos públicos
- No reintroducir un panel de preview separado (`previewPanel.ts` se eliminó; `EditFormPanel` ya cubre preview + edición, ver §9)
- No crear ficheros de documentación (`.md`) que no sean parte de la tarea encargada
- No añadir escaneo de contenido de **todos** los ficheros para detectar secrets — solo se redacta el contenido de los ficheros autodetectados o marcados por el usuario (ver §12)
- No reducir `redactSecrets()` a una allowlist fija de nombres de variable — su diseño combina, a propósito, redacción total en `.env`, heurística de nombre de clave en ficheros estructurados y un escáner de tokens de alta entropía

### Protocolo de verificación

Tras cualquier cambio de código:

```bash
npm run compile
```

Si hay errores TypeScript, corregirlos antes de entregar. No declarar una tarea como completada con errores de compilación.

### Convenciones de código (sin ESLint — mantener manualmente)

- **Clases**: PascalCase (`EditFormPanel`, `AzureResponsesClient`)
- **Funciones y métodos**: camelCase (`buildExtractionPrompt`, `analyzeReadmeData`)
- **Constantes**: UPPER_CASE (`FILL_PLACEHOLDER`, `IGNORE_DIRECTORIES`)
- **Interfaces**: PascalCase (`ReadmeData`, `ExtensionSettings`)
- **Async/await** para todas las operaciones I/O y llamadas API
- **Optional chaining** (`?.`) y nullish coalescing (`??`) preferidos sobre checks explícitos
- **No comentarios** salvo cuando el comportamiento no sea obvio

---

*Última actualización: junio 2026 — la plantilla `readme.template.md` es la FUENTE ÚNICA de la estructura de datos: el JSON schema, el ejemplo de salida, las instrucciones del modelo, los roles M/H y las secciones del panel se derivan de los tokens (`templateSpec.ts`). Eliminados `fieldInstructions.ts`, `fieldMetadata.ts`, `emptyReadmeData` y las subinterfaces de `ReadmeData` (ahora alias laxo). Los tokens de lista declaran su tipo (`list`/`csv`/`code`/`env`). Token: `[[ ruta | ROL(?) | tipo? | instrucción ]]`, renderer propio sin Nunjucks. Además: capa de seguridad reforzada: redactor agresivo `redactSecrets()` (3 pasadas), panel de seguridad en dos etapas (clasificar + verificar/editar) con exclusión de ficheros y fail-closed, autodetección de ficheros sensibles. Eliminado el fallback heurístico de ranking (el nano es el único decisor; los fallos se reportan con `describePreSelectionError()`). Umbral de tamaño unificado a 2 MB (`MAX_FILE_BYTES`). Eliminada la doble lectura de disco (el modelo principal reutiliza el contenido en memoria). Traza con sección de seguridad (`securitySummary`).*

*Limpieza posterior (junio 2026) — eliminadas las últimas trazas de la versión Jinja/Nunjucks: `nunjucks`/`@types/nunjucks` fuera de `package.json` y del lockfile (cero dependencias de producción), descripciones del paquete y del setting `templatePath` actualizadas al formato de tokens propio, borrada la versión mágica "v1.0.2" y la función muerta `withDescription` en `promptBuilder.ts`. Eliminado `src/ui/previewPanel.ts` (absorbido por `EditFormPanel`). Mejoras: el renderer cachea el texto de la plantilla por ruta (evita releer disco en cada keystroke del preview); las sub-instrucciones de los campos `env` (`.name`/`.description`) se derivan del tipo del campo en vez de un path hardcodeado; `initTemplateSpec` falla rápido si la plantilla no parsea ningún token.*
