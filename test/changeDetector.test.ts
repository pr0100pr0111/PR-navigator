import { describe, expect, it } from 'vitest';
import { DiffEntry } from '../src/git/gitTypes';
import { detectChanges } from '../src/review/changeDetector';
import { FileReviewRecord, ReviewStatus } from '../src/review/reviewTypes';

const NOW = '2026-03-01T10:00:00.000Z';

function makeRecord(
  path: string,
  status: ReviewStatus,
  fingerprint: string | null,
  overrides: Partial<FileReviewRecord> = {},
): FileReviewRecord {
  return {
    path,
    previousPath: null,
    status,
    changeKind: 'modified',
    lastReviewedFingerprint: fingerprint,
    lastReviewedComparisonCommit: fingerprint === null ? null : 'commit-reviewed',
    reviewedAt: status === 'Reviewed' ? '2026-02-01T10:00:00.000Z' : null,
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt: '2026-02-01T10:00:00.000Z',
    notes: [],
    ...overrides,
  };
}

function makeEntry(overrides: Partial<DiffEntry>): DiffEntry {
  return {
    status: 'modified',
    oldPath: 'src/a.ts',
    newPath: 'src/a.ts',
    oldFingerprint: 'fp-old',
    newFingerprint: 'fp-new',
    ...overrides,
  };
}

function snapshot(entries: DiffEntry[]) {
  return { baseCommit: 'base-commit', comparisonCommit: 'cmp-commit', entries };
}

