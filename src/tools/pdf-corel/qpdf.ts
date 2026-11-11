import createQpdf, { type QpdfModule } from '../../../vendor/qpdf/qpdf.js';

/** Resultado de uma execução do qpdf. Códigos: 0 = ok, 2 = erro, 3 = ok com avisos. */
export interface QpdfRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Qpdf {
  run(args: readonly string[]): QpdfRun;
  writeFile(path: string, data: Uint8Array | string): void;
  readFile(path: string): Uint8Array;
  readText(path: string): string;
  remove(path: string): void;
}

/**
 * Carrega uma instância do qpdf (WebAssembly). Roda num Web Worker (app) ou no Node (testes).
 * Os arquivos ficam num sistema de arquivos em memória, que some quando o worker é encerrado.
 */
export async function loadQpdf(): Promise<Qpdf> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const module: QpdfModule = await createQpdf({
    print: (text) => stdout.push(text),
    printErr: (text) => stderr.push(text),
  });

  return {
    run(args) {
      stdout.length = 0;
      stderr.length = 0;
      const code = module.callMain([...args]);
      return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
    },
    writeFile: (path, data) => {
      module.FS.writeFile(path, data);
    },
    readFile: (path) => module.FS.readFile(path),
    readText: (path) => module.FS.readFile(path, { encoding: 'utf8' }),
    remove: (path) => {
      if (module.FS.analyzePath(path).exists) module.FS.unlink(path);
    },
  };
}
