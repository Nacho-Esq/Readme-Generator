import { afterEach, describe, expect, it, vi } from 'vitest';

// progressReporter importa `vscode` solo dentro de runWithProgress (no en la carga del
// módulo), así que un mock vacío basta para probar la matemática pura y el reporter.
vi.mock('vscode', () => ({}));

import {
  DEFAULT_PHASE_WEIGHTS,
  MODEL_CREEP_CAP,
  modelCreepFraction,
  PHASE_ORDER,
  ProgressModel,
  ProgressReporter
} from './progressReporter';

function totalIncrement(reports: Array<{ message?: string; increment?: number }>): number {
  return reports.reduce((acc, r) => acc + (r.increment ?? 0), 0);
}

describe('DEFAULT_PHASE_WEIGHTS', () => {
  it('los pesos de las fases suman 1', () => {
    const sum = Object.values(DEFAULT_PHASE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('el orden canónico cubre exactamente las fases con peso', () => {
    expect([...PHASE_ORDER].sort()).toEqual(Object.keys(DEFAULT_PHASE_WEIGHTS).sort());
  });
});

describe('ProgressModel — reparto por fases', () => {
  it('encadenar fases va sumando el peso íntegro de cada una', () => {
    const m = new ProgressModel();
    expect(m.overall()).toBe(0);
    m.beginPhase('scan');
    expect(m.overall()).toBeCloseTo(0, 10); // fracción 0 dentro de scan
    m.beginPhase('read'); // completa scan (0.10)
    expect(m.overall()).toBeCloseTo(0.1, 10);
    m.beginPhase('ranking'); // completa read (0.25)
    expect(m.overall()).toBeCloseTo(0.35, 10);
    m.beginPhase('model'); // completa ranking (0.15)
    expect(m.overall()).toBeCloseTo(0.5, 10);
    m.beginPhase('render'); // completa model (0.40)
    expect(m.overall()).toBeCloseTo(0.9, 10);
    m.completeCurrent(); // completa render (0.10)
    expect(m.overall()).toBeCloseTo(1, 10);
  });

  it('setFraction avanza dentro de la fase actual y es monótono (nunca retrocede)', () => {
    const m = new ProgressModel();
    m.beginPhase('read'); // completa nada; base 0, fase read peso 0.25
    m.setFraction(0.5);
    expect(m.overall()).toBeCloseTo(0.125, 10); // 0.25 * 0.5
    m.setFraction(0.2); // menor: se ignora
    expect(m.overall()).toBeCloseTo(0.125, 10);
    m.setFraction(0.8);
    expect(m.overall()).toBeCloseTo(0.2, 10);
  });

  it('congelar impide que setFraction mueva la barra; descongelar la reactiva', () => {
    const m = new ProgressModel();
    m.beginPhase('model'); // base 0.0 aislado, peso model 0.40
    m.setFraction(0.5);
    const frozenAt = m.overall();
    expect(frozenAt).toBeCloseTo(0.2, 10);
    m.freeze();
    m.setFraction(0.95); // ignorado mientras congelado
    expect(m.overall()).toBeCloseTo(frozenAt, 10);
    m.unfreeze();
    m.setFraction(0.95);
    expect(m.overall()).toBeCloseTo(0.38, 10); // 0.40 * 0.95
  });

  it('completeAll lleva el total a 1', () => {
    const m = new ProgressModel();
    m.beginPhase('scan');
    m.completeAll();
    expect(m.overall()).toBe(1);
  });

  it('normaliza pesos que no suman 1 para mantener el total acotado', () => {
    const m = new ProgressModel({ a: 2, b: 2 });
    m.beginPhase('a');
    m.beginPhase('b'); // completa a → 2/4 = 0.5
    expect(m.overall()).toBeCloseTo(0.5, 10);
    m.completeCurrent();
    expect(m.overall()).toBeCloseTo(1, 10);
  });

  it('overall nunca se sale de [0,1]', () => {
    const m = new ProgressModel();
    m.beginPhase('model');
    m.setFraction(5); // fuera de rango: se acota
    expect(m.overall()).toBeLessThanOrEqual(1);
    expect(m.overall()).toBeGreaterThanOrEqual(0);
  });
});

describe('modelCreepFraction — creep del modelo grande', () => {
  it('empieza en 0 y crece de forma monótona sin superar el tope', () => {
    let prev = -1;
    for (const t of [0, 1000, 5000, 20000, 60000, 200000]) {
      const f = modelCreepFraction(t);
      expect(f).toBeGreaterThanOrEqual(prev);
      expect(f).toBeLessThan(MODEL_CREEP_CAP + 1e-9);
      prev = f;
    }
    expect(modelCreepFraction(0)).toBe(0);
  });

  it('a t = tau alcanza ~63% del tope (forma de la curva 1 - e^-1)', () => {
    const tau = 10_000;
    const f = modelCreepFraction(tau, tau, MODEL_CREEP_CAP);
    expect(f).toBeCloseTo(MODEL_CREEP_CAP * (1 - Math.exp(-1)), 6);
  });

  it('tiempos no positivos dan 0', () => {
    expect(modelCreepFraction(-100)).toBe(0);
    expect(modelCreepFraction(0)).toBe(0);
  });
});

describe('ProgressReporter — traducción a incrementos de VS Code', () => {
  it('recorrer todas las fases hasta done reporta incrementos que suman ~100', () => {
    const reports: Array<{ message?: string; increment?: number }> = [];
    const reporter = new ProgressReporter({ report: (v) => reports.push(v) });
    reporter.phase('scan');
    reporter.phase('read');
    reporter.phase('ranking');
    reporter.phase('model');
    reporter.phase('render'); // detiene el creep arrancado por 'model'
    reporter.done();
    reporter.dispose();
    expect(totalIncrement(reports)).toBeCloseTo(100, 6);
  });

  it('cada fase adjunta su mensaje de texto', () => {
    const reports: Array<{ message?: string; increment?: number }> = [];
    const reporter = new ProgressReporter({ report: (v) => reports.push(v) });
    reporter.phase('scan');
    reporter.dispose();
    expect(reports.some((r) => typeof r.message === 'string' && r.message.length > 0)).toBe(true);
  });
});

describe('ProgressReporter — creep temporizado y congelación', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mientras corre el modelo la barra avanza; congelada NO avanza; al descongelar reanuda', () => {
    vi.useFakeTimers();
    const reports: Array<{ message?: string; increment?: number }> = [];
    const reporter = new ProgressReporter({ report: (v) => reports.push(v) });

    reporter.phase('model'); // arranca el creep por tiempo
    const beforeCreep = totalIncrement(reports);
    vi.advanceTimersByTime(1500);
    const afterCreep = totalIncrement(reports);
    expect(afterCreep).toBeGreaterThan(beforeCreep);

    reporter.freeze('esperando al usuario');
    const atFreeze = totalIncrement(reports);
    vi.advanceTimersByTime(5000);
    expect(totalIncrement(reports)).toBe(atFreeze); // congelado: no avanza

    reporter.unfreeze();
    vi.advanceTimersByTime(3000);
    expect(totalIncrement(reports)).toBeGreaterThan(atFreeze); // reanuda

    reporter.dispose();
  });
});
