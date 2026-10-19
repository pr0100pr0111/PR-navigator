import { describe, expect, it } from 'vitest';
import { applyStatusChange, computeReviewId, isReviewStatus } from '../src/review/reviewState';
import { FileReviewRecord, ReviewStatus } from '../src/review/reviewTypes';

function record(status: ReviewStatus): FileReviewRecord {
  return {
    path: 'src/app.ts',
    previousPath: null,
    status,
    changeKind: 'modified',
    lastReviewedFingerprint: 'fp-old',
    lastReviewedComparisonCommit: 'commit-a',
    reviewedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    notes: [
      {
        id: 'note-1',
        text: 'заметка',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        anchor: null,
      },
    ],
  };
}

describe('isReviewStatus', () => {
  it('принимает только четыре поддерживаемых статуса', () => {
    expect(isReviewStatus('NotReviewed')).toBe(true);
    expect(isReviewStatus('InProgress')).toBe(true);
    expect(isReviewStatus('Reviewed')).toBe(true);
    expect(isReviewStatus('NeedsReReview')).toBe(true);
    expect(isReviewStatus('Проверен')).toBe(false);
    expect(isReviewStatus('Done')).toBe(false);
    expect(isReviewStatus(42)).toBe(false);
  });
});

describe('applyStatusChange', () => {
  it('фиксирует отпечаток и коммит при переводе в Reviewed', () => {
    const next = applyStatusChange(record('InProgress'), 'Reviewed', {
      comparisonCommit: 'commit-b',
      currentFingerprint: 'fp-new',
      now: '2026-02-01T00:00:00.000Z',
    });
    expect(next.status).toBe('Reviewed');
    expect(next.lastReviewedFingerprint).toBe('fp-new');
    expect(next.lastReviewedComparisonCommit).toBe('commit-b');
    expect(next.reviewedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(next.updatedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(next.notes).toHaveLength(1);
  });

  it('фиксирует отпечаток и при переводе в InProgress', () => {
    const next = applyStatusChange(record('NeedsReReview'), 'InProgress', {
      comparisonCommit: 'commit-c',
      currentFingerprint: 'fp-c',
      now: '2026-02-02T00:00:00.000Z',
    });
    expect(next.lastReviewedFingerprint).toBe('fp-c');
    expect(next.lastReviewedComparisonCommit).toBe('commit-c');
  });

  it('сохраняет прежний отпечаток при переводе в NeedsReReview', () => {
    const next = applyStatusChange(record('Reviewed'), 'NeedsReReview', {
      comparisonCommit: 'commit-z',
      currentFingerprint: 'fp-z',
      now: '2026-02-03T00:00:00.000Z',
    });
    expect(next.status).toBe('NeedsReReview');
    expect(next.lastReviewedFingerprint).toBe('fp-old');
    expect(next.lastReviewedComparisonCommit).toBe('commit-a');
    expect(next.reviewedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('не изменяет заметки', () => {
    const source = record('Reviewed');
    const next = applyStatusChange(source, 'NotReviewed', {
      comparisonCommit: null,
      currentFingerprint: null,
      now: '2026-02-04T00:00:00.000Z',
    });
    expect(next.notes).toEqual(source.notes);
    expect(next.notes).not.toBe(source.notes);
    expect(source.status).toBe('Reviewed');
  });

  it('не перезаписывает отпечаток, если текущий недоступен', () => {
    const next = applyStatusChange(record('Reviewed'), 'InProgress', {
      comparisonCommit: null,
      currentFingerprint: null,
      now: '2026-02-05T00:00:00.000Z',
    });
    expect(next.lastReviewedFingerprint).toBe('fp-old');
    expect(next.lastReviewedComparisonCommit).toBe('commit-a');
  });
});

describe('computeReviewId', () => {
  it('стабилен для одинаковых входных данных', () => {
    const first = computeReviewId('/repo', 'refs/heads/main', 'refs/heads/feature');
    const second = computeReviewId('/repo', 'refs/heads/main', 'refs/heads/feature');
    expect(first).toBe(second);
    expect(first).toMatch(/^review-[0-9a-f]{24}$/);
  });

  it('различает репозитории и пары ссылок', () => {
    const base = computeReviewId('/repo', 'refs/heads/main', 'refs/heads/feature');
    expect(computeReviewId('/other', 'refs/heads/main', 'refs/heads/feature')).not.toBe(base);
    expect(computeReviewId('/repo', 'refs/heads/main', 'refs/heads/dev')).not.toBe(base);
    expect(computeReviewId('/repo', 'refs/heads/dev', 'refs/heads/feature')).not.toBe(base);
  });
});
