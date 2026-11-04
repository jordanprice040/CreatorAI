/** Minimum patched releases supported by the current candidate (November 4, 2026). */
export function supportedNode(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) return false;
  const [, major, minor, patch] = m.map(Number);
  return (
    (major === 22 && (minor > 23 || (minor === 23 && patch >= 4))) ||
    (major === 24 && (minor > 22 || (minor === 22 && patch >= 2)))
  );
}
export function requireSupportedNode(version = process.version) {
  if (!supportedNode(version))
    throw new Error(
      `Node ${version} is unsupported. Use Node 22.23.4+ within 22.x or 24.22.2+ within 24.x before starting or packaging Creator Agent.`,
    );
}
