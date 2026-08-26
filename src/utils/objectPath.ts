// Lectura de un valor por ruta con puntos ("a.b.c") sobre un objeto anidado.
// Compartida por el render, el modelo de revisión, el panel de edición y las fichas
// del actualizador, que antes tenían cada uno su propia copia idéntica. Devuelve
// undefined si algún tramo no existe o no es un objeto.

export function getValueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, value);
}
