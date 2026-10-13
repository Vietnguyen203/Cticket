/**
 * The real type of an uploaded file, from its first bytes ("magic numbers").
 * The file name and the Content-Type header are chosen by the client and
 * prove nothing: an HTML or SVG page renamed to .png must not be served as an
 * image of this site (SVG can carry scripts, so it is never accepted).
 */
const SIGNATURES = [
  { ext: 'jpg', mime: 'image/jpeg', matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: 'png',
    mime: 'image/png',
    matches: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    matches: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

/** @returns {{ ext: string, mime: string } | null} */
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  const found = SIGNATURES.find((signature) => signature.matches(buffer));
  return found ? { ext: found.ext, mime: found.mime } : null;
}

module.exports = { detectImageType, ACCEPTED_TYPES: SIGNATURES.map((s) => s.mime) };
