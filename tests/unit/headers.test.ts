import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { headersForPath, parseHeadersFile } from '../../scripts/headers';

describe('parseHeadersFile', () => {
  it('lê padrões e cabeçalhos, ignorando comentários', () => {
    const rules = parseHeadersFile(
      '# comentário\n/*\n  X-A: 1\n\n/sw.js\n  Cache-Control: no-cache\n',
    );
    expect(rules).toEqual([
      { pattern: '/*', headers: [['X-A', '1']] },
      { pattern: '/sw.js', headers: [['Cache-Control', 'no-cache']] },
    ]);
  });

  it('rejeita arquivos malformados', () => {
    expect(() => parseHeadersFile('  X-A: 1')).toThrow();
    expect(() => parseHeadersFile('sem-barra\n  X-A: 1')).toThrow();
    expect(() => parseHeadersFile('/*\n  sem dois pontos')).toThrow();
  });

  it('aplica regras pelo caminho', () => {
    const rules = parseHeadersFile('/*\n  X-A: 1\n/assets/*\n  X-B: 2\n');
    expect(Object.fromEntries(headersForPath(rules, '/'))).toEqual({ 'X-A': '1' });
    expect(Object.fromEntries(headersForPath(rules, '/assets/a.js'))).toEqual({
      'X-A': '1',
      'X-B': '2',
    });
  });
});

describe('public/_headers do projeto', () => {
  const rules = parseHeadersFile(readFileSync('public/_headers', 'utf8'));
  const root = headersForPath(rules, '/');
  const csp = root.get('Content-Security-Policy') ?? '';

  it('tem todos os cabeçalhos de segurança', () => {
    for (const name of [
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Embedder-Policy',
      'Cross-Origin-Resource-Policy',
    ]) {
      expect(root.has(name), name).toBe(true);
    }
  });

  it('CSP sem unsafe-inline nem unsafe-eval', () => {
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('connect-src só libera o próprio site e o Hugging Face', () => {
    const connect = /connect-src ([^;]+)/.exec(csp)?.[1]?.split(/\s+/) ?? [];
    expect(connect.sort()).toEqual(["'self'", 'https://*.hf.co', 'https://huggingface.co'].sort());
  });
});
