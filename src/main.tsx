import '@fontsource-variable/exo-2';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';

import { render } from 'preact';
import { App } from './app';
import { applyTheme, getSavedTheme } from './lib/theme';

applyTheme(getSavedTheme());

const root = document.getElementById('app');
if (!root) throw new Error('Elemento #app não encontrado.');
render(<App />, root);
