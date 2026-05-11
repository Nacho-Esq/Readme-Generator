# README Generator AI

README Generator AI es una extensión de VS Code que crea documentación profesional para repositorios usando Azure OpenAI. Analiza el workspace abierto, extrae la información más relevante, renderiza el contenido con una plantilla Jinja/Nunjucks y permite revisar el resultado antes de guardarlo.

La extensión está pensada para proyectos de chatbots y agentes de IA, donde el contexto importante suele estar distribuido entre prompts, tools, servicios, archivos de configuración y código de orquestación. Su objetivo es convertir esa estructura en un `README.generated.md` claro y útil sin tener que redactar manualmente el primer borrador.

## Funcionalidades

- Genera un README estructurado a partir del workspace abierto.
- Usa análisis eficiente del repositorio y priorización ligera de archivos para seleccionar contenido relevante.
- Optimiza el uso de tokens mediante límites configurables de archivos seleccionados, bytes por archivo y bytes totales.
- Extrae información del proyecto con Azure OpenAI Responses API.
- Renderiza Markdown con una plantilla README incluida basada en Jinja/Nunjucks.
- Muestra una vista previa del README generado antes de guardarlo.
- Permite revisar y editar los campos extraídos mediante un formulario interactivo.
- Guarda el resultado final como `README.generated.md`.
- Permite usar una plantilla externa personalizada de forma opcional.

## Formas de iniciar la extensión

Puedes iniciar la generación del README de cualquiera de estas formas:

- Abre la Command Palette y ejecuta `README Generator AI: Generate README`.
- Usa el botón persistente `Generate README` en la barra de estado de VS Code cuando haya un workspace abierto.
- Haz clic derecho en el Explorer de VS Code y selecciona `Generate README`.
- Usa la acción `Generate README` disponible en la barra superior del Explorer.

## Configuración

Configura la extensión en los ajustes de VS Code antes de generar un README. La clave de API, el endpoint y el deployment de Azure OpenAI son obligatorios.

```json
{
  "readmeGeneratorAi.apiKey": "<AZURE_OPENAI_API_KEY>",
  "readmeGeneratorAi.endpoint": "https://<resource>.openai.azure.com",
  "readmeGeneratorAi.deployment": "<AZURE_OPENAI_DEPLOYMENT>",
  "readmeGeneratorAi.templatePath": "C:\\\\ruta\\\\a\\\\readme_template.md.jinja"
}
```

`readmeGeneratorAi.templatePath` es opcional. Si está vacío, la extensión usa la plantilla incluida en `templates/readme_plantilla.md.jinja`.

También hay ajustes adicionales para controlar el análisis del repositorio:

- `readmeGeneratorAi.maxFiles`: número máximo de archivos priorizados que se envían a Azure OpenAI.
- `readmeGeneratorAi.maxBytesPerFile`: número máximo de bytes leídos por cada archivo seleccionado.
- `readmeGeneratorAi.maxTotalBytes`: número máximo de bytes de código fuente enviados en conjunto a Azure OpenAI.

Por seguridad, guarda `readmeGeneratorAi.apiKey` en ajustes de usuario o de máquina y evita confirmar en Git ajustes de workspace que contengan secretos.

## Flujo de uso

1. Abre en VS Code el repositorio que quieres documentar.
2. Inicia README Generator AI desde la Command Palette, la barra de estado, el menú contextual del Explorer o la acción superior del Explorer.
3. Deja que la extensión analice y priorice los archivos relevantes del workspace.
4. Revisa y edita los campos extraídos del proyecto en el formulario.
5. Previsualiza el Markdown generado.
6. Guarda el README final como `README.generated.md`.

## Desarrollo local

Instala las dependencias y compila la extensión:

```bash
npm install
npm run compile
```

Para probar la extensión localmente:

1. Abre este proyecto en VS Code.
2. Pulsa `F5` para iniciar una ventana de Extension Development Host.
3. En la ventana de desarrollo, abre el repositorio que quieres analizar.
4. Configura `readmeGeneratorAi.apiKey`, `readmeGeneratorAi.endpoint` y `readmeGeneratorAi.deployment`.
5. Ejecuta `Generate README`.

## Empaquetado

Genera el paquete VSIX con:

```bash
npm run compile
npm run package
```

`npm run package` usa `vsce package` y crea un archivo `.vsix` que se puede instalar en VS Code.

## Publicación

Antes de publicar, revisa `publisher`, `version`, `displayName`, el icono y los metadatos de Marketplace en `package.json`.

1. Crea o selecciona un publisher en Visual Studio Marketplace.
2. Genera un Personal Access Token en Azure DevOps con permisos de Marketplace.
3. Inicia sesión con VSCE:

```bash
npx vsce login <publisher>
```

4. Publica la extensión:

```bash
npm run publish
```
