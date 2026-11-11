import { describe, expect, it } from 'vitest';
import { parseSnapshotIds } from './snapshotUtils';

describe('parseSnapshotIds', () => {
  it('parses a single ID', () => {
    const result = parseSnapshotIds('144');
    expect(result).toEqual([144]);
  });

  it('parses a comma list', () => {
    const result = parseSnapshotIds('144,145,146');
    expect(result).toEqual([144, 145, 146]);
  });

  it('parses a single range', () => {
    const result = parseSnapshotIds('144-148');
    expect(result).toEqual([144, 145, 146, 147, 148]);
  });

  it('parses mixed input', () => {
    const result = parseSnapshotIds('144-148,150,155-157');
    expect(result).toEqual([144, 145, 146, 147, 148, 150, 155, 156, 157]);
  });

  it('returns error for reverse range', () => {
    const result = parseSnapshotIds('150-140');
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe(
      'Range 150-140 is invalid — start must be less than end'
    );
  });

  it('returns error for oversized range', () => {
    const result = parseSnapshotIds('100-205');
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe(
      'Range 100-205 would select 106 snapshots — maximum is 100'
    );
  });

  it('returns error for non-numeric input', () => {
    const result = parseSnapshotIds('144, abc');
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("Invalid ID: 'abc'");
  });

  it('de-duplicates duplicate IDs', () => {
    const result = parseSnapshotIds('144, 144-146, 145');
    expect(result).toEqual([144, 145, 146]);
  });

  it('tolerates whitespace around commas and hyphens', () => {
    const result = parseSnapshotIds(' 144 - 148 , 150 , 155 - 157 ');
    expect(result).toEqual([144, 145, 146, 147, 148, 150, 155, 156, 157]);
  });
});
