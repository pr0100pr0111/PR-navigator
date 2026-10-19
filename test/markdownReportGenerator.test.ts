import { describe, expect, it } from 'vitest';
import {
  codeSpan,
  escapeProse,
  generateMarkdownReport,
} from '../src/reports/markdownReportGenerator';
import { ReviewSession, REVIEW_SCHEMA_VERSION } from '../src/review/reviewTypes';

function section(markdown: string, title: string): string {
  const marker = `## ${title}`;
  const start = markdown.indexOf(marker);
  if (start === -1) {
    return '';
  }
  const rest = markdown.slice(start + marker.length);
  const next = rest.indexOf('\n## ');
  return next === -1 ? rest : rest.slice(0, next);
}

function makeSession(): ReviewSession {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    id: 'review-report-test',
    repository: { root: '/work/example-repo', name: 'example-repo' },
    baseRef: 'refs/heads/main',
    comparisonRef: 'refs/heads/feature',
    baseCommit: 'aaaa11112222333344445555666677778888999a',
    comparisonCommit: 'bbbb11112222333344445555666677778888999b',
    createdAt: '2026-05-01T09:00:00.000Z',
    updatedAt: '2026-05-02T10:00:00.000Z',
    files: [
      {
        path: 'src/app.ts',
        previousPath: null,
        status: 'Reviewed',
        changeKind: 'modified',
        lastReviewedFingerprint: 'fp-app',
        lastReviewedComparisonCommit: 'bbbb11112222333344445555666677778888999b',
        reviewedAt: '2026-05-02T09:30:00.000Z',
        createdAt: '2026-05-01T09:05:00.000Z',
        updatedAt: '2026-05-02T09:30:00.000Z',
        notes: [
          {
            id: 'note-1',
            text: '# заголовок *важно* [ссылка](x)',
            createdAt: '2026-05-02T09:31:00.000Z',
            updatedAt: '2026-05-02T09:31:00.000Z',
            anchor: null,
          },
          {
            id: 'note-2',
            text: 'Проверить логику\nи обработать ошибки',
            createdAt: '2026-05-02T09:32:00.000Z',
            updatedAt: '2026-05-02T09:32:00.000Z',
            anchor: {
              side: 'new',
              line: 10,
              lineText: 'const value = compute();',
              contextBefore: ['let a = 1;'],
              contextAfter: ['return value;'],
              contextHash: 'hash',
              resolution: 'resolved',
              resolvedLine: 13,
            },
          },
        ],
      },
      {
        path: 'src/b.ts',
        previousPath: null,
        status: 'InProgress',
        changeKind: 'modified',
        lastReviewedFingerprint: 'fp-b',
        lastReviewedComparisonCommit: 'bbbb11112222333344445555666677778888999b',
        reviewedAt: null,
        createdAt: '2026-05-01T09:05:00.000Z',
        updatedAt: '2026-05-01T09:05:00.000Z',
        notes: [],
      },
      {
        path: 'src/c.ts',
        previousPath: null,
        status: 'NotReviewed',
        changeKind: 'modified',
        lastReviewedFingerprint: null,
        lastReviewedComparisonCommit: null,
        reviewedAt: null,
        createdAt: '2026-05-01T09:05:00.000Z',
        updatedAt: '2026-05-01T09:05:00.000Z',
        notes: [],
      },
      {
        path: 'src/d.ts',
        previousPath: null,
        status: 'NeedsReReview',
        changeKind: 'modified',
        lastReviewedFingerprint: 'fp-d-old',
        lastReviewedComparisonCommit: 'aaaa11112222333344445555666677778888999a',
        reviewedAt: '2026-05-01T12:00:00.000Z',
        createdAt: '2026-05-01T09:05:00.000Z',
        updatedAt: '2026-05-02T08:00:00.000Z',
        notes: [],
      },
      {
        path: 'gone.md',
        previousPath: null,
        status: 'NotReviewed',
        changeKind: 'deleted',
        lastReviewedFingerprint: null,
        lastReviewedComparisonCommit: null,
        reviewedAt: null,
        createdAt: '2026-05-01T09:05:00.000Z',
        updatedAt: '2026-05-01T09:05:00.000Z',
        notes: [
          {
            id: 'note-3',
            text: 'Заметка к удалённой строке',
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-01T10:00:00.000Z',
            anchor: {
              side: 'new',
              line: 5,
              lineText: 'removed line',
              contextBefore: [],
              contextAfter: [],
              contextHash: 'hash-2',
              resolution: 'missing',
              resolvedLine: null,
            },
          },
        ],
      },
      {
        path: 'src/renamed.ts',
        previousPath: 'src/old.ts',
        status: 'InProgress',
        changeKind: 'renamed',
        lastReviewedFingerprint: null,
        lastReviewedComparisonCommit: null,
        reviewedAt: null,
        createdAt: '2026-05-01T09:05:00.000Z',
        updatedAt: '2026-05-01T09:05:00.000Z',
        notes: [],
      },
      {
        path: 'docs/special (v2) [draft].md',
        previousPath: null,
        status: 'NotReviewed',
        changeKind: 'added',
        lastReviewedFingerprint: null,
        lastReviewedComparisonCommit: null,
        reviewedAt: null,
        createdAt: '2026-05-01T09:05:00.000Z',
        updatedAt: '2026-05-01T09:05:00.000Z',
        notes: [],
      },
    ],
    historical: [
      {
        path: 'src/hidden.ts',
        previousPath: null,
        status: 'Reviewed',
        changeKind: 'modified',
        lastReviewedFingerprint: 'fp-hidden',
        lastReviewedComparisonCommit: 'aaaa11112222333344445555666677778888999a',
        reviewedAt: '2026-05-01T11:00:00.000Z',
        createdAt: '2026-05-01T09:05:00.000Z',
        updatedAt: '2026-05-01T11:00:00.000Z',
        notes: [
          {
            id: 'note-4',
            text: 'Потерянная привязка',
            createdAt: '2026-05-01T11:01:00.000Z',
            updatedAt: '2026-05-01T11:01:00.000Z',
            anchor: {
              side: 'old',
              line: 7,
              lineText: 'gone with the wind',
              contextBefore: ['x'],
              contextAfter: ['y'],
              contextHash: 'hash-3',
              resolution: 'missing',
              resolvedLine: null,
            },
          },
        ],
      },
    ],
  };
}

