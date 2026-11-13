import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { init } from './cli/init.mjs';
import { update } from './cli/update.mjs';
import { dashboard } from './cli/dashboard.mjs';
import { parseArgs, UsageError } from './cli/args.mjs';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

export const USAGE = `Usage: wavework <command> [options]

Commands:
  init        Set up .claude/ in the current repository   [--config <file>] [--adopt] [--dry-run]
  update      Re-render .claude/ from the installed version [--dry-run]
  dashboard   Start the pipeline dashboard of this repository (installed by init)

Options:
  -v, --version   Print the version
  -h, --help      Print this help
`;

const COMMANDS = {
  init: { run: init, options: { '--config': 'value', '--adopt': 'flag', '--dry-run': 'flag' } },
  update: { run: update, options: { '--dry-run': 'flag' } },
  dashboard: { run: dashboard, options: {} },
};

/**
 * Runs the CLI with the given arguments (without node and script path).
 * Writes to the provided streams and returns the exit code; does not exit the process.
 * Exit codes: 0 ok, 1 error, 2 done, but locally edited files need review.
 *
 * `io.cwd` (default: process.cwd()) is the repository root. `io.targets`, `io.templatesDir` and `io.hooks`
 * replace the packaged target list, templates directory and hook definitions; `io.env` and `io.spawn` replace the
 * environment and child_process.spawn of `dashboard` (tests).
 *
 * @param {string[]} argv
 * @param {{ stdout: { write(s: string): unknown }, stderr: { write(s: string): unknown }, cwd?: string, targets?: Function, templatesDir?: string, hooks?: object }} io
 * @returns {Promise<number>}
 */
export async function run(argv, io) {
  const { stdout, stderr } = io;
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h') {
    stdout.write(USAGE);
    return 0;
  }
  if (command === '--version' || command === '-v') {
    stdout.write(`${pkg.version}\n`);
    return 0;
  }

  const spec = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (!spec) {
    stderr.write(`wavework: unknown command: ${command}\n\n${USAGE}`);
    return 1;
  }
  try {
    const args = parseArgs(rest, spec.options);
    return await spec.run(args, {
      cwd: io.cwd ?? process.cwd(),
      stdout,
      version: pkg.version,
      targets: io.targets,
      templatesDir: io.templatesDir,
      hooks: io.hooks,
      env: io.env,
      spawn: io.spawn,
    });
  } catch (e) {
    if (e instanceof UsageError) stderr.write(`wavework ${command}: ${e.message}\n\n${USAGE}`);
    else stderr.write(`wavework ${command}: ${e.message}\n`);
    return 1;
  }
}
