/**
 * Tiny line diff (LCS) for the golden tests. Output is stable text:
 * one `@@ -<srcLine> +<newLine> @@` header per hunk, then `-`/`+` lines, no context.
 * Empty string when both texts are equal.
 */
export function lineDiff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  let inHunk = false;
  const open = () => {
    if (!inHunk) out.push(`@@ -${i + 1} +${j + 1} @@`);
    inHunk = true;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      inHunk = false;
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      open();
      out.push(`+${b[j++]}`);
    } else {
      open();
      out.push(`-${a[i++]}`);
    }
  }
  return out.length === 0 ? '' : `${out.join('\n')}\n`;
}
