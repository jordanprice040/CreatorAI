// Test doubles that run a build's `src/main.py` with the host's python3 (never isolation
// evidence). The studio runs builds on Linux, where Python writes "\n". On Windows, Python's
// text-mode stdout and stderr write "\r\n" instead and pipes use the locale code page, so an
// exact output match fails on the platform, not on the program. There the program runs through
// runpy with "\n" output and UTF-8 (-X utf8), which keeps the same sys.argv, __main__ and
// isolated sys.path (-I adds neither the script folder nor ''). Elsewhere the arguments are
// returned unchanged.
const NEWLINE_SHIM = [
  'import runpy, sys',
  "sys.stdout.reconfigure(newline='\\n')",
  "sys.stderr.reconfigure(newline='\\n')",
  'sys.argv = sys.argv[1:]',
  "runpy.run_path(sys.argv[0], run_name='__main__')",
].join('; ');

/** python3 arguments for `python3 <flags> <script> <args>`, with "\n" output on Windows. */
export function pythonScriptArgs(
  flags: readonly string[],
  script: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== 'win32') return [...flags, script, ...args];
  return [...flags, '-X', 'utf8', '-c', NEWLINE_SHIM, script, ...args];
}
