/**
 * Parses snapshot IDs from an input string supporting single IDs, comma-separated lists,
 * and hyphenated ranges.
 *
 * @param input - The input string containing snapshot IDs or ranges
 * @returns Sorted, de-duplicated array of integers or an Error on validation failure
 */
export function parseSnapshotIds(input: string): number[] | Error {
  if (!input || input.trim() === '') {
    return [];
  }

  const rawParts = input.split(',');
  const resultIds: number[] = [];

  for (const rawPart of rawParts) {
    const part = rawPart.trim();
    if (part === '') {
      continue;
    }

    if (part.includes('-')) {
      const subParts = part.split('-').map((s) => s.trim());

      if (subParts.length !== 2 || subParts[0] === '' || subParts[1] === '') {
        const nonNumericSub = subParts.find(
          (s) => s !== '' && !/^\d+$/.test(s)
        );
        if (nonNumericSub) {
          return new Error(`Invalid ID: '${nonNumericSub}'`);
        }
        return new Error(`Invalid ID: '${part}'`);
      }

      const [startStr, endStr] = subParts;

      if (!startStr || !/^\d+$/.test(startStr)) {
        return new Error(`Invalid ID: '${startStr ?? ''}'`);
      }

      if (!endStr || !/^\d+$/.test(endStr)) {
        return new Error(`Invalid ID: '${endStr ?? ''}'`);
      }

      const start = Number.parseInt(startStr, 10);
      const end = Number.parseInt(endStr, 10);

      if (start > end) {
        return new Error(
          `Range ${start}-${end} is invalid — start must be less than end`
        );
      }

      const count = end - start + 1;
      if (count > 100) {
        return new Error(
          `Range ${start}-${end} would select ${count} snapshots — maximum is 100`
        );
      }

      for (let id = start; id <= end; id++) {
        resultIds.push(id);
      }
    } else {
      if (!/^\d+$/.test(part)) {
        return new Error(`Invalid ID: '${part}'`);
      }

      resultIds.push(Number.parseInt(part, 10));
    }
  }

  return Array.from(new Set(resultIds)).sort((a, b) => a - b);
}
