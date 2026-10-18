import { pathSchema, checked } from './contracts.js';

// Deterministic ustar for the reviewed source package. Only plain UTF-8 files with portable
// paths are written or accepted back; links, devices, PAX/GNU headers and duplicates fail.
const BLOCK = 512;
export const PACKAGE_LIMITS = { files: 100, bytes: 512 * 1024 } as const;
export interface PackageFile {
  path: string;
  content: Buffer;
}
function field(h: Buffer, at: number, length: number, value: string) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > length) throw new Error('Archive field too long');
  bytes.copy(h, at);
}
function octal(h: Buffer, at: number, length: number, value: number) {
  field(h, at, length, value.toString(8).padStart(length - 1, '0') + '\0');
}
function split(path: string): [string, string] {
  if (Buffer.byteLength(path) <= 100) return ['', path];
  for (let i = path.length - 1; i > 0; i--)
    if (
      path[i] === '/' &&
      Buffer.byteLength(path.slice(i + 1)) <= 100 &&
      Buffer.byteLength(path.slice(0, i)) <= 155
    )
      return [path.slice(0, i), path.slice(i + 1)];
  throw new Error('Path cannot be stored in ustar');
}
function checksum(h: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
  return sum;
}
export function writeTar(files: PackageFile[]): Buffer {
  const parts: Buffer[] = [];
  for (const f of files) {
    checked(pathSchema, f.path);
    const h = Buffer.alloc(BLOCK);
    const [prefix, name] = split(f.path);
    field(h, 0, 100, name);
    octal(h, 100, 8, 0o644);
    octal(h, 108, 8, 0);
    octal(h, 116, 8, 0);
    octal(h, 124, 12, f.content.length);
    octal(h, 136, 12, 0);
    h[156] = 0x30;
    field(h, 257, 6, 'ustar\0');
    field(h, 263, 2, '00');
    field(h, 345, 155, prefix);
    field(h, 148, 8, checksum(h).toString(8).padStart(6, '0') + '\0 ');
    parts.push(h, f.content);
    const pad = (BLOCK - (f.content.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}
function text(h: Buffer, at: number, length: number): string {
  const raw = h.subarray(at, at + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString('utf8');
}
function number(h: Buffer, at: number, length: number): number {
  const raw = text(h, at, length).trim();
  if (!/^[0-7]{1,11}$/.test(raw)) throw new Error('Malformed archive header');
  return parseInt(raw, 8);
}
/** Strict reader for packages this supervisor wrote; anything unexpected is refused. */
export function readTar(archive: Buffer): PackageFile[] {
  const files: PackageFile[] = [];
  const seen = new Set<string>();
  let at = 0,
    total = 0;
  for (;;) {
    if (at + BLOCK > archive.length) throw new Error('Truncated archive');
    const h = archive.subarray(at, at + BLOCK);
    if (h.every((b) => b === 0)) {
      const rest = archive.subarray(at);
      if (rest.length !== BLOCK * 2 || !rest.every((b) => b === 0))
        throw new Error('Unexpected archive trailer');
      return files;
    }
    if (number(h, 148, 8) !== checksum(h))
      throw new Error('Archive header checksum mismatch');
    if (text(h, 257, 6) !== 'ustar' || h[156] !== 0x30)
      throw new Error('Only regular ustar files are accepted');
    const prefix = text(h, 345, 155);
    const path = prefix ? `${prefix}/${text(h, 0, 100)}` : text(h, 0, 100);
    if (!pathSchema.safeParse(path).success)
      throw new Error('Archive path refused');
    if (seen.has(path)) throw new Error('Duplicate archive path');
    seen.add(path);
    const size = number(h, 124, 12);
    total += size;
    if (files.length >= PACKAGE_LIMITS.files || total > PACKAGE_LIMITS.bytes)
      throw new Error('Archive limit exceeded');
    at += BLOCK;
    if (at + size > archive.length) throw new Error('Truncated archive');
    const content = Buffer.from(archive.subarray(at, at + size));
    if (!Buffer.from(content.toString('utf8')).equals(content))
      throw new Error('Package accepts UTF-8 text only');
    files.push({ path, content });
    at += size + ((BLOCK - (size % BLOCK)) % BLOCK);
  }
}
