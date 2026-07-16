# [[ project_name | M | Nombre real del proyecto detectado en package.json, documentación, configuración o carpeta raíz. ]]

[[ screenshot_path | H | image | Pantallazo de la interfaz del proyecto, especialmente en el caso de chatbots ]]

---

<!--section:resumen-->
## 1. Resumen
<!--context: Presenta el proyecto a alto nivel para quien llega por primera vez al repositorio: qué es, para qué sirve, qué problema resuelve y en qué estado está. Prioriza una descripción clara y comprensible, sin profundizar en la implementación. Rellena estos campos solo con lo que puedas afirmar con evidencia; no inventes información. -->

- **Qué es**: [[ summary.what_is | M | Resumen claro (2-4 frases) de qué hace el proyecto, cuáles son sus objetivos y qué problema resuelve.]]
- **Tipo**: [[ summary.project_type | M | Clasifica el proyecto en una o más categorías, según evidencia objetiva (entry point, manifest, dependencias, forma de despliegue). Indica aquellas que coincidan: "chatbot" (interfaz conversacional que responde mensajes turno a turno; NO planifica ni ejecuta acciones externas por sí mismo); "agente IA" (además de conversar, planifica y ejecuta acciones de forma autónoma llamando herramientas/funciones/APIs para completar tareas); "extensión/plugin" (se instala dentro de una aplicación anfitriona y depende de su runtime); "API/servicio backend" (expone endpoints REST/GraphQL/gRPC/webhooks consumidos por otros programas, sin interfaz de usuario propia); "aplicación frontend/web" (interfaz visual consumida directamente por personas en navegador u otro cliente gráfico); "librería/SDK" (paquete pensado para ser importado por otro código, no se ejecuta de forma independiente); "CLI" (herramienta invocada por línea de comandos); "servicio interno/batch" (proceso automatizado sin interacción directa de usuario final, p. ej. cron, workers, pipelines de datos); u "otro: <breve descripción>" solo si ninguna categoría anterior encaja. Si el proyecto combina varias capas, explícalo y menciona todas, recalcando cuál es con la que interactúa el usuario final]]
- **Estado**: [[ summary.status | H | Estado del proyecto: prototipo, desarrollo, producción, mantenimiento, archivado u otro. ]]

---
<!--/section-->

<!--section:alcance-->
## 2. Alcance y limitaciones
<!--context: Delimita las fronteras del proyecto para gestionar expectativas y evitar usos indebidos. Distingue entre lo que el proyecto sí hace, lo que deliberadamente deja fuera y sus limitaciones técnicas conocidas. Rellena estos campos solo con evidencias reales del repositorio; no inventes información. -->

- **Qué incluye**: [[ scope.includes | M | list | Capacidades, módulos, responsabilidades o funcionalidades cubiertas por el proyecto. ]]
- **Qué no incluye**: [[ scope.excludes | H | list | Exclusiones explícitas, responsabilidades fuera de alcance o límites funcionales. ]]
- **Limitaciones conocidas**: [[ scope.known_limitations | H | list | Restricciones técnicas, funcionales, dependencias o limitaciones conocidas que afecten al uso. ]]

---
<!--/section-->

<!--section:experiencia-usuario-->
## 3. Experiencia de usuario
<!--context: Describe la solución desde el punto de vista de quien la usa, no desde la implementación: quién es el usuario final, por qué canales y en qué idiomas accede, cómo empieza la interacción y qué ocurre cuando algo falla. Rellena estos campos con la perspectiva de la experiencia de uso y solo con evidencia real; no inventes información. -->

- **Usuarios objetivo**: [[ summary.target_users | H | csv | Perfiles finales que usarán la solución, y en qué contexto lo harán. ]]
- **Canales**: [[ usage.channels | A | csv | Interfaces o canales por los que se accede al proyecto (ej. web, Teams/Slack, API HTTP, extensión de IDE, CLI, backend interno).]]
- **Idiomas**: [[ usage.languages | A | csv | Idiomas soportados. ]]
- **Cómo se inicia**: [[ ux.start_flow | M | Cómo empieza la interacción para quien usa el proyecto: primer mensaje de chat, primer comando, apertura de la extensión, primera petición a la API, etc., según el tipo de interfaz. ]]
- **Errores y fallback**: [[ ux.fallback_error_handling | M | Cómo responde ante errores, excepciones, entradas inválidas o casos no cubiertos. Posibles errores desde el punto de vista del usuario.]]

---
<!--/section-->

<!--section:arquitectura-->
## 4. Arquitectura
<!--context: Describe la estructura técnica interna del sistema y cómo fluyen los datos, para que una persona desarrolladora entienda sus piezas reales, responsabilidades y dependencias externas. Básate en los componentes reales detectados en el repositorio, no en ejemplos genéricos ni en información inventada. -->

