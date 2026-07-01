<!--
  PLANTILLA DEL README
  Cada hueco de dato es un token con este formato:

      [[ ruta.del.campo | ROL | tipo? | instrucción ]]

  · ruta.del.campo : a qué dato corresponde (coincide con el JSON del modelo).
  · ROL            : M  = lo busca/rellena el MODELO a partir del repositorio.
                     H  = lo rellena el HUMANO (el modelo NO lo busca).
                     Añade "?" (M? / H?) si el campo es OMITIBLE cuando no hay datos.
  · tipo           : determina el TIPO de dato y cómo se renderiza.
                     SIN tipo            -> texto (string), en línea.
                     Tipos de LISTA (string[]):
                       list  -> viñetas
                       csv   -> lista unida por comas
                       code  -> comandos en `backticks`
                     Otros:
                       env   -> variables de entorno (nombre + descripción)
                       raw   -> texto en crudo (p. ej. bloque Mermaid)
                       image -> imagen ![titulo](ruta)
                     IMPORTANTE: un campo que sea una lista DEBE declarar su tipo
                     (list/csv/code/env). Sin tipo, el modelo lo trata como texto.
  · instrucción    : sirve A LA VEZ como prompt para el modelo y como guía para
                     el humano. Es lo que se lee aquí; NO aparece en el README final.

  El LABEL de cada campo en el panel de edición se toma del texto en **negrita**
  que precede al token en su línea (p. ej. "- **Qué es**:"); para tokens sin
  negrita se usa el título de su sección.

  Todo lo que NO es un token (títulos, etiquetas, separadores, prosa) se escribe
  tal cual en el README. La estructura del JSON que devuelve el modelo se deriva
  de las rutas de los tokens (p. ej. summary.what_is). Las secciones envueltas en
  <!--section:CLAVE--> ... <!--/section--> se omiten enteras si no hay datos.
-->

# [[ project_name | M | Nombre real del proyecto detectado en package.json, documentación, configuración o carpeta raíz. ]]

[[ screenshot_path | H | image | Ruta de imagen o GIF representativo del proyecto. Déjalo vacío si no hay evidencia clara. ]]

---

## 1. Resumen

- **Qué es**: [[ summary.what_is | M | Resumen claro de qué hace el proyecto y qué problema resuelve. ]]
- **Tipo**: [[ summary.project_type | M | Tipo de proyecto: extensión VS Code, API, chatbot, agente, backend, frontend, librería, CLI, servicio interno u otro. ]]
- **Propósito**: [[ summary.purpose | M | Objetivo principal del proyecto y valor que aporta. ]]
- **Usuarios**: [[ summary.target_users | M | csv | Perfiles que usarán la solución. ]]
- **Estado**: [[ summary.status | H | Estado del proyecto si hay evidencia: prototipo, desarrollo, producción, mantenimiento, archivado u otro. ]]
- **Objetivo y éxito**: [[ summary.success_criteria | M? | Criterio de éxito u objetivo medible del proyecto, solo si hay evidencia. ]]

---

## 2. Alcance y limitaciones

- **Qué incluye**: [[ scope.includes | M | list | Capacidades, módulos, responsabilidades o funcionalidades cubiertas por el proyecto. ]]
- **Qué no incluye**: [[ scope.excludes | H | list | Exclusiones explícitas, responsabilidades fuera de alcance o límites funcionales. ]]
- **Limitaciones conocidas**: [[ scope.known_limitations | H | list | Restricciones técnicas, funcionales, dependencias o limitaciones conocidas que afecten al uso. ]]

---

## 3. Usuarios y uso previsto

- **Usuarios objetivo**: [[ summary.target_users | M | csv | Perfiles que usarán la solución. ]]
- **Canales**: [[ usage.channels | M | csv | Canales de uso detectados: web, Teams, API, VS Code, backend interno, CLI u otros. ]]
- **Idiomas**: [[ usage.languages | M? | csv | Idiomas soportados. Incluye solo los que aparezcan en código, configuración o documentación. ]]
- **Contexto de uso**: [[ usage.contexts | H | list | Escenarios reales en los que se espera usar la solución. ]]

