import * as vscode from 'vscode';

// Barra de progreso discreta en la barra inferior de VS Code.
//
// El flujo de generar/actualizar pasa por fases de peso muy distinto (el escaneo es
// rápido; la llamada al modelo grande es la larga). En lugar de un mensaje suelto en
// la barra de estado que aparece y desaparece, aquí se refleja un progreso REAL por
// fases: cada fase, al completarse, suma su peso al total. Así el usuario percibe que
// "está pasando algo" y puede estimar cuánto queda.
//
// La llamada al modelo grande no informa de progreso, así que durante ella se avanza
// con un "creep" suave por tiempo (una curva que se acerca a un tope sin llegar) y, al
// terminar la llamada, la fase se completa de golpe. Nunca se pasa del tope hasta que
// la operación real termina: no se miente sobre el progreso.
//
// CLAVE: mientras se espera una decisión humana en un panel modal (seguridad,
// presupuesto, edición, revisión de actualización) el progreso se CONGELA. No tendría
// sentido seguir avanzando la barra cuando en realidad no se está haciendo trabajo.
//
// Se separa la MATEMÁTICA del reparto (ProgressModel, modelCreepFraction — puras y
// testeables) de la vinculación con la UI de VS Code (ProgressReporter, que no es
// testeable). Los tests cubren la matemática; la UI se ejerce en ejecución real.

// Fases del pipeline y su peso relativo (deben sumar 1). Pesos elegidos según la
// duración real observada: la llamada al modelo grande domina; el render es casi
// instantáneo.
export const DEFAULT_PHASE_WEIGHTS = {
  scan: 0.1,
  read: 0.25,
  ranking: 0.15,
  model: 0.4,
  render: 0.1
} as const;

export type PhaseName = keyof typeof DEFAULT_PHASE_WEIGHTS;

// Orden canónico de las fases. Determina qué peso ya ha "quedado atrás".
export const PHASE_ORDER: PhaseName[] = ['scan', 'read', 'ranking', 'model', 'render'];

// Mensaje por fase mostrado junto al spinner de la barra inferior.
export const PHASE_MESSAGES: Record<PhaseName, string> = {
  scan: 'Escaneando el repositorio…',
  read: 'Leyendo los archivos con el modelo ligero…',
  ranking: 'Ordenando los archivos por relevancia…',
  model: 'Analizando con el modelo principal…',
  render: 'Generando el documento…'
};

// Tope del creep del modelo grande, como fracción de SU fase (0..1). Se queda por
// debajo de 1 a propósito: la fase no se da por completada hasta que la llamada real
// termina. Con los pesos por defecto, 0.95 deja el total en ~0.88 antes del salto.
export const MODEL_CREEP_CAP = 0.95;

// Constante de tiempo del creep (ms). Cuanto mayor, más lento sube. Controla la forma
// de la curva 1 - e^(-t/tau): a t=tau la fracción es ~63% del tope; a t=3·tau ~95%.
export const MODEL_CREEP_TAU_MS = 20_000;