describe('detectChanges: новые и неизменённые файлы', () => {
  it('сценарий A: новый файл получает NotReviewed', () => {
    const result = detectChanges({
      previousFiles: [],
      previousHistorical: [],
      snapshot: snapshot([makeEntry({ status: 'added', oldPath: null, oldFingerprint: null })]),
      now: NOW,
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.status).toBe('NotReviewed');
    expect(result.files[0]?.path).toBe('src/a.ts');
    expect(result.files[0]?.changeKind).toBe('added');
    expect(result.files[0]?.lastReviewedFingerprint).toBeNull();
    expect(result.addedPaths).toEqual(['src/a.ts']);
  });

  it('сценарий B: неизменённый Reviewed остаётся Reviewed', () => {
    const record = makeRecord('src/a.ts', 'Reviewed', 'fp-new', {
      reviewedAt: '2026-02-01T10:00:00.000Z',
      updatedAt: '2026-02-01T10:00:00.000Z',
    });
    const result = detectChanges({
      previousFiles: [record],
      previousHistorical: [],
      snapshot: snapshot([makeEntry({ oldFingerprint: 'fp-base', newFingerprint: 'fp-new' })]),
      now: NOW,
    });
    expect(result.files[0]?.status).toBe('Reviewed');
    expect(result.files[0]?.updatedAt).toBe('2026-02-01T10:00:00.000Z');
    expect(result.stalePaths).toHaveLength(0);
  });

  it('неизменённый InProgress остаётся InProgress', () => {
    const record = makeRecord('src/a.ts', 'InProgress', 'fp-new');
    const result = detectChanges({
      previousFiles: [record],
      previousHistorical: [],
      snapshot: snapshot([makeEntry({ newFingerprint: 'fp-new' })]),
      now: NOW,
    });
    expect(result.files[0]?.status).toBe('InProgress');
  });

  it('неизменённый NotReviewed остаётся NotReviewed', () => {
    const record = makeRecord('src/a.ts', 'NotReviewed', null);
    const result = detectChanges({
      previousFiles: [record],
      previousHistorical: [],
      snapshot: snapshot([makeEntry({ newFingerprint: 'fp-any' })]),
      now: NOW,
    });
    expect(result.files[0]?.status).toBe('NotReviewed');
    expect(result.files[0]?.updatedAt).toBe(record.updatedAt);
  });

  it('новый коммит без изменений в Reviewed-файле не инвалидирует проверку', () => {
    const reviewed = makeRecord('src/keep.ts', 'Reviewed', 'fp-keep');
    const result = detectChanges({
      previousFiles: [reviewed],
      previousHistorical: [],
      snapshot: snapshot([
        makeEntry({ oldPath: 'src/keep.ts', newPath: 'src/keep.ts', oldFingerprint: 'fp-base', newFingerprint: 'fp-keep' }),
        makeEntry({
          status: 'added',
          oldPath: null,
          newPath: 'src/other.ts',
          oldFingerprint: null,
          newFingerprint: 'fp-other',
        }),
      ]),
      now: NOW,
    });
    const kept = result.files.find((file) => file.path === 'src/keep.ts');
    const added = result.files.find((file) => file.path === 'src/other.ts');
    expect(kept?.status).toBe('Reviewed');
    expect(added?.status).toBe('NotReviewed');
    expect(result.stalePaths).toHaveLength(0);
  });
});

describe('detectChanges: инвалидация устаревших проверок', () => {
  it('сценарий C: изменённый Reviewed становится NeedsReReview', () => {
    const record = makeRecord('src/a.ts', 'Reviewed', 'fp-reviewed');
    const result = detectChanges({
      previousFiles: [record],
      previousHistorical: [],
      snapshot: snapshot([makeEntry({ newFingerprint: 'fp-changed' })]),
      now: NOW,
    });
    expect(result.files[0]?.status).toBe('NeedsReReview');
    expect(result.stalePaths).toEqual(['src/a.ts']);
    expect(result.files[0]?.lastReviewedFingerprint).toBe('fp-reviewed');
    expect(result.files[0]?.reviewedAt).toBe(record.reviewedAt);
  });

  it('сценарий D: изменённый InProgress требует повторной проверки', () => {
    const record = makeRecord('src/a.ts', 'InProgress', 'fp-reviewed');
    const result = detectChanges({
      previousFiles: [record],
      previousHistorical: [],
      snapshot: snapshot([makeEntry({ newFingerprint: 'fp-changed' })]),
      now: NOW,
    });
    expect(result.files[0]?.status).toBe('NeedsReReview');
    expect(result.stalePaths).toEqual(['src/a.ts']);
  });

  it('ранее устаревший файл не становится Reviewed автоматически', () => {
    const stale = makeRecord('src/a.ts', 'NeedsReReview', 'fp-reviewed');
    const unchanged = detectChanges({
      previousFiles: [stale],
      previousHistorical: [],
      snapshot: snapshot([makeEntry({ newFingerprint: 'fp-changed' })]),
      now: NOW,
    });
    expect(unchanged.files[0]?.status).toBe('NeedsReReview');
    const changedAgain = detectChanges({
      previousFiles: [stale],
      previousHistorical: [],
      snapshot: snapshot([makeEntry({ newFingerprint: 'fp-changed-2' })]),
      now: NOW,
    });
    expect(changedAgain.files[0]?.status).toBe('NeedsReReview');
  });

  it('заметки сохраняются при инвалидации проверки', () => {
    const note = {
      id: 'note-1',
      text: 'проверить логику',
      createdAt: NOW,
      updatedAt: NOW,
      anchor: null,
    };
    const record = makeRecord('src/a.ts', 'Reviewed', 'fp-reviewed', { notes: [note] });
    const result = detectChanges({
      previousFiles: [record],
      previousHistorical: [],
      snapshot: snapshot([makeEntry({ newFingerprint: 'fp-changed' })]),
      now: NOW,
    });
    expect(result.files[0]?.status).toBe('NeedsReReview');
    expect(result.files[0]?.notes).toHaveLength(1);
    expect(result.files[0]?.notes[0]?.text).toBe('проверить логику');
  });
});

describe('detectChanges: удаление и переименование', () => {
  it('сценарий F: удалённый файл получает changeKind deleted и уходит из Reviewed', () => {
    const record = makeRecord('README.md', 'Reviewed', 'fp-reviewed-content');
    const result = detectChanges({
      previousFiles: [record],
      previousHistorical: [],
      snapshot: snapshot([
        makeEntry({
          status: 'deleted',
          oldPath: 'README.md',
          newPath: null,
          oldFingerprint: 'fp-base-side',
          newFingerprint: null,
        }),
      ]),
      now: NOW,
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.changeKind).toBe('deleted');
    expect(result.files[0]?.path).toBe('README.md');
    expect(result.files[0]?.status).toBe('NeedsReReview');
  });

  it('удаление, проверенное ранее, остаётся Reviewed, если не изменилось', () => {
    const record = makeRecord('gone.ts', 'Reviewed', 'fp-base-side');
    const result = detectChanges({
      previousFiles: [record],
      previousHistorical: [],
      snapshot: snapshot([
        makeEntry({
          status: 'deleted',
          oldPath: 'gone.ts',
          newPath: null,
          oldFingerprint: 'fp-base-side',
          newFingerprint: null,
        }),
      ]),
      now: NOW,
    });
    expect(result.files[0]?.status).toBe('Reviewed');
  });

  it('сценарий G: переименование переносит состояние и заметки', () => {
    const note = {
      id: 'note-r',
      text: 'старое имя',
      createdAt: NOW,
      updatedAt: NOW,
      anchor: null,
    };
    const record = makeRecord('src/old.ts', 'Reviewed', 'fp-same-content', { notes: [note] });
    const result = detectChanges({
      previousFiles: [record],
      previousHistorical: [],
      snapshot: snapshot([
        makeEntry({
          status: 'renamed',
          oldPath: 'src/old.ts',
          newPath: 'src/new.ts',
          oldFingerprint: 'fp-base-side',
          newFingerprint: 'fp-same-content',
        }),
      ]),
      now: NOW,
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe('src/new.ts');
    expect(result.files[0]?.previousPath).toBe('src/old.ts');
    expect(result.files[0]?.status).toBe('Reviewed');
    expect(result.files[0]?.notes).toHaveLength(1);
    expect(result.files).toHaveLength(1);
    expect(result.historical).toHaveLength(0);
  });

  it('переименование с изменением содержимого делает файл NeedsReReview', () => {
    const record = makeRecord('src/old.ts', 'Reviewed', 'fp-before');
    const result = detectChanges({
      previousFiles: [record],
      previousHistorical: [],
      snapshot: snapshot([
        makeEntry({
          status: 'renamed',
          oldPath: 'src/old.ts',
          newPath: 'src/new.ts',
          oldFingerprint: 'fp-base-side',
          newFingerprint: 'fp-after',
        }),
      ]),
      now: NOW,
    });
    expect(result.files[0]?.path).toBe('src/new.ts');
    expect(result.files[0]?.status).toBe('NeedsReReview');
  });

  it('неоднозначное переименование не создаёт дубликат активной записи', () => {
    const oldRecord = makeRecord('src/old.ts', 'Reviewed', 'fp-x', {
      notes: [
        { id: 'n1', text: 'старая', createdAt: NOW, updatedAt: NOW, anchor: null },
      ],
    });
    const newRecord = makeRecord('src/new.ts', 'InProgress', null, {
      notes: [{ id: 'n2', text: 'новая', createdAt: NOW, updatedAt: NOW, anchor: null }],
    });
    const result = detectChanges({
      previousFiles: [oldRecord, newRecord],
      previousHistorical: [],
      snapshot: snapshot([
        makeEntry({
          status: 'renamed',
          oldPath: 'src/old.ts',
          newPath: 'src/new.ts',
          oldFingerprint: 'fp-base',
          newFingerprint: 'fp-x',
        }),
      ]),
      now: NOW,
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe('src/new.ts');
    expect(result.files[0]?.notes[0]?.id).toBe('n2');
    expect(result.historical).toHaveLength(1);
    expect(result.historical[0]?.path).toBe('src/old.ts');
    expect(result.historical[0]?.notes[0]?.text).toBe('старая');
  });
});

describe('detectChanges: пустые и изменившиеся сравнения', () => {
  it('сценарий H: пустое сравнение даёт пустой активный список', () => {
    const record = makeRecord('src/a.ts', 'Reviewed', 'fp');
    const result = detectChanges({
      previousFiles: [record],
      previousHistorical: [],
      snapshot: snapshot([]),
      now: NOW,
    });
    expect(result.files).toHaveLength(0);
    expect(result.historical).toHaveLength(1);
    expect(result.archivedPaths).toEqual(['src/a.ts']);
  });

  it('полностью пустой вход даёт пустой результат без ошибок', () => {
    const result = detectChanges({
      previousFiles: [],
      previousHistorical: [],
      snapshot: snapshot([]),
      now: NOW,
    });
    expect(result.files).toHaveLength(0);
    expect(result.historical).toHaveLength(0);
    expect(result.addedPaths).toHaveLength(0);
    expect(result.stalePaths).toHaveLength(0);
  });

  it('сценарий I: без предыдущих записей все файлы инициализируются заново', () => {
    const result = detectChanges({
      previousFiles: [],
      previousHistorical: [],
      snapshot: snapshot([
        makeEntry({ newFingerprint: 'fp1' }),
        makeEntry({ oldPath: 'b.ts', newPath: 'b.ts', newFingerprint: 'fp2' }),
      ]),
      now: NOW,
    });
    expect(result.files.map((file) => file.status)).toEqual(['NotReviewed', 'NotReviewed']);
    expect(result.addedPaths).toEqual(['src/a.ts', 'b.ts']);
  });

  it('сценарий J: файл вне активного diff уходит в историю с заметками', () => {
    const record = makeRecord('src/old-feature.ts', 'Reviewed', 'fp', {
      notes: [{ id: 'n', text: 'важно', createdAt: NOW, updatedAt: NOW, anchor: null }],
    });
    const result = detectChanges({
      previousFiles: [record],
      previousHistorical: [],
      snapshot: snapshot([
        makeEntry({ oldPath: 'src/unrelated.ts', newPath: 'src/unrelated.ts' }),
      ]),
      now: NOW,
    });
    expect(result.files.map((file) => file.path)).toEqual(['src/unrelated.ts']);
    expect(result.historical).toHaveLength(1);
    expect(result.historical[0]?.path).toBe('src/old-feature.ts');
    expect(result.historical[0]?.notes).toHaveLength(1);
    expect(result.historical[0]?.status).toBe('Reviewed');
  });

  it('архивная запись возвращается в актив при повторном появлении', () => {
    const archived = makeRecord('src/back.ts', 'NeedsReReview', 'fp-old', {
      notes: [{ id: 'n', text: 'вернулась', createdAt: NOW, updatedAt: NOW, anchor: null }],
    });
    const result = detectChanges({
      previousFiles: [],
      previousHistorical: [archived],
      snapshot: snapshot([makeEntry({ oldPath: 'src/back.ts', newPath: 'src/back.ts' })]),
      now: NOW,
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.status).toBe('NeedsReReview');
    expect(result.files[0]?.notes[0]?.text).toBe('вернулась');
    expect(result.restoredPaths).toEqual(['src/back.ts']);
    expect(result.historical).toHaveLength(0);
  });
});