const OPTIONS = { generatedAt: '2026-05-03T12:00:00.000Z' };

describe('generateMarkdownReport: метаданные и прогресс', () => {
  const report = generateMarkdownReport(makeSession(), OPTIONS);

  it('содержит метаданные проверки', () => {
    expect(report).toContain('# PR Navigator — отчёт о проверке');
    expect(report).toContain('Репозиторий: example-repo');
    expect(report).toContain('/work/example-repo');
    expect(report).toContain('Базовая ссылка: refs/heads/main');
    expect(report).toContain('Сравниваемая ссылка: refs/heads/feature');
    expect(report).toContain('aaaa11112222333344445555666677778888999a');
    expect(report).toContain('bbbb11112222333344445555666677778888999b');
    expect(report).toContain('Отчёт сформирован: 2026-05-03T12:00:00.000Z');
    expect(report).toContain('Проверка создана: 2026-05-01T09:00:00.000Z');
    expect(report).toContain('Последнее обновление: 2026-05-02T10:00:00.000Z');
  });

  it('содержит корректные счётчики и процент', () => {
    const progress = section(report, 'Прогресс');
    expect(progress).toContain('- Всего файлов: 7');
    expect(progress).toContain('- Проверено: 1');
    expect(progress).toContain('- В процессе: 2');
    expect(progress).toContain('- Не просмотрено: 3');
    expect(progress).toContain('- Требует повторной проверки: 1');
    expect(progress).toContain('- Выполнение: 14%');
  });

  it('не заявляет о завершении незавершённой проверки', () => {
    expect(report).toContain('проверка НЕ завершена');
    expect(report).not.toContain('проверка завершена —');
    expect(section(report, 'Прогресс')).toContain('незавершённой обработкой: 6');
  });

  it('распределяет файлы по разделам статусов', () => {
    expect(section(report, 'Файлы, требующие повторной проверки')).toContain('`src/d.ts`');
    expect(section(report, 'Файлы, требующие повторной проверки')).not.toContain('`src/c.ts`');
    expect(section(report, 'Не просмотренные файлы')).toContain('`src/c.ts`');
    expect(section(report, 'Файлы в процессе проверки')).toContain('`src/b.ts`');
    expect(section(report, 'Проверенные файлы')).toContain('`src/app.ts`');
    expect(section(report, 'Проверенные файлы')).toContain('последняя проверка');
  });
});

