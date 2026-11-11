/**
 * Leitor do formato `_headers` do Cloudflare Pages (subconjunto usado neste projeto):
 *
 *   /caminho-ou-padrão
 *     Nome-Do-Cabeçalho: valor
 *
 * Linhas começando com `#` são comentários. O `*` no padrão casa qualquer sequência
 * de caracteres (inclusive `/`), como no Cloudflare.
 */

export interface HeaderRule {
  readonly pattern: string;
  readonly headers: readonly (readonly [name: string, value: string])[];
}

export function parseHeadersFile(source: string): HeaderRule[] {
  const rules: { pattern: string; headers: [string, string][] }[] = [];
  let current: (typeof rules)[number] | undefined;

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    if (rawLine.trim() === '' || rawLine.trimStart().startsWith('#')) return;

    const isIndented = /^\s/.test(rawLine);
    const line = rawLine.trim();

    if (!isIndented) {
      if (!line.startsWith('/')) {
        throw new Error(`_headers linha ${lineNumber}: o padrão deve começar com "/".`);
      }
      current = { pattern: line, headers: [] };
      rules.push(current);
      return;
    }

    if (!current) {
      throw new Error(`_headers linha ${lineNumber}: cabeçalho sem padrão de caminho antes.`);
    }
    const separator = line.indexOf(':');
    if (separator <= 0) {
      throw new Error(`_headers linha ${lineNumber}: esperado "Nome: valor".`);
    }
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9-]+$/.test(name) || value === '') {
      throw new Error(`_headers linha ${lineNumber}: cabeçalho inválido.`);
    }
    current.headers.push([name, value]);
  });

  return rules;
}

function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

/** Cabeçalhos que se aplicam a um caminho, na ordem do arquivo (regras posteriores somam). */
export function headersForPath(rules: readonly HeaderRule[], path: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rule of rules) {
    if (patternToRegExp(rule.pattern).test(path)) {
      for (const [name, value] of rule.headers) result.set(name, value);
    }
  }
  return result;
}
