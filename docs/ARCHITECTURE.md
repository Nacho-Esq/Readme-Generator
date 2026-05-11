# Arquitectura

La extensión está organizada por responsabilidades:

- `src/extension.ts`: orquesta el flujo de VS Code.
- `src/scanner/fileScanner.ts`: descubre archivos relevantes e impone límites de lectura.
- `src/scanner/fileRanker.ts`: ordena archivos por heurísticas baratas.
- `src/prompt/promptBuilder.ts`: construye el prompt y el JSON Schema de extracción.
- `src/azure/azureResponsesClient.ts`: integra Azure OpenAI Responses API.
- `src/template/templateRenderer.ts`: renderiza la plantilla Jinja/Nunjucks.
- `src/ui/previewPanel.ts`: muestra el preview del markdown.
- `src/ui/editFormPanel.ts`: permite editar campos antes de guardar.

El diseño evita enviar repositorios completos al LLM. Solo se mandan archivos preseleccionados, truncados y con límites configurables.