- **Diagrama lógico**: [[ architecture.logical_flow | M | raw | Genera un diagrama Mermaid que represente la arquitectura real del proyecto: quién lo invoca, la interfaz de entrada, los componentes internos y los servicios externos, con la dirección principal de los datos (entrada -> procesamiento -> salida). Muestra las partes PRINCIPALES que sepas identificar en el repositorio, agrupándolas con subgraphs si ayuda; incluye toda la arquitectura relevante pero deja fuera lo trivial y no busques un diagrama enorme: prioriza claridad sobre exhaustividad. Usa los nombres reales del código o la documentación, no ejemplos genéricos. Debajo, una línea breve de leyenda con el objetivo del diagrama. Si no puedes generarlo, deja una alternativa textual de máximo 3 líneas. ]]
- **Componentes principales**: [[ architecture.components | M | list | Componentes clave del sistema y responsabilidad principal de cada uno. ]]
- **Dependencias externas**: [[ architecture.external_dependencies | M | list | Servicios, APIs, bases de datos, modelos, colas, buscadores o integraciones externas. ]]

---
<!--/section-->

<!--section:diagramas-secuencia-->
## 5. Diagramas de secuencia
<!--context: Sección OPCIONAL con diagramas de secuencia en Mermaid para los flujos cuyo valor está en el ORDEN y la colaboración entre varios actores a lo largo del tiempo y que NO se entienden con solo leer el código o el resto del README. Tiene alto coste de lectura: genera entre 0 y 3 diagramas, solo los que de verdad ayuden; nada de flujos triviales u obvios (un getter, un CRUD directo, "el controlador llama al servicio y devuelve"). Si ninguno lo merece, deja el campo vacío y la sección se omitirá. Buenos candidatos: pasos no evidentes con varios actores, orden que importa, asincronía, reintentos o fallback, handshakes de autenticación y orquestación entre servicios o dependencias externas (por ejemplo, en un sistema LLM el pipeline RAG recuperación -> prompt -> modelo -> post-proceso, o en un agente el bucle de llamada a herramientas con las idas y vueltas al modelo). Usa siempre participantes y mensajes REALES del repositorio; no inventes actores ni llamadas sin evidencia en el código. -->

[[ sequence_diagrams | A | raw | Genera un diagrama de secuencia Mermaid por cada flujo que hayas decidido incluir (el criterio de cuáles está en el contexto de la sección). Para cada uno: un subtítulo de nivel 3 con un título corto del flujo, el diagrama de secuencia, y debajo una única línea de leyenda que explique qué demuestra. Usa participantes y mensajes con los nombres reales del repositorio. Ejemplo del nivel y enfoque buscados, el login de una API: el Cliente hace POST /login al AuthController, este valida en el AuthService, que consulta la base de datos y recibe el usuario, emite el token JWT y el controlador responde 200 con el token; leyenda: "Muestra el orden real de validación y emisión del token entre controlador, servicio y base de datos.". Para otros tipos de proyecto, adapta los participantes y mensajes a los componentes reales. Separa cada diagrama con una línea en blanco y no añadas texto fuera de los subtítulos, los diagramas y sus leyendas. ]]

---
<!--/section-->

<!--section:conocimiento-->
## 6. Conocimiento y prompts
<!--context: Documenta el componente de IA del proyecto: qué modelos usa, de qué fuentes de conocimiento se nutre, cómo recupera información y cómo se controla su comportamiento. Aplica solo a chatbots, agentes o sistemas basados en LLM/RAG; si no hay evidencia de un componente de IA, deja los campos vacíos. No inventes información. -->

- **Modelos de IA**: [[ knowledge_prompts.models | M | list | Modelo o modelos de lenguaje que utiliza el proyecto: proveedor y nombre (p. ej. OpenAI GPT-4o, Anthropic Claude), y parámetros clave como temperatura o máximo de tokens si están configurados. ]]
- **Fuentes**: [[ knowledge_prompts.sources | M | list | Fuentes de conocimiento que usa el modelo: documentos, índices, APIs, bases de datos, ficheros o repositorios. ]]
- **Recuperación (RAG)**: [[ knowledge_prompts.rag_summary | M | Uso de RAG, embeddings, búsqueda semántica o recuperación documental. ]]
- **Herramientas del agente**: [[ knowledge_prompts.agent_tools | M | list | Herramientas, funciones o acciones que el agente puede invocar para completar tareas, con una breve descripción de cada una. Aplica solo si el proyecto es un agente que ejecuta acciones. ]]
- **Prompts/guardrails**: [[ knowledge_prompts.prompt_guardrails_location | M | Dónde están los prompts, instrucciones de agente, políticas o guardrails en el repositorio. ]]
- **Contenido no permitido**: [[ knowledge_prompts.forbidden_content_handling | M | Cómo se gestionan restricciones, moderación o respuestas no permitidas. ]]

