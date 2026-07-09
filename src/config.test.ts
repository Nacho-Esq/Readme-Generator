import { describe, expect, it, vi } from 'vitest';

// config.ts importa `vscode` para getSettings/ensureConfigured (I/O real del editor).
// Aquí solo probamos getReadDepthTokenBudget, que es pura.
vi.mock('vscode', () => ({}));

import { getReadDepthTokenBudget } from './config';

describe('getReadDepthTokenBudget', () => {
  it('devuelve el presupuesto fijo de cada nivel de profundidad', () => {
    expect(getReadDepthTokenBudget('básico')).toBe(30_000);
    expect(getReadDepthTokenBudget('detallado')).toBe(90_000);
    expect(getReadDepthTokenBudget('profundo')).toBe(180_000);
  });

  it('en modo personalizado usa el presupuesto indicado por el usuario', () => {
    expect(getReadDepthTokenBudget('personalizado', 50_000)).toBe(50_000);
  });

  it('en modo personalizado sin valor indicado, cae a 30000 por defecto', () => {
    expect(getReadDepthTokenBudget('personalizado', undefined)).toBe(30_000);
  });

  it('en modo personalizado con un valor por debajo del mínimo, lo eleva a 1000', () => {
    expect(getReadDepthTokenBudget('personalizado', 10)).toBe(1_000);
  });
});
