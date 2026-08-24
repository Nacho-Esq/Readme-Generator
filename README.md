# CAI Readme-Generator

Genera y mantiene el **README** de tus proyectos en español, a partir del propio código, usando Azure OpenAI. Analiza el repositorio, extrae la información en una plantilla y te deja revisarlo antes de guardar.

- **Generar** un `README.generated.md` desde cero.
- **Actualizar** un README existente sin regenerarlo: solo cambia lo que el código contradice, respetando lo que escribiste a mano.
- **Panel de revisión** para completar o corregir campos antes de guardar.
- **Protección de datos sensibles**: detecta `.env`, claves y credenciales y te deja excluirlos o codificarlos **antes** de enviar nada al modelo.

> Necesitas un recurso de **Azure OpenAI** propio (endpoint + API key + al menos un modelo desplegado). La extensión no incluye credenciales, cada usuario configura las suyas.

---

## 🚀 Puesta en marcha (primeros pasos)

Sigue estos pasos una sola vez. Los comandos se abren con la **paleta de comandos** (`Ctrl+Shift+P` / `Cmd+Shift+P`).

### Requisitos previos
- Un recurso de **Azure OpenAI** con **al menos un deployment** de un modelo que soporte la **Responses API** con *structured outputs* (JSON schema).
- El **endpoint** del recurso y una **API key** válida.

### Paso 1 — Configura el endpoint
Paleta de comandos → **`CAI Readme-Generator: Configurar endpoint`** → pega la URL de tu recurso, por ejemplo:

```
https://mi-recurso.openai.azure.com
```

(También admite la URL completa de la Responses API si la tienes.)

### Paso 2 — Configura la API key
Paleta de comandos → **`CAI Readme-Generator: Configurar API key`** → pega tu clave. El campo es oculto y la clave se guarda en el **almacén seguro del sistema** (SecretStorage), nunca en `settings.json` ni en el repositorio.

### Paso 3 — Elige los modelos y la profundidad de lectura
Abre los **Ajustes** de VS Code (`Ctrl+,`), ve a la pestaña de Extensiones y busca **`CAI Readme-Generator`**. Ahí aparece todo lo configurable:

- **`readmeGeneratorAi.deployment`** (obligatorio): el nombre **exacto** de tu deployment del **modelo principal** (el que extrae la información).
- **`readmeGeneratorAi.preSelectionDeployment`** (opcional): el deployment de un **modelo ligero** que lee todo el repo y ordena los ficheros por importancia. Si lo dejas vacío, se usa el mismo que el principal.

**Recomendación de modelos** (la herramienta usa dos roles distintos a propósito):

| Rol | Para qué | Qué elegir |
|-----|----------|------------|
| **Principal** (`deployment`) | Extrae la información y redacta cada campo | El modelo **más capaz** que tengas con *structured outputs* en la Responses API (un modelo de razonamiento/código potente). La calidad del README depende sobre todo de este. |
| **Ligero** (`preSelectionDeployment`) | Lee **todo** el repositorio y prioriza ficheros | Un modelo **pequeño y barato con ventana de contexto grande** (tipo *mini* / *nano*). Lee mucho, así que interesa que sea económico. |

> Consejo: configurar un modelo ligero aparte abarata bastante cada ejecución, porque el trabajo de "leer todo el repo" no lo hace el modelo caro. Si no configuras uno, todo lo hace el principal.

En ese mismo menú tienes la **profundidad de lectura** (`readmeGeneratorAi.readDepth`), que controla **cuánto lee** el modelo principal: `básico` (≈30k tokens, el más económico), `detallado` (≈90k), `profundo` (≈180k) o `personalizado`. Más profundidad = más contexto y mejor README, pero más coste. Para empezar, `básico` es una buena opción.

### Paso 4 — Genera tu primer README
Abre en VS Code el proyecto que quieras documentar. Puedes lanzar la generación de **tres formas**:

- **Botón de la barra de estado** (la barra inferior de VS Code): pulsa **`Generate README`**.
- **Paleta de comandos** (`Ctrl+Shift+P`): ejecuta **`CAI Readme-Generator: Generate README`**.
- **Clic derecho en el explorador de archivos**: sobre una carpeta del árbol → **`Generate README`**. Es la mejor opción cuando tienes **varias carpetas abiertas** y quieres el README **de una carpeta concreta**.

A continuación aparecen uno o varios paneles (ver el apartado **«Qué ocurre cuando generas»** más abajo). Al terminar, revisas y guardas: se crea `README.generated.md`.