---
<!--/section-->

<!--section:desarrollo-local-->
## 7. Desarrollo local
<!--context: Explica cómo ejecutar el proyecto en una máquina local partiendo de cero: requisitos, configuración, datos necesarios, comandos y forma de comprobar que funciona. Usa pasos concretos y reproducibles extraídos de scripts, manifests y documentación reales; no inventes información. -->

- **Requisitos**: [[ local_development.requirements | M | raw | Enumera los requisitos previos que hay que tener instalados para desarrollar el proyecto en local (runtimes como Python/Node/Java, gestores de paquetes, Docker, bases de datos locales, CLIs u otras herramientas del sistema), con su versión exacta cuando conste en el repositorio. Para CADA requisito no te limites a nombrarlo: explica también cómo instalarlo. Formato por requisito: una línea en negrita con el nombre y la versión (p. ej. "**Python 3.11**"), seguida de un bloque fenced de código con el/los comando(s) de instalación reales para esa versión y, si ayuda, una nota breve (p. ej. cómo verificar con "--version"). Si el repositorio evidencia un gestor de versiones (pyenv, nvm, asdf, volta), usa sus comandos; si no, usa el método de instalación oficial más común. Cuando la instalación difiera claramente según el sistema operativo, prioriza el del SO que use el proyecto (según Dockerfile o scripts) y menciona brevemente las alternativas, sin construir una tabla exhaustiva por SO. Incluye solo requisitos con evidencia real; no inventes versiones ni herramientas. No cubras aquí la instalación de las dependencias del propio proyecto (p. ej. npm install o pip install -r), que va en "Ejecutar". ]]
- **Variables de entorno**: [[ local_development.env_variables | M | env | Variables de entorno detectadas en .env.example, config o código, y finalidad de cada una. ]]
- **Recursos/datos**: [[ local_development.resources | M | list | Datos, ficheros, índices o credenciales de prueba que hay que aportar para ejecutar el proyecto en local. ]]
- **Ejecutar**: [[ local_development.install_run_commands | M | raw | Da los comandos para poner el proyecto en marcha en local y en orden: instalar las dependencias del proyecto, arrancarlo y, si aplica, cómo invocarlo o usarlo; tómalos de scripts, manifests o documentación reales. Como en Requisitos pero más escueto: cada paso como un bloque fenced de comandos con una nota breve de qué hace. No repitas aquí la instalación del toolchain, que ya va en Requisitos. ]]
- **Validación rápida**: [[ local_development.validation_checks | M | list | Comprobación rápida de que, recién arrancado, el proyecto está VIVO y bien desplegado (NO de que su lógica sea correcta: eso va en Pruebas). Da el paso concreto según el tipo de proyecto, con comandos o URLs reales del repo: API/servicio -> llamada al health-check o a un endpoint y respuesta/código esperado; web o frontend -> URL local que debe cargar; CLI -> "--version"/"--help"; worker/batch -> log o señal de arranque correcto; librería/SDK -> import de prueba que no falle. ]]
- **Pruebas**: [[ local_development.testing_strategy | M | Cómo comprobar que el proyecto funciona CORRECTAMENTE, es decir su comportamiento y lógica (a diferencia de Validación rápida, que solo confirma que arranca): indica el framework y el/los comando(s) para ejecutar la suite de pruebas (unitarias, integración, e2e) documentados en el repo. Si no hay pruebas automatizadas, explica cómo verificar a mano el comportamiento principal esperado. Aplica a cualquier tipo de proyecto. ]]

---
<!--/section-->

<!--section:seguridad-->
## 8. Seguridad, privacidad y cumplimiento
<!--context: Documenta el tratamiento seguro de los datos y el cumplimiento: qué datos maneja el proyecto, cómo se almacenan y protegen, quién puede acceder y qué obligaciones normativas aplican. Afirmar algo incorrecto aquí es especialmente delicado: rellena solo con evidencias claras y, ante la duda, deja el campo vacío. No inventes información. -->

- **Datos tratados**: [[ security_privacy.processed_data | M | list | Tipos de datos procesados, especialmente datos personales, sensibles o corporativos. ]]
- **Retención/almacenamiento**: [[ security_privacy.retention_storage | M | Si los datos se almacenan, dónde y durante cuánto tiempo. ]]
- **Acceso**: [[ security_privacy.access_auth | M | Autenticación, autorización, roles o controles de acceso detectados. ]]
- **Anonimización y secretos**: [[ security_privacy.anonymization_secrets | M | Masking, anonimización, gestión de secretos o protección de credenciales. ]]
- **Cumplimiento**: [[ security_privacy.compliance_notes | H | Notas de cumplimiento, privacidad o normativa mencionadas en el proyecto. ]]

