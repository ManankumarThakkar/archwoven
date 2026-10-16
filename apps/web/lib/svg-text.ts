import { ASCII_ADVANCE_EM } from './font-metrics';

export const escapeXml = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

/** Wrap without dropping text, including long identifiers and explicit newlines. */
export function linesOf(text: string, limit: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + word.length + 1 > limit) { lines.push(line); line = ''; }
      let rest = word;
      while (rest.length > limit) { if (line) { lines.push(line); line = ''; } lines.push(rest.slice(0, limit)); rest = rest.slice(limit); }
      line += (line ? ' ' : '') + rest;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

/** Safe over-estimate for the bundled font; unknown Unicode remains bounded. */
export function textWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    em += code >= 32 && code <= 126 ? ASCII_ADVANCE_EM[code - 32]! : 1.2 * character.length;
  }
  return em * fontSize;
}

/** Wrap words and long identifiers by width without splitting Unicode pairs. */
export function wrapText(text: string, width: number, fontSize: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && textWidth(`${line} ${word}`, fontSize) <= width) { line += ` ${word}`; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const character of word) {
        if (line && textWidth(line + character, fontSize) > width) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}