---

## 4. Experiencia de usuario

- **Cómo se inicia**: [[ ux.start_flow | M | Cómo empieza la interacción o ejecución desde la perspectiva del usuario. ]]
- **Qué preguntas se esperan**: [[ ux.expected_questions | M | list | Ejemplos de preguntas, tareas, intents o solicitudes que la solución debería atender. ]]
- **Adjuntos** (si aplica): [[ ux.attachments_support | M? | Si acepta archivos, imágenes u otros adjuntos, y cómo los usa. ]]
- **Errores y fallback**: [[ ux.fallback_error_handling | M | Cómo responde ante errores, baja confianza, excepciones o casos no cubiertos. ]]
- **Handoff a humano**: [[ ux.human_handoff | M? | Si existe escalado a una persona, equipo, canal de soporte o proceso manual. ]]
- **Historial/memoria**: [[ ux.history_session_memory | M? | Si mantiene contexto, memoria, historial de sesión o conversaciones previas. ]]

---

## 5. Arquitectura

- **Diagrama lógico**: [[ architecture.logical_flow | M | raw | Genera un diagrama visual atractivo y compacto en formato Mermaid que muestre el flujo lógico entre usuario, interfaz, componentes internos y servicios externos. Salida requerida: 1) Un bloque fenced de Mermaid (tres backticks, la palabra "mermaid", el diagrama y cierre con tres backticks) con un flowchart o gráfico de arquitectura (usa subgraph/flowchart, flechas claras, nombres legibles y anotaciones breves). 2) Una línea breve (1-2 frases) como leyenda que explique el objetivo del diagrama. 3) Si no es posible generar Mermaid, una alternativa textual compacta (máx. 3 líneas). Prioriza claridad visual: agrupa componentes (UI, extension, scanner/ranker, prompt builder, modelo/Responses API, renderer/preview, storage) y marca la dirección principal de datos (entradas -> procesamiento -> modelo -> renderizado -> usuario). No añadas largos párrafos ni listas; solo el bloque Mermaid seguido de la leyenda. ]]
- **Componentes principales**: [[ architecture.components | M | list | Componentes clave del sistema y responsabilidad principal de cada uno. ]]
- **Dependencias externas**: [[ architecture.external_dependencies | M | list | Servicios, APIs, bases de datos, modelos, colas, buscadores o integraciones externas. ]]

---

## 6. Conocimiento y prompts

- **Fuentes**: [[ knowledge_prompts.sources | M | list | Fuentes de conocimiento: documentos, índices, APIs, bases de datos, ficheros o repositorios. ]]
- **Recuperación (RAG)**: [[ knowledge_prompts.rag_summary | M | Uso de RAG, embeddings, búsqueda semántica o recuperación documental, si aplica. ]]
- **Prompts/guardrails**: [[ knowledge_prompts.prompt_guardrails_location | M | Dónde están los prompts, instrucciones de agente, políticas o guardrails. ]]
- **Contenido no permitido**: [[ knowledge_prompts.forbidden_content_handling | M? | Cómo se gestionan restricciones, moderación o respuestas no permitidas. ]]

---

## 7. Seguridad, privacidad y cumplimiento

- **Datos tratados**: [[ security_privacy.processed_data | M | list | Tipos de datos procesados, especialmente datos personales, sensibles o corporativos. ]]
- **Retención/almacenamiento**: [[ security_privacy.retention_storage | M? | Si los datos se almacenan, dónde y durante cuánto tiempo, solo con evidencia. ]]
- **Acceso**: [[ security_privacy.access_auth | M | Autenticación, autorización, roles o controles de acceso detectados. ]]
- **Redacción/anonimización** y **gestión de secretos** : [[ security_privacy.anonymization_secrets | M | Masking, anonimización, gestión de secretos o protección de credenciales. ]]
- **Cumplimiento**: [[ security_privacy.compliance_notes | M? | Notas de cumplimiento, privacidad o normativa mencionadas en el proyecto. ]]

