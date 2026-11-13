/** A mistake in how the command line was written; the CLI answers with the usage text. */
export class UsageError extends Error {}

/**
 * Minimal option parser. `spec` maps option name to 'flag' or 'value'; `--name=value` is accepted too.
 * Positional arguments are not allowed.
 *
 * @param {string[]} argv
 * @param {Record<string, 'flag' | 'value'>} spec
 * @returns {Record<string, string | boolean>}
 */
export function parseArgs(argv, spec) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const [name, inline] = argv[i].startsWith('--') ? argv[i].split(/=(.*)/s, 2) : [argv[i]];
    const kind = Object.hasOwn(spec, name) ? spec[name] : undefined;
    if (kind === undefined) throw new UsageError(`unknown option or argument: ${argv[i]}`);
    if (kind === 'flag') {
      if (inline !== undefined) throw new UsageError(`${name} does not take a value`);
      out[name] = true;
    } else {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') throw new UsageError(`${name} needs a value`);
      out[name] = value;
    }
  }
  return out;
}
