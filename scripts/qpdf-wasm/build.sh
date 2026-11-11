#!/usr/bin/env bash
# Compila o qpdf oficial para WebAssembly (ES module para Web Worker; também roda
# no Node, para os testes automáticos executarem a mesma correção que o app).
#
# Roda DENTRO da imagem fixa do Emscripten (ver .github/workflows/qpdf-wasm.yml).
# Saída em vendor/qpdf/:
#   qpdf.js     módulo ES gerado pelo Emscripten (cria a instância do qpdf)
#   qpdf.wasm   o qpdf compilado
#   BUILD-INFO  versões, opções e SHA-256 dos arquivos
#
# Segurança:
# - o código-fonte é baixado do release oficial e conferido pelo SHA-256 publicado
#   no arquivo qpdf-<versão>.sha256, assinado com PGP pelo mantenedor do qpdf;
# - compilado com DYNAMIC_EXECUTION=0: o código gerado não usa eval/new Function
#   (compatível com a CSP do app, que não tem 'unsafe-eval').
set -euo pipefail

QPDF_VERSION="12.4.2"
QPDF_SHA256="8a58af5b6141319287c1883bec8bd1bd545b7567b7fc5e6ce5d25a1c85f36397"
QPDF_URL="https://github.com/qpdf/qpdf/releases/download/v${QPDF_VERSION}/qpdf-${QPDF_VERSION}.tar.gz"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-/tmp/qpdf-wasm}"
OUT="${ROOT}/vendor/qpdf"
JOBS="$(nproc 2>/dev/null || echo 2)"

rm -rf "${WORK}"
mkdir -p "${WORK}" "${OUT}"
cd "${WORK}"

echo "==> Baixando qpdf ${QPDF_VERSION}"
curl -fsSL --retry 3 -o qpdf.tar.gz "${QPDF_URL}"
echo "${QPDF_SHA256}  qpdf.tar.gz" | sha256sum -c -
tar -xzf qpdf.tar.gz
SRC="${WORK}/qpdf-${QPDF_VERSION}"

echo "==> Preparando zlib e libjpeg (ports oficiais do Emscripten)"
embuilder build zlib libjpeg
SYSROOT="$(em-config CACHE)/sysroot"
LIBDIR="${SYSROOT}/lib/wasm32-emscripten"

# Mesmas flags na compilação e na ligação. Exceções C++ nativas do WebAssembly
# (o qpdf usa exceções em todo o tratamento de erro).
COMMON_FLAGS="-O2 -fwasm-exceptions -ffile-prefix-map=${WORK}=/qpdf"
LINK_FLAGS=(
  -fwasm-exceptions
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createQpdf
  -sENVIRONMENT=worker,node
  -sINVOKE_RUN=0
  -sEXIT_RUNTIME=0
  -sFORCE_FILESYSTEM=1
  "-sEXPORTED_RUNTIME_METHODS=['callMain','FS']"
  "-sINCOMING_MODULE_JS_API=['print','printErr','locateFile','wasmBinary']"
  -sALLOW_MEMORY_GROWTH=1
  -sMAXIMUM_MEMORY=4GB
  -sSTACK_SIZE=8MB
  -sDYNAMIC_EXECUTION=0
)

echo "==> Configurando"
emcmake cmake -S "${SRC}" -B build -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS="${COMMON_FLAGS}" \
  -DCMAKE_CXX_FLAGS="${COMMON_FLAGS}" \
  -DCMAKE_EXE_LINKER_FLAGS="${LINK_FLAGS[*]}" \
  -DBUILD_SHARED_LIBS=OFF \
  -DBUILD_STATIC_LIBS=ON \
  -DBUILD_DOC=OFF \
  -DINSTALL_EXAMPLES=OFF \
  -DUSE_IMPLICIT_CRYPTO=OFF \
  -DREQUIRE_CRYPTO_NATIVE=ON \
  -DZLIB_H_PATH="${SYSROOT}/include" \
  -DZLIB_LIB_PATH="${LIBDIR}/libz.a" \
  -DLIBJPEG_H_PATH="${SYSROOT}/include" \
  -DLIBJPEG_LIB_PATH="${LIBDIR}/libjpeg.a"

echo "==> Compilando (só o executável qpdf)"
cmake --build build --target qpdf -j "${JOBS}"

JS="$(find build -name 'qpdf.js' -path '*qpdf/*' | head -n 1)"
WASM="${JS%.js}.wasm"
test -f "${JS}" && test -f "${WASM}"
cp "${JS}" "${OUT}/qpdf.js"
cp "${WASM}" "${OUT}/qpdf.wasm"

# Confere que o código gerado não usa eval nem new Function.
if grep -Eq '\beval\(|new Function\(' "${OUT}/qpdf.js"; then
  echo "ERRO: qpdf.js contém eval/new Function" >&2
  exit 1
fi

EMCC_VERSION="$(emcc --version | head -n 1)"
{
  echo "qpdf ${QPDF_VERSION}"
  echo "fonte: ${QPDF_URL}"
  echo "fonte sha256: ${QPDF_SHA256}"
  echo "compilador: ${EMCC_VERSION}"
  echo "imagem: ${EMSDK_IMAGE:-desconhecida}"
  echo "flags de compilação: ${COMMON_FLAGS}"
  echo "flags de ligação: ${LINK_FLAGS[*]}"
  echo
  echo "sha256 dos arquivos:"
  (cd "${OUT}" && sha256sum qpdf.js qpdf.wasm)
} > "${OUT}/BUILD-INFO"

cp "${SRC}/LICENSE.txt" "${OUT}/LICENSE.txt"
echo "==> Pronto"
cat "${OUT}/BUILD-INFO"
ls -la "${OUT}"
