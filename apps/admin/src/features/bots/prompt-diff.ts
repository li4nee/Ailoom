// SPDX-License-Identifier: AGPL-3.0-only
interface Line {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

export function diffPrompt(before: string, after: string): Line[] {
  const oldLines = before === '' ? [] : before.split('\n');
  const newLines = after === '' ? [] : after.split('\n');
  let start = 0;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (start < oldEnd && start < newEnd && oldLines[start] === newLines[start]) start++;
  while (start < oldEnd && start < newEnd && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const oldMiddle = oldLines.slice(start, oldEnd);
  const newMiddle = newLines.slice(start, newEnd);
  const result: Line[] = oldLines.slice(0, start).map((text) => ({ kind: 'same', text }));
  const columns = newMiddle.length + 1;
  const cells = (oldMiddle.length + 1) * columns;
  // Cap work for prompts made up of thousands of short lines.
  if (cells > 250_000) {
    for (const text of oldMiddle) result.push({ kind: 'removed', text });
    for (const text of newMiddle) result.push({ kind: 'added', text });
  } else {
    const lengths = new Uint16Array(cells);
    const lengthAt = (row: number, col: number) => lengths[row * columns + col] ?? 0;
    for (let row = oldMiddle.length - 1; row >= 0; row--) {
      for (let col = newMiddle.length - 1; col >= 0; col--) {
        lengths[row * columns + col] =
          oldMiddle[row] === newMiddle[col]
            ? 1 + lengthAt(row + 1, col + 1)
            : Math.max(lengthAt(row + 1, col), lengthAt(row, col + 1));
      }
    }
    let row = 0;
    let col = 0;
    while (row < oldMiddle.length || col < newMiddle.length) {
      const oldLine = oldMiddle[row];
      const newLine = newMiddle[col];
      if (oldLine !== undefined && oldLine === newLine) {
        result.push({ kind: 'same', text: oldLine });
        row++;
        col++;
      } else if (
        oldLine !== undefined &&
        (newLine === undefined || lengthAt(row + 1, col) >= lengthAt(row, col + 1))
      ) {
        result.push({ kind: 'removed', text: oldLine });
        row++;
      } else if (newLine !== undefined) {
        result.push({ kind: 'added', text: newLine });
        col++;
      }
    }
  }
  for (const text of oldLines.slice(oldEnd)) result.push({ kind: 'same', text });
  return result;
}
