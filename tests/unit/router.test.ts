import { describe, expect, it } from 'vitest';
import { hrefFor, readRoute } from '../../src/lib/router';
import { DEFAULT_TOOL_ID, findTool, TOOL_GROUPS, TOOLS } from '../../src/tools/registry';

describe('readRoute', () => {
  it('lê a rota do "#"', () => {
    expect(readRoute('#/remover-fundo')).toBe('remover-fundo');
    expect(readRoute('#remover-fundo')).toBe('remover-fundo');
    expect(readRoute('#/sobre?x=1')).toBe('sobre');
    expect(readRoute('')).toBe('');
  });

  it('ignora rotas com caracteres inesperados', () => {
    expect(readRoute('#/<script>')).toBe('');
    expect(readRoute('#/../../etc')).toBe('');
    expect(readRoute(`#/${'a'.repeat(41)}`)).toBe('');
  });

  it('monta o endereço', () => {
    expect(hrefFor('sobre')).toBe('#/sobre');
  });
});

describe('registro de ferramentas', () => {
  it('ids únicos, válidos como rota e diferentes de "sobre"', () => {
    const ids = TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(readRoute(hrefFor(id))).toBe(id);
      expect(id).not.toBe('sobre');
    }
  });

  it('toda ferramenta está num grupo do menu e aceita ao menos um tipo', () => {
    for (const tool of TOOLS) {
      expect(TOOL_GROUPS).toContain(tool.group);
      expect(tool.accepts.length).toBeGreaterThan(0);
    }
  });

  it('a ferramenta padrão existe', () => {
    expect(findTool(DEFAULT_TOOL_ID)).toBeDefined();
    expect(findTool('nao-existe')).toBeUndefined();
  });

  it('Editar PDF inclui a opção de cortar', () => {
    expect(findTool('editar-pdf')?.options?.map((option) => option.id)).toContain('cortar');
  });
});
