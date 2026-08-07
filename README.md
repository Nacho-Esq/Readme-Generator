# README Generator AI

Extensión de VS Code en TypeScript para generar `README.generated.md` en español a partir de un repositorio local. Usa heurísticas baratas para seleccionar archivos relevantes, Azure OpenAI Responses API para extraer información estructurada y un renderer propio para aplicar la plantilla Markdown.

## Funcionalidad

- Comando `Generate README` desde la paleta de comandos.
- Botón `Generate README` en la barra de estado y en el título del Explorer.
- Ignora `node_modules`, `.git`, `dist`, `build`, `venv` y `coverage`.
- Prioriza `package.json`, `requirements.txt`, `pyproject.toml`, directorios de código y archivos relacionados con agentes, chatbots, prompts, tools, workflows, services, assistants y configuración.
- Limita agresivamente archivos, bytes por archivo y bytes totales enviados al modelo.
- Usa la plantilla `templates/readme.template.md`, un Markdown legible con 14 secciones (resumen, alcance, UX, arquitectura, conocimiento/prompts, seguridad, desarrollo local, despliegue, operación, documentación, roadmap y ownership). Cada campo lleva la instrucción para el modelo integrada en el mismo token, por lo que la plantilla sirve tanto de referencia humana como de fuente de prompts.
- Muestra preview del markdown generado.
- Muestra formulario editable antes de guardar, marcando los campos vacíos para completarlos manualmente.
- Guarda el resultado como `README.generated.md`.

## Configuración

**Credenciales (API key y endpoint).** No son ajustes de VS Code: se guardan en el almacén seguro del sistema (SecretStorage), no en `settings.json`. Configúralas desde la paleta de comandos:

- `CAI Readme-Generator: Configurar API key` — introduce tu API key de Azure OpenAI (campo oculto).
- `CAI Readme-Generator: Configurar endpoint` — por ejemplo `https://<recurso>.openai.azure.com` o la URL completa de la Responses API.
- `CAI Readme-Generator: Borrar credenciales guardadas` — elimina ambas del almacén seguro.

**Ajustes** (en la configuración de VS Code):

```json
{
  "readmeGeneratorAi.deployment": "<nombre-de-tu-deployment>",
  "readmeGeneratorAi.preSelectionDeployment": "<deployment-ligero-opcional>",
  "readmeGeneratorAi.templatePath": "C:\\\\ruta\\\\a\\\\readme.template.md"
}
```

`deployment` es el nombre del modelo principal en tu recurso de Azure OpenAI. `preSelectionDeployment` es opcional: si se deja vacío, se usa el mismo `deployment`. `templatePath` también es opcional; si está vacío, la extensión usa `templates/readme.template.md` incluido en el paquete. Si usas una plantilla personalizada, respeta el formato de tokens `[[ ruta | M/H/A | tipo? | instrucción ]]`.

## Desarrollo local

```bash
npm install
npm run compile
```

Para probar la extensión:

1. Abre este proyecto en VS Code.
2. Pulsa `F5` para iniciar Extension Development Host.
3. En la ventana nueva, abre el repositorio que quieras analizar.
4. Configura las credenciales con los comandos `Configurar API key` y `Configurar endpoint`, y el ajuste `readmeGeneratorAi.deployment`.
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
