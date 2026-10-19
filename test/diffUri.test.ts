import { Uri } from 'vscode';
import { describe, expect, it } from 'vitest';
import { buildDiffUri, DIFF_SCHEME, parseDiffUri } from '../src/providers/diffContentProvider';

describe('DiffContentProvider: URI сравнения', () => {
  it('собирает и разбирает URI с корнем, коммитом и путём', () => {
    const uri = buildDiffUri({
      root: '/tmp/repo',
      commit: 'abc123',
      filePath: 'src/dir/file name.ts',
    });
    expect(uri.scheme).toBe(DIFF_SCHEME);
    const parsed = parseDiffUri(uri);
    expect(parsed).toEqual({
      root: '/tmp/repo',
      commit: 'abc123',
      filePath: 'src/dir/file name.ts',
    });
  });

  it('возвращает null для некорректного URI', () => {
    const uri = Uri.from({ scheme: DIFF_SCHEME, path: '/x', query: 'root=/tmp/repo' });
    expect(parseDiffUri(uri)).toBeNull();
  });

  it('сохраняет спецсимволы в пути', () => {
    const filePath = 'docs/файл #1 & [draft].md';
    const uri = buildDiffUri({ root: 'C:\\repo', commit: 'd41d8cd', filePath });
    expect(parseDiffUri(uri)?.filePath).toBe(filePath);
    expect(parseDiffUri(uri)?.root).toBe('C:\\repo');
  });
});
