# README Generator AI

Extensión de VS Code en TypeScript para generar `README.generated.md` en español a partir de un repositorio local. Usa heurísticas baratas para seleccionar archivos relevantes, Azure OpenAI Responses API para extraer información estructurada y Nunjucks para renderizar una plantilla Jinja markdown.

## Funcionalidad

- Comando `Generate README` desde la paleta de comandos.
- Botón `Generate README` en la barra de estado y en el título del Explorer.
- Ignora `node_modules`, `.git`, `dist`, `build`, `venv` y `coverage`.
- Prioriza `package.json`, `requirements.txt`, `pyproject.toml`, directorios de código y archivos relacionados con agentes, chatbots, prompts, tools, workflows, services, assistants y configuración.
- Limita agresivamente archivos, bytes por archivo y bytes totales enviados al modelo.
- Renderiza con Nunjucks manteniendo lógica Jinja compatible: bucles, condicionales y filtros.
- Usa la plantilla README v1.0.2, con secciones de resumen, alcance, UX, arquitectura, conocimiento/prompts, seguridad, desarrollo local, despliegue, operación, documentación, roadmap y ownership.
- Muestra preview del markdown generado.
- Muestra formulario editable antes de guardar, marcando los campos vacíos para completarlos manualmente.
- Guarda el resultado como `README.generated.md`.

## Configuración

Configura estos ajustes en VS Code:

```json
{
  "readmeGeneratorAi.apiKey": "<AZURE_OPENAI_API_KEY>",
  "readmeGeneratorAi.endpoint": "https://<resource>.openai.azure.com",
  "readmeGeneratorAi.deployment": "test-plantillas-gpt-5.2-codex",
  "readmeGeneratorAi.templatePath": "C:\\\\ruta\\\\a\\\\readme_plantilla.md.jinja"
}
```

`templatePath` es opcional. Si está vacío, la extensión usa `templates/readme_plantilla.md.jinja` incluido en el paquete.

## Desarrollo local

```bash
npm install
npm run compile
```

Para probar la extensión:

1. Abre este proyecto en VS Code.
2. Pulsa `F5` para iniciar Extension Development Host.
3. En la ventana nueva, abre el repositorio que quieras analizar.
4. Configura `readmeGeneratorAi.apiKey`, `readmeGeneratorAi.endpoint` y `readmeGeneratorAi.deployment`.
5. Ejecuta `Generate README`.

## Empaquetado

Instala dependencias y genera el VSIX:

```bash
npm install
npm run compile
npm run package
```

El comando `npm run package` usa `vsce package` y genera un archivo `.vsix`.

## Publicación en VS Code Marketplace

1. Crea un publisher en Visual Studio Marketplace.
2. Genera un Personal Access Token en Azure DevOps con permisos de Marketplace.
3. Inicia sesión:

```bash
npx vsce login <publisher>
```

4. Publica:

```bash
npm run publish
```

Antes de publicar, actualiza `publisher`, `version`, `displayName`, icono y metadatos en `package.json`.
