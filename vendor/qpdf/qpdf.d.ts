/**
 * Tipos do módulo gerado pelo Emscripten (qpdf.js). Escrito à mão: o build
 * (scripts/qpdf-wasm/build.sh) gera só qpdf.js e qpdf.wasm.
 */

export interface QpdfFileSystem {
  writeFile(path: string, data: Uint8Array | string): void;
  readFile(path: string): Uint8Array;
  readFile(path: string, options: { encoding: 'utf8' }): string;
  unlink(path: string): void;
  analyzePath(path: string): { exists: boolean };
}

export interface QpdfModule {
  /** Executa o qpdf como na linha de comando; devolve o código de saída. */
  callMain(args: string[]): number;
  FS: QpdfFileSystem;
}

export interface QpdfModuleOptions {
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  locateFile?: (path: string, prefix: string) => string;
  wasmBinary?: ArrayBuffer;
}

export default function createQpdf(options?: QpdfModuleOptions): Promise<QpdfModule>;