### Paso 5 — Actualizar un README (para más adelante)
Cuando el proyecto evolucione, no hace falta regenerar desde cero: usa **`CAI Readme-Generator: Update README`** (comando, botón de la barra de estado o clic derecho en una carpeta). El actualizador está pensado para READMEs **generados con esta herramienta**: compara lo que dice el README con el código actual y te propone, **campo a campo, solo lo que ha cambiado**, conservando tu estructura y lo que hayas escrito a mano. En cada propuesta decides **Aceptar / Mantener / Editar**.

---

## 🔎 Qué ocurre cuando generas

Al lanzar **Generate README** verás, en orden, hasta **tres paneles**:

### 1. Protección de datos sensibles (siempre)
Aparece **antes de enviar nada** al modelo, en dos etapas:
- **Clasificar**: marcas cada fichero como **Enviar**, **Codificar** (oculta sus valores) o **No enviar**. Los ficheros sensibles (`.env`, claves, credenciales) vienen ya premarcados; el resto salen agrupados por carpeta.
- **Verificar**: se te muestran los ficheros ya **codificados**, editables a mano, por si quieres ajustar algo o excluir alguno. **Nada sale hasta que pulsas Confirmar**; si cierras la ventana, se cancela toda la operación.

### 2. Archivos fuera de presupuesto (solo si hace falta)
Si el modelo ligero encuentra **más ficheros relevantes de los que caben** en tu profundidad de lectura, verás la lista de los que se quedan fuera, ordenados por importancia y con su coste estimado en tokens. Puedes **marcar los que quieras incluir** (aunque suban el coste) o **continuar** sin ellos. Si todo cabe, este panel no aparece.

### 3. Revisión final (siempre)
Con el README ya extraído:
- **Izquierda**: los campos. Los que el modelo rellenó pero conviene comprobar aparecen marcados para **revisar**; los vacíos, como **pendientes** de completar. Cada campo se puede editar, confirmar o descartar.
- **Derecha**: previsualización del Markdown **en vivo**, que se actualiza mientras editas.

Al pulsar **Guardar**, se crea `README.generated.md` en la carpeta. Puedes consultar el coste real de la ejecución con el comando **`Open Last Trace`**.

> Al **actualizar** (Paso 5), el panel final es distinto: una **tarjeta por cambio propuesto** donde eliges Aceptar / Mantener / Editar, en lugar del formulario completo.

---

## Ajustes disponibles

| Ajuste | Descripción |
|--------|-------------|
| `readmeGeneratorAi.deployment` | Deployment del **modelo principal** (obligatorio). |
| `readmeGeneratorAi.preSelectionDeployment` | Deployment del **modelo ligero**. Vacío = usa el principal. |
| `readmeGeneratorAi.readDepth` | Profundidad de lectura del modelo principal: `básico` / `detallado` / `profundo` / `personalizado`. |
| `readmeGeneratorAi.readDepthCustomBudget` | Tokens a medida cuando `readDepth = personalizado`. |
| `readmeGeneratorAi.templatePath` | Ruta a una plantilla propia (opcional). Vacío = plantilla incluida. Formato de token: `[[ ruta \| M/H/A \| tipo? \| instrucción ]]`. |

El **endpoint** y la **API key** no son ajustes: se configuran con los comandos del Paso 1 y 2 y viven en el almacén seguro.

---

## Privacidad

- Las credenciales se guardan en el **almacén seguro del sistema** (SecretStorage); no se sincronizan, no se exportan y no se empaquetan.
- **Nada** se envía al modelo hasta que pasas el panel de seguridad; si lo cierras, no sale nada.
- Tus ficheros en disco **nunca se modifican**: la codificación se aplica solo sobre una copia en memoria.

---

## Comandos

| Comando | Acción |
|---------|--------|
| `CAI Readme-Generator: Generate README` | Genera un README desde cero. |
| `CAI Readme-Generator: Update README` | Actualiza un README existente comparándolo con el código. |
| `CAI Readme-Generator: Configurar endpoint` | Guarda el endpoint de Azure OpenAI. |
| `CAI Readme-Generator: Configurar API key` | Guarda la API key (almacén seguro). |
| `CAI Readme-Generator: Borrar credenciales guardadas` | Elimina endpoint y API key del almacén seguro. |
| `CAI Readme-Generator: Open Last Trace` | Abre la traza de la última ejecución (diagnóstico y coste). |
| `CAI Readme-Generator: Open Generated Data` | Abre los datos que la extensión guarda para este proyecto. |

---

## Para desarrolladores

```bash
npm install
npm run compile   # compila a dist/
npm test          # ejecuta la suite de tests (Vitest)
npm run package   # genera el .vsix
```

Pulsa `F5` en VS Code para abrir un *Extension Development Host* y probar la extensión sobre otro repositorio.
