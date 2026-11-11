import '@fontsource-variable/exo-2';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';

import { render } from 'preact';
import { App } from './app';
import { applyTheme, getSavedTheme } from './lib/theme';

applyTheme(getSavedTheme());

// Arquivo solto fora da área de soltar: o Chrome abriria o arquivo na janela do app
// (e um PDF de cliente seria exibido pelo leitor do navegador). Impede isso.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (event) => {
    if (event.dataTransfer?.types.includes('Files') === true) event.preventDefault();
  });
}

const root = document.getElementById('app');
if (!root) throw new Error('Elemento #app não encontrado.');
render(<App />, root);