describe('generateMarkdownReport: заметки и спецсимволы', () => {
  const report = generateMarkdownReport(makeSession(), OPTIONS);

  it('включает заметки с экранированием Markdown-символов', () => {
    const notes = section(report, 'Заметки и наблюдения');
    expect(notes).toContain('\\# заголовок \\*важно\\* \\[ссылка\\]');
    expect(notes).not.toContain('# заголовок *важно*');
  });

  it('включает ссылки на строки и сдвиг якоря', () => {
    const notes = section(report, 'Заметки и наблюдения');
    expect(notes).toContain('**строка 10 → 13, новая сторона**');
    expect(notes).toContain('Проверить логику');
    expect(notes).toContain('> и обработать ошибки');
  });

  it('указывает неразрешённые якоря как требующие внимания', () => {
    const notes = section(report, 'Заметки и наблюдения');
    expect(notes).toContain('строка не найдена — требуется ручная проверка');
    const attention = section(report, 'Дополнительное внимание');
    expect(attention).toContain('`src/hidden.ts`');
    expect(attention).toContain('якорь не разрешён');
  });

  it('выводит пути со спецсимволами в коде', () => {
    expect(report).toContain('`docs/special (v2) [draft].md`');
    expect(codeSpan('plain path.ts')).toBe('`plain path.ts`');
    expect(codeSpan('with `back` tick')).toBe('`` with `back` tick ``');
  });

  it('экранирует текст без повреждения содержимого', () => {
    const source = 'a_b*c[d]e<f>g#h+i-j!k|l~m\\n';
    const escaped = escapeProse(source);
    expect(escaped).toBe('a\\_b\\*c\\[d\\]e\\<f\\>g\\#h+i-j!k|l~m\\\\n');
    expect(escaped.length).toBeGreaterThan(source.length);
  });
});

describe('generateMarkdownReport: предупреждения и ограничения', () => {
  const report = generateMarkdownReport(makeSession(), OPTIONS);

  it('предупреждает об устаревшей проверке и удалённых файлах', () => {
    const warnings = section(report, 'Предупреждения');
    expect(warnings).toContain('изменившиеся после проверки (1)');
    expect(warnings).toContain('не привязана к текущим строкам кода');
    expect(warnings).toContain('перенесена в архив');
    expect(warnings).toContain('не подтверждает завершение проверки');
  });

  it('перечисляет удалённые и переименованные файлы', () => {
    const attention = section(report, 'Дополнительное внимание');
    expect(attention).toContain('Удалённый файл: `gone.md`');
    expect(attention).toContain('Переименованный файл: `src/old.ts` → `src/renamed.ts`');
  });

  it('выводит архивные файлы отдельно', () => {
    const archive = section(report, 'Архивные файлы (вне активного сравнения)');
    expect(archive).toContain('`src/hidden.ts`');
    expect(archive).toContain('заметок: 1');
  });

  it('содержит раздел ограничений', () => {
    const limitations = section(report, 'Ограничения');
    expect(limitations).toContain('локального Git');
    expect(limitations).toContain('уровне файлов');
    expect(generateMarkdownReport(makeSession(), {
      generatedAt: OPTIONS.generatedAt,
      extraLimitations: ['Дополнительное ограничение.'],
    })).toContain('Дополнительное ограничение.');
  });
});

describe('generateMarkdownReport: крайние случаи', () => {
  it('пустая проверка даёт корректный отчёт', () => {
    const session = makeSession();
    session.files = [];
    session.historical = [];
    const report = generateMarkdownReport(session, OPTIONS);
    expect(report).toContain('- Всего файлов: 0');
    expect(report).toContain('- Выполнение: 0%');
    expect(report).toContain('нет изменённых файлов');
    expect(report).toContain('## Файлы, требующие повторной проверки');
    expect(report).toContain('_Список пуст._');
    expect(report).toContain('_Заметок нет._');
    expect(report).not.toContain('НЕ завершена');
    expect(report).not.toContain('проверка завершена —');
  });

  it('завершённая проверка помечается как завершённая', () => {
    const session = makeSession();
    for (const record of session.files) {
      record.status = 'Reviewed';
    }
    session.historical = [];
    const report = generateMarkdownReport(session, OPTIONS);
    expect(report).toContain('проверка завершена — все файлы');
    expect(report).not.toContain('НЕ завершена');
    expect(section(report, 'Предупреждения')).toContain('не привязана к текущим строкам');
    expect(section(report, 'Предупреждения')).not.toContain('не подтверждает завершение');
    expect(section(report, 'Дополнительное внимание')).toContain('Удалённый файл');
  });

  it('предупреждает, если сравнение не рассчитано', () => {
    const session = makeSession();
    session.baseCommit = null;
    session.comparisonCommit = null;
    const report = generateMarkdownReport(session, OPTIONS);
    expect(report).toContain('снимок сравнения не рассчитан');
    expect(report).toContain('не определён');
  });

  it('завершается переводом строки', () => {
    const report = generateMarkdownReport(makeSession(), OPTIONS);
    expect(report.endsWith('\n')).toBe(true);
  });
});
