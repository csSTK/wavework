import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

export const USAGE = `Usage: wavework <command> [options]

Commands:
  init        (not yet implemented)
  update      (not yet implemented)
  dashboard   (not yet implemented)

Options:
  -v, --version   Print the version
  -h, --help      Print this help
`;

/**
 * Runs the CLI with the given arguments (without node and script path).
 * Writes to the provided streams and returns the exit code; does not exit the process.
 *
 * @param {string[]} argv
 * @param {{ stdout: { write(s: string): unknown }, stderr: { write(s: string): unknown } }} io
 * @returns {number}
 */
export function run(argv, { stdout, stderr }) {
  const [command] = argv;

  if (command === undefined || command === '--help' || command === '-h') {
    stdout.write(USAGE);
    return 0;
  }
  if (command === '--version' || command === '-v') {
    stdout.write(`${pkg.version}\n`);
    return 0;
  }

  stderr.write(`wavework: unknown command: ${command}\n\n${USAGE}`);
  return 1;
}