---
<!--/section-->

<!--section:despliegue-->
## 9. Despliegue
<!--context: Describe cómo se lleva el proyecto a entornos reales de ejecución: requisitos previos, entornos existentes, proceso de despliegue y diferencias entre entornos. Básate en pipelines, contenedores, IaC, scripts y documentación de despliegue reales; no inventes información. -->

- **Requisitos previos**: [[ deployment.prerequisites | M | list | Cuentas, planes o servicios de terceros que hay que contratar o provisionar y claves de API que hay que obtener y aportar para poner el proyecto en marcha (p. ej. clave de proveedor LLM). ]]
- **Entornos**: [[ deployment.environments | M | list | Entornos detectados: local, desarrollo, preproducción, producción, cloud u otros. ]]
- **Proceso**: [[ deployment.process | M | Cómo se despliega según pipelines, Docker, IaC, scripts o documentación. ]]
- **Diferencias por entorno**: [[ deployment.environment_differences | M | Diferencias de configuración, recursos o comportamiento entre entornos. ]]

---
<!--/section-->

<!--section:operacion-->
## 10. Operación y observabilidad
<!--context: Describe cómo se opera y monitoriza el proyecto una vez en marcha, para el equipo que lo mantiene: dónde consultar logs y métricas, qué señales vigilar, cómo se alerta y cómo se gestionan las incidencias. Prioriza las señales relevantes para este tipo de proyecto y rellena solo con evidencia real; no inventes información. -->

- **Telemetría**: [[ operations.telemetry | M | Dónde consultar y cómo se generan los logs, trazas y métricas del proyecto (librerías de logging, instrumentación de trazas, exporters de métricas o herramientas de monitorización). ]]
- **Señales clave**: [[ operations.key_signals | M | list | Métricas clave a vigilar según el tipo de proyecto (ej. error rate y latencia para APIs; tokens/coste y ratio de fallback para sistemas basados en LLM; ratio de escalado a humano para agentes; throughput para pipelines batch). Incluye solo las relevantes para este proyecto. ]]
- **Alertas/runbooks** (si aplica): [[ operations.alerts_runbooks | M | Alertas, runbooks o procedimientos operativos detectados. ]]
- **Incidencias**: [[ operations.incident_process | M | Cómo se gestionan incidencias o soporte operativo. ]]

---
<!--/section-->

<!--section:documentacion-->
## 11. Documentación y enlaces
<!--context: Reúne los recursos externos y la documentación adicional del proyecto (manuales, repositorios, pipelines, dashboards y otros enlaces útiles) como índice de navegación. Usa solo referencias reales encontradas en el repositorio; no inventes enlaces ni información. -->

- **Documentación**: [[ documentation_links.manuals_docs | M | list | Manuales, documentación técnica, guías o archivos relevantes del repositorio. ]]
- **Repositorios y CI/CD**: [[ documentation_links.repos_pipelines | H | list | Repositorios, pipelines, workflows o recursos de CI/CD del proyecto. ]]
- **Enlaces y recursos**: [[ documentation_links.links_resources | H | list | Enlaces externos útiles: tickets y tableros de gestión, dashboards, paneles de monitorización u otros recursos. ]]

---
<!--/section-->

<!--section:mejoras-->
## 12. Roadmap / mejoras
<!--context: Sección sobre la evolución futura prevista del proyecto. Su objetivo es recoger mejoras planificadas, trabajo pendiente o elementos de roadmap. Rellena este campo solo con planes de futuro explícitos hallados en el repositorio (TODOs, issues, notas de roadmap); no propongas mejoras inventadas. -->

[[ roadmap | H | list | Mejoras futuras o elementos de roadmap.]]

---
<!--/section-->

<!--section:contactos-->
## 13. Contactos y ownership
<!--context: Sección que identifica a las personas y equipos responsables del proyecto. Su objetivo es saber a quién acudir para dudas, decisiones o incidencias. Rellena estos campos solo con nombres, equipos o contactos que aparezcan explícitamente en el repositorio; si no hay evidencia clara, déjalos vacíos para que los complete el usuario. -->

- **Product owner**: [[ contacts.product_owner | H | Product owner. ]]
- **Responsable técnico**: [[ contacts.technical_owner | H | Responsable técnico.  ]]
- **Equipo responsable**: [[ contacts.responsible_team | H | Equipo propietario o responsable. ]]

---
<!--/section-->

<!--section:proyectos-relacionados-->
## 14. Proyectos relacionados
<!--context: Sección que enlaza este proyecto con otros del ecosistema. Su objetivo es dar contexto sobre dependencias, proyectos hermanos o repositorios relacionados. Rellena este campo solo con proyectos realmente vinculados y mencionados en el repositorio. -->

[[ related_projects | H | list | Proyectos relacionados. ]]

---
<!--/section-->