---

## 8. Desarrollo local

- **Requisitos**: [[ local_development.requirements | M | list | Runtimes, versiones, dependencias, herramientas y servicios necesarios para desarrollo local. ]]
- **Variables de entorno**: [[ local_development.env_variables | M | env | Variables de entorno detectadas en .env.example, config o código, y finalidad de cada una si es evidente. ]]
- **Recursos/datos**: [[ local_development.resources | M? | list | Datos, ficheros, índices, recursos cloud o dependencias externas necesarias. ]]
- **Ejecutar**: [[ local_development.install_run_commands | M | code | Comandos de instalación, arranque y uso local encontrados en scripts o documentación. ]]
- **Validación rápida**: [[ local_development.validation_checks | M | list | Comandos o pasos breves para comprobar que el proyecto funciona. ]]
- **Pruebas**: [[ local_development.testing_strategy | M | Estrategia, framework o comandos de pruebas documentados. ]]

---

## 9. Despliegue

- **Entornos**: [[ deployment.environments | M? | list | Entornos detectados: local, desarrollo, preproducción, producción, cloud u otros. ]]
- **Proceso**: [[ deployment.process | M | Cómo se despliega según pipelines, Docker, IaC, scripts o documentación. ]]
- **Diferencias por entorno**: [[ deployment.environment_differences | M? | Diferencias de configuración, recursos o comportamiento entre entornos. ]]

---

<!--section:operations-->
## 10. Operación y observabilidad

- **Logs**: [[ operations.logs | M? | Dónde consultar logs o cómo se generan, si hay evidencia. ]]
- **Trazas**: [[ operations.traces | M? | Dónde consultar trazas o cómo se instrumentan, si hay evidencia. ]]
- **Métricas**: [[ operations.metrics | M? | Métricas disponibles o herramientas de monitorización detectadas. ]]
- **Señales clave**: error rate, latencia, tokens/coste, ratio de fallback, ratio de escalado.
- **Alertas/runbooks** (si aplica): [[ operations.alerts_runbooks | M? | Alertas, runbooks o procedimientos operativos detectados. ]]
- **Incidencias**: [[ operations.incident_process | M? | Cómo se gestionan incidencias o soporte operativo si está documentado. ]]

---
<!--/section-->

<!--section:documentation-->
## 11. Documentación y enlaces

- **Gestión y coordinación**: [[ documentation_links.coordination_tools | M? | list | Herramientas de gestión, tickets, coordinación o seguimiento mencionadas. ]]
- **Repositorios y CI/CD**: [[ documentation_links.repos_pipelines | M? | list | Repositorios, pipelines, workflows o recursos de CI/CD mencionados. ]]
- **Entornos y recursos**: [[ documentation_links.environments_resources | M? | list | Referencias a entornos, recursos cloud, dashboards o servicios. ]]
- **Documentación**: [[ documentation_links.manuals_docs | M? | list | Manuales, documentación técnica, guías o archivos relevantes del repositorio. ]]

---
<!--/section-->

<!--section:roadmap-->
## 12. Roadmap / mejoras

[[ roadmap | M? | list | Mejoras futuras, TODOs o elementos de roadmap mencionados explícitamente. ]]

---
<!--/section-->

<!--section:contacts-->
## 13. Contactos y ownership

- **Product owner**: [[ contacts.product_owner | M? | Product owner. Rellena solo si aparece explícitamente. ]]
- **Responsable técnico**: [[ contacts.technical_owner | M? | Responsable técnico. Rellena solo si hay evidencia clara. ]]
- **Equipo responsable**: [[ contacts.responsible_team | M? | Equipo propietario o responsable si aparece en documentación o metadatos. ]]
- **Soporte/Operación (si aplica)**: [[ contacts.support_operations | M? | Canal o equipo de soporte/operación solo si está documentado. ]]

---
<!--/section-->

<!--section:related_projects-->
## 14. Proyectos relacionados

[[ related_projects | M? | list | Proyectos relacionados mencionados explícitamente en el repositorio. ]]
<!--/section-->
