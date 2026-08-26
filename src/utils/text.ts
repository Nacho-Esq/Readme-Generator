// Indenta cada línea de un texto con 4 espacios. La usan los prompts del actualizador
// para encajar bloques (valor del README, valor del código) dentro de una lista.
export function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}
