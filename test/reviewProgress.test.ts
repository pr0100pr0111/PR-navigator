import { describe, expect, it } from 'vitest';
import { calculateProgress } from '../src/review/reviewProgress';
import { FileReviewRecord, ReviewStatus } from '../src/review/reviewTypes';

function record(status: ReviewStatus, path = 'file.ts'): FileReviewRecord {
  return {
    path,
    previousPath: null,
    status,
    changeKind: 'modified',
    lastReviewedFingerprint: null,
    lastReviewedComparisonCommit: null,
    reviewedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    notes: [],
  };
}

describe('calculateProgress', () => {
  it('возвращает 0% для пустого списка файлов', () => {
    const stats = calculateProgress([]);
    expect(stats.total).toBe(0);
    expect(stats.percentage).toBe(0);
    expect(stats.reviewed).toBe(0);
  });

  it('один проверенный файл из одного даёт 100%', () => {
    const stats = calculateProgress([record('Reviewed')]);
    expect(stats.total).toBe(1);
    expect(stats.reviewed).toBe(1);
    expect(stats.percentage).toBe(100);
  });

  it('один проверенный файл из двух даёт 50%', () => {
    const stats = calculateProgress([record('Reviewed'), record('NotReviewed')]);
    expect(stats.total).toBe(2);
    expect(stats.reviewed).toBe(1);
    expect(stats.percentage).toBe(50);
  });

  it('InProgress не считается завершённым', () => {
    const stats = calculateProgress([record('InProgress'), record('InProgress')]);
    expect(stats.percentage).toBe(0);
    expect(stats.inProgress).toBe(2);
  });

  it('NotReviewed не считается завершённым', () => {
    const stats = calculateProgress([record('NotReviewed'), record('Reviewed')]);
    expect(stats.percentage).toBe(50);
    expect(stats.notReviewed).toBe(1);
  });

  it('NeedsReReview не считается завершённым', () => {
    const stats = calculateProgress([record('NeedsReReview'), record('Reviewed')]);
    expect(stats.percentage).toBe(50);
    expect(stats.needsReReview).toBe(1);
    expect(stats.reviewed).toBe(1);
  });

  it('пересчитывается после смены статуса', () => {
    const files = [record('Reviewed'), record('NotReviewed', 'b.ts')];
    expect(calculateProgress(files).percentage).toBe(50);
    const updated = files.map((file, index) =>
      index === 1 ? { ...file, status: 'Reviewed' as const } : file,
    );
    expect(calculateProgress(updated).percentage).toBe(100);
    const downgraded = updated.map((file, index) =>
      index === 0 ? { ...file, status: 'NeedsReReview' as const } : file,
    );
    expect(calculateProgress(downgraded).percentage).toBe(50);
  });

  it('процент всегда в диапазоне от 0 до 100', () => {
    const mixed = [
      record('Reviewed'),
      record('Reviewed'),
      record('InProgress'),
      record('NotReviewed'),
      record('NeedsReReview'),
    ];
    const stats = calculateProgress(mixed);
    expect(stats.percentage).toBeGreaterThanOrEqual(0);
    expect(stats.percentage).toBeLessThanOrEqual(100);
    expect(stats.percentage).toBe(40);
    expect(stats.notReviewed + stats.inProgress + stats.reviewed + stats.needsReReview).toBe(
      stats.total,
    );
  });

  it('округляет вверх при частичной доле', () => {
    const files = [record('Reviewed'), record('NotReviewed'), record('NotReviewed')];
    expect(calculateProgress(files).percentage).toBe(33);
  });
});
