/** Lines of a text as an array; a trailing newline does not add an empty last line. */
const lines = (text) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));

/** Above this many cells the exact LCS is skipped (memory); the stat then counts the middle section as replaced. */
const MAX_CELLS = 4_000_000;

/**
 * Short line diff summary between two texts: how many lines the new text adds and the old text removes
 * (longest-common-subsequence based, dependency-free). A full diff is the user's job.
 *
 * @param {string} from existing content
 * @param {string} to rendered content
 * @param {{ maxCells?: number }} [options] LCS size cap (tests lower it)
 * @returns {{ added: number, removed: number, approx?: true, whitespaceOnly?: true }}
 *   `approx`: over the cap, the numbers are an upper bound. `whitespaceOnly`: texts differ but no line does (trailing newline).
 */
export function lineDiffStat(from, to, { maxCells = MAX_CELLS } = {}) {
  const a = lines(from);
  const b = lines(to);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (x.length === 0 && y.length === 0) return from === to ? { added: 0, removed: 0 } : { added: 0, removed: 0, whitespaceOnly: true };
  if (x.length === 0 || y.length === 0) return { added: y.length, removed: x.length };
  if (x.length * y.length > maxCells) return { added: y.length, removed: x.length, approx: true };

  let prev = new Uint32Array(y.length + 1);
  let cur = new Uint32Array(y.length + 1);
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  const common = prev[y.length];
  return { added: y.length - common, removed: x.length - common };
}
