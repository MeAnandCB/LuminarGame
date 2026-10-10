/** Cipher helpers used to *generate* seeded puzzle text. Tests verify the results with independent code. */
const A = 'A'.charCodeAt(0);

export function caesarShift(text: string, shift: number): string {
  return text
    .toUpperCase()
    .split('')
    .map((ch) => {
      const c = ch.charCodeAt(0) - A;
      if (c < 0 || c > 25) return ch;
      return String.fromCharCode(((((c + shift) % 26) + 26) % 26) + A);
    })
    .join('');
}

export function atbash(text: string): string {
  return text
    .toUpperCase()
    .split('')
    .map((ch) => {
      const c = ch.charCodeAt(0) - A;
      if (c < 0 || c > 25) return ch;
      return String.fromCharCode(25 - c + A);
    })
    .join('');
}

export function toBinary8(ch: string): string {
  return ch.charCodeAt(0).toString(2).padStart(8, '0');
}