// Fracción de avance del creep del modelo grande en función del tiempo transcurrido.
// Curva asintótica que se acerca al tope sin alcanzarlo: nunca "miente" llegando al
// final antes de que la llamada real termine. Pura y determinista (testeable).
export function modelCreepFraction(
  elapsedMs: number,
  tauMs: number = MODEL_CREEP_TAU_MS,
  cap: number = MODEL_CREEP_CAP
): number {
  if (elapsedMs <= 0) {
    return 0;
  }
  return cap * (1 - Math.exp(-elapsedMs / tauMs));
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

// Modelo puro del reparto de progreso. No sabe nada de VS Code: solo lleva la cuenta
// de qué peso ya está completado y cuánto se ha avanzado dentro de la fase actual.
// `overall()` devuelve el total en 0..1. Testeable de forma aislada.
export class ProgressModel {
  private readonly weights: Record<string, number>;
  // Suma de pesos de las fases YA completadas (0..1).
  private completedBase = 0;
  private currentPhase: string | null = null;
  // Avance dentro de la fase actual (0..1). Monótono: solo sube.
  private currentFraction = 0;
  private frozen = false;

  constructor(weights: Record<string, number> = DEFAULT_PHASE_WEIGHTS) {
    // Normalización defensiva: si los pesos no suman 1, se reescalan para que el
    // total siga estando acotado en 0..1 pase lo que pase.
    const sum = Object.values(weights).reduce((acc, w) => acc + (w > 0 ? w : 0), 0);
    const factor = sum > 0 ? 1 / sum : 0;
    this.weights = Object.fromEntries(
      Object.entries(weights).map(([name, w]) => [name, (w > 0 ? w : 0) * factor])
    );
  }

  private weightOf(phase: string): number {
    return this.weights[phase] ?? 0;
  }

  // Comienza una fase. Cualquier fase en curso se da por completada (suma su peso
  // íntegro al total): así, encadenar `beginPhase` recorre el pipeline sumando pesos.
  beginPhase(name: string): void {
    if (this.currentPhase !== null) {
      this.completeCurrent();
    }
    this.currentPhase = name;
    this.currentFraction = 0;
  }

  // Fija el avance dentro de la fase actual (0..1). Monótono (solo hacia arriba) para
  // que la barra nunca retroceda. Ignorado si el progreso está congelado: así, mientras
  // se espera una decisión humana, el creep no mueve la barra.
  setFraction(fraction: number): void {
    if (this.frozen || this.currentPhase === null) {
      return;
    }
    this.currentFraction = Math.max(this.currentFraction, clamp01(fraction));
  }

  // Completa la fase actual: suma su peso íntegro al total y la cierra.
  completeCurrent(): void {
    if (this.currentPhase === null) {
      return;
    }
    this.completedBase = clamp01(this.completedBase + this.weightOf(this.currentPhase));
    this.currentPhase = null;
    this.currentFraction = 0;
  }

  // Marca todo como completado (100%).
  completeAll(): void {
    this.currentPhase = null;
    this.currentFraction = 0;
    this.completedBase = 1;
  }

  // Congela el avance: `setFraction` deja de tener efecto. Se usa mientras un panel
  // modal espera una decisión humana.
  freeze(): void {
    this.frozen = true;
  }

  unfreeze(): void {
    this.frozen = false;
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  // Progreso total en 0..1.
  overall(): number {
    const inPhase = this.currentPhase !== null ? this.weightOf(this.currentPhase) * this.currentFraction : 0;
    return clamp01(this.completedBase + inPhase);
  }
}

// Objeto de progreso de VS Code: report({ increment, message }). increment es un
// delta en porcentaje (0..100). Se abstrae en una interfaz para poder inyectar un
// doble en pruebas si hiciera falta.
export interface VsProgress {
  report(value: { message?: string; increment?: number }): void;
}

// Vinculación del modelo puro con la barra de progreso de VS Code. Traduce el total
// (0..1) del modelo a incrementos (delta en %) para `progress.report`, gestiona el
// temporizador del creep del modelo grande y expone congelar/descongelar.
export class ProgressReporter {
  private readonly model: ProgressModel;
  private readonly progress: VsProgress;
  // Último total ya reportado (0..1), para calcular el delta de cada report.
  private lastReported = 0;
  private creepTimer: ReturnType<typeof setInterval> | undefined;
  private creepStart = 0;

  constructor(progress: VsProgress, model: ProgressModel = new ProgressModel()) {
    this.progress = progress;
    this.model = model;
  }

  // Envía a VS Code el delta desde el último report y, opcionalmente, un mensaje.
  private flush(message?: string): void {
    const overall = this.model.overall();
    const deltaPercent = (overall - this.lastReported) * 100;
    const payload: { message?: string; increment?: number } = {};
    if (message !== undefined) {
      payload.message = message;
    }
    if (deltaPercent > 0) {
      payload.increment = deltaPercent;
      this.lastReported = overall;
    }
    if (payload.message !== undefined || payload.increment !== undefined) {
      this.progress.report(payload);
    }
  }

  // Entra en una fase conocida (con su mensaje). Para la fase `model` arranca el creep.
  phase(name: PhaseName): void {
    this.stopCreep();
    this.model.beginPhase(name);
    this.flush(PHASE_MESSAGES[name]);
    if (name === 'model') {
      this.startCreep();
    }
  }

  // Entra en una fase con un mensaje personalizado (p. ej. "recolocando 3 archivos").
  phaseWithMessage(name: PhaseName, message: string): void {
    this.stopCreep();
    this.model.beginPhase(name);
    this.flush(message);
    if (name === 'model') {
      this.startCreep();
    }
  }

  // Actualiza solo el texto sin tocar el progreso (útil dentro de una fase larga con
  // varios pasos, p. ej. el actualizador).
  message(text: string): void {
    this.flush(text);
  }

  private startCreep(): void {
    this.creepStart = Date.now();
    this.creepTimer = setInterval(() => {
      if (this.model.isFrozen()) {
        return;
      }
      this.model.setFraction(modelCreepFraction(Date.now() - this.creepStart));
      this.flush();
    }, 250);
  }

  private stopCreep(): void {
    if (this.creepTimer !== undefined) {
      clearInterval(this.creepTimer);
      this.creepTimer = undefined;
    }
  }

  // Congela la barra mientras se espera una decisión humana. Opcionalmente cambia el
  // texto para dejar claro que el proceso está a la espera del usuario.
  freeze(message?: string): void {
    this.model.freeze();
    if (message !== undefined) {
      this.flush(message);
    }
  }

  unfreeze(message?: string): void {
    this.model.unfreeze();
    if (message !== undefined) {
      this.flush(message);
    }
  }

  // Cierra: detiene el creep y lleva la barra al 100%.
  done(): void {
    this.stopCreep();
    this.model.completeAll();
    this.flush();
  }

  // Libera el temporizador sin forzar el 100% (para el finally: si algo falla o el
  // usuario cancela, no queremos dejar el interval vivo ni fingir que terminó).
  dispose(): void {
    this.stopCreep();
  }
}

// Número de celdas de la barra de progreso textual.
const BAR_CELLS = 10;

// Dibuja una barra de progreso con caracteres de bloque, p. ej. "███████░░░", a partir
// de un porcentaje 0..100. La API de progreso nativa de VS Code NO sabe pintar una barra
// en la barra de estado (ProgressLocation.Window solo muestra un spinner + texto, y
// ProgressLocation.Notification pinta una barra pero como popup), así que la barra la
// construimos nosotros como texto dentro de un StatusBarItem.
export function renderBar(percent: number): string {
  const pct = Math.min(100, Math.max(0, percent));
  const filled = Math.round((pct / 100) * BAR_CELLS);
  return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled);
}

// Ejecuta `operation` mostrando una barra de progreso REAL directamente en la barra de
// estado (barra inferior de VS Code), sin popups, sin notificaciones y sin desplegables.
// El texto que ve el usuario es, por ejemplo: "Generación de README  ███████░░░  72%".
// El mensaje de cada fase NO se muestra en línea (el usuario solo quiere la barra); va al
// tooltip del propio elemento, visible al pasar el ratón. Crea el ProgressReporter, le
// inyecta un destino que actualiza el StatusBarItem, y garantiza limpiar todo al terminar.
export function runWithProgress<T>(
  title: string,
  operation: (reporter: ProgressReporter) => Promise<T>
): Thenable<T> {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  let percent = 0;

  const render = (message?: string): void => {
    item.text = `$(sync~spin) ${title}  ${renderBar(percent)}  ${Math.round(percent)}%`;
    if (message !== undefined) {
      item.tooltip = message;
    }
  };

  // El ProgressReporter emite deltas en porcentaje (increment) y un mensaje por fase; los
  // deltas se acumulan en la barra y el mensaje va al tooltip.
  const progress: VsProgress = {
    report: ({ increment, message }) => {
      if (typeof increment === 'number' && increment > 0) {
        percent = Math.min(100, percent + increment);
      }
      render(message);
    }
  };

  render(); // estado inicial: barra vacía, 0 %
  item.show();

  const reporter = new ProgressReporter(progress);
  return (async () => {
    try {
      return await operation(reporter);
    } finally {
      reporter.dispose();
      item.dispose();
    }
  })();
}
