/**
 * Reads QR codes from the camera with the browser's BarcodeDetector (Chrome
 * on Android, Safari 17+…). Where it is missing (Chrome on Windows, Firefox)
 * the `barcode-detector` ponyfill takes over: same API, decoding in
 * WebAssembly. Its .wasm file is served by this site (no CDN), and the
 * ponyfill is only downloaded when needed.
 */
export interface QrDetector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>
}

interface NativeDetectorClass {
  new (options: { formats: string[] }): QrDetector
  getSupportedFormats(): Promise<string[]>
}

export async function createQrDetector(): Promise<QrDetector> {
  const native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector
  if (native && (await native.getSupportedFormats()).includes('qr_code')) {
    return new native({ formats: ['qr_code'] })
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  })
  return new BarcodeDetector({ formats: ['qr_code'] })
}
