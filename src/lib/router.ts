import { useEffect, useState } from 'preact/hooks';

/**
 * Navegação pelo "#" da URL (ex.: #/remover-fundo). Funciona offline e
 * não depende de configuração no servidor.
 */

export function readRoute(hash: string = window.location.hash): string {
  const route = hash.replace(/^#\/?/, '').split(/[?#]/)[0] ?? '';
  return /^[a-z0-9-]{1,40}$/.test(route) ? route : '';
}

export function useRoute(): string {
  const [route, setRoute] = useState(() => readRoute());
  useEffect(() => {
    const onChange = () => {
      setRoute(readRoute());
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);
  return route;
}

export const hrefFor = (route: string) => `#/${route}`;
