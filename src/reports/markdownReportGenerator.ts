import { AnchorResolution } from '../notes/noteTypes';
import { calculateProgress } from '../review/reviewProgress';
import { ChangeKind, FileReviewRecord, ReviewSession } from '../review/reviewTypes';

export interface ReportOptions {
  generatedAt: string;
  extraLimitations?: string[];
}

const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  added: 'добавлен',
  modified: 'изменён',
  deleted: 'удалён',
  renamed: 'переименован',
  copied: 'скопирован',
};

const ANCHOR_RESOLUTION_LABELS: Record<AnchorResolution, string> = {
  resolved: 'привязан к текущей строке',
  ambiguous: 'неоднозначен — требуется ручная проверка',
  missing: 'строка не найдена — требуется ручная проверка',
};

const BASE_LIMITATIONS = [
  'Данные получены из локального Git: удалённые ветки не обновляются автоматически, fetch не выполняется.',
  'Прогресс считается на уровне файлов, а не отдельных строк.',
  'Заметки хранятся локально в репозитории и не синхронизируются между участниками.',
];

export function escapeProse(text: string): string {
  return text.replace(/[\\`*_[\]<>#]/g, '\\$&');
}

export function codeSpan(text: string): string {
  if (!text.includes('`')) {
    return `\`${text}\``;
  }
  const runs = text.match(/`+/g);
  const longest = runs === null ? 0 : Math.max(...runs.map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence} ${text} ${fence}`;
}

function quoteBlock(text: string): string[] {
  const escaped = escapeProse(text);
  return escaped.split('\n').map((line) => `> ${line}`);
}

function describeRecord(record: FileReviewRecord): string {
  let parts = codeSpan(record.path);
  parts += ` — ${CHANGE_KIND_LABELS[record.changeKind]}`;
  if (record.previousPath !== null && record.changeKind !== 'modified') {
    parts += ` из ${codeSpan(record.previousPath)}`;
  }
  if (record.reviewedAt !== null) {
    parts += `, последняя проверка: ${record.reviewedAt}`;
  }
  if (record.notes.length > 0) {
    parts += `, заметок: ${record.notes.length}`;
  }
  return `- ${parts}`;
}

export function generateMarkdownReport(
  session: ReviewSession,
  options: ReportOptions,
): string {
  const stats = calculateProgress(session.files);
  const unresolved = stats.notReviewed + stats.inProgress + stats.needsReReview;
  const lines: string[] = [];

  const section = (title: string): void => {
    lines.push('');
    lines.push(`## ${title}`);
    lines.push('');
  };

  const recordSection = (title: string, records: FileReviewRecord[], emptyText: string): void => {
    section(title);
    if (records.length === 0) {
      lines.push(emptyText);
      return;
    }
    for (const record of records) {
      lines.push(describeRecord(record));
    }
  };

  lines.push('# PR Navigator — отчёт о проверке');
  lines.push('');
  lines.push('## Информация о проверке');
  lines.push('');
  lines.push(`- Репозиторий: ${escapeProse(session.repository.name)}`);
  lines.push(`- Путь: ${escapeProse(session.repository.root)}`);
  lines.push(`- Базовая ссылка: ${escapeProse(session.baseRef)}`);
  lines.push(`- Сравниваемая ссылка: ${escapeProse(session.comparisonRef)}`);
  lines.push(
    `- Базовый коммит: ${session.baseCommit ?? 'не определён (сравнение не рассчитано)'}`,
  );
  lines.push(
    `- Коммит сравнения: ${session.comparisonCommit ?? 'не определён (сравнение не рассчитано)'}`,
  );
  lines.push(`- Проверка создана: ${session.createdAt}`);
  lines.push(`- Последнее обновление: ${session.updatedAt}`);
  lines.push(`- Отчёт сформирован: ${options.generatedAt}`);

  section('Прогресс');
  lines.push(`- Всего файлов: ${stats.total}`);
  lines.push(`- Проверено: ${stats.reviewed}`);
  lines.push(`- В процессе: ${stats.inProgress}`);
  lines.push(`- Не просмотрено: ${stats.notReviewed}`);
  lines.push(`- Требует повторной проверки: ${stats.needsReReview}`);
  lines.push(`- Выполнение: ${stats.percentage}%`);
  if (stats.total === 0) {
    lines.push('- Состояние: в выбранном сравнении нет изменённых файлов');
  } else if (unresolved === 0) {
    lines.push('- Состояние: проверка завершена — все файлы отмечены как проверенные');
  } else {
    lines.push(`- Состояние: проверка НЕ завершена — файлов с незавершённой обработкой: ${unresolved}`);
  }

  recordSection(
    'Файлы, требующие повторной проверки',
    session.files.filter((record) => record.status === 'NeedsReReview'),
    '_Список пуст._',
  );
  recordSection(
    'Не просмотренные файлы',
    session.files.filter((record) => record.status === 'NotReviewed'),
    '_Список пуст._',
  );
  recordSection(
    'Файлы в процессе проверки',
    session.files.filter((record) => record.status === 'InProgress'),
    '_Список пуст._',
  );
  recordSection(
    'Проверенные файлы',
    session.files.filter((record) => record.status === 'Reviewed'),
    '_Список пуст._',
  );

  section('Заметки и наблюдения');
  const filesWithNotes = [...session.files, ...session.historical].filter(
    (record) => record.notes.length > 0,
  );
  if (filesWithNotes.length === 0) {
    lines.push('_Заметок нет._');
  } else {
    for (const record of filesWithNotes) {
      lines.push(`### ${codeSpan(record.path)}`);
      lines.push('');
      for (const note of record.notes) {
        if (note.anchor === null) {
          lines.push(...quoteBlock(note.text));
        } else {
          const anchor = note.anchor;
          const sideLabel = anchor.side === 'new' ? 'новая сторона' : 'старая сторона';
          const resolvedLabel =
            anchor.resolution === 'resolved' && anchor.resolvedLine !== null
              ? anchor.resolvedLine === anchor.line
                ? `строка ${anchor.line}`
                : `строка ${anchor.line} → ${anchor.resolvedLine}`
              : `строка ${anchor.line}`;
          const resolutionSuffix =
            anchor.resolution === 'resolved'
              ? ''
              : ` (якорь: ${ANCHOR_RESOLUTION_LABELS[anchor.resolution]})`;
          const header = `**${resolvedLabel}, ${sideLabel}**${resolutionSuffix}: `;
          const escapedNoteLines = escapeProse(note.text).split('\n');
          lines.push(`> ${header}${escapedNoteLines[0] ?? ''}`);
          for (const continuation of escapedNoteLines.slice(1)) {
            lines.push(`> ${continuation}`);
          }
        }
        lines.push('');
      }
    }
  }

  const allRecords = [...session.files, ...session.historical];
  const unresolvedAnchors = allRecords.flatMap((record) =>
    record.notes
      .filter((note) => note.anchor !== null && note.anchor.resolution !== 'resolved')
      .map((note) => ({ record, note })),
  );
  const deletedRecords = session.files.filter((record) => record.changeKind === 'deleted');
  const renamedRecords = session.files.filter(
    (record) => record.changeKind === 'renamed' || record.changeKind === 'copied',
  );

  section('Дополнительное внимание');
  const attention: string[] = [];
  for (const { record, note } of unresolvedAnchors) {
    attention.push(
      `- ${codeSpan(record.path)}: заметка «${escapeProse(note.text)}» — якорь не разрешён`,
    );
  }
  for (const record of deletedRecords) {
    attention.push(`- Удалённый файл: ${codeSpan(record.path)}`);
  }
  for (const record of renamedRecords) {
    attention.push(
      `- Переименованный файл: ${codeSpan(record.previousPath ?? record.path)} → ${codeSpan(record.path)}`,
    );
  }
  if (session.historical.length > 0) {
    attention.push(
      `- Архивных файлов вне активного сравнения: ${session.historical.length} (см. раздел «Архивные файлы»)`,
    );
  }
  if (attention.length === 0) {
    lines.push('_Нет._');
  } else {
    lines.push(...attention);
  }

  recordSection(
    'Архивные файлы (вне активного сравнения)',
    session.historical,
    '_Нет._',
  );

  section('Предупреждения');
  const warnings: string[] = [];
  if (stats.needsReReview > 0) {
    warnings.push(
      `- Обнаружены файлы, изменившиеся после проверки (${stats.needsReReview}): они не считаются завершёнными.`,
    );
  }
  if (unresolvedAnchors.length > 0) {
    warnings.push(
      '- Часть заметок не привязана к текущим строкам кода (см. раздел «Дополнительное внимание»).',
    );
  }
  if (session.baseCommit === null || session.comparisonCommit === null) {
    warnings.push('- Сведения о коммитах отсутствуют: снимок сравнения не рассчитан.');
  }
  if (session.historical.length > 0) {
    warnings.push(
      '- Часть ранее отслеживаемых файлов вышла из активного сравнения и перенесена в архив.',
    );
  }
  if (unresolved > 0) {
    warnings.push('- Отчёт не подтверждает завершение проверки: остаются незакрытые файлы.');
  }
  if (warnings.length === 0) {
    lines.push('- Предупреждений нет.');
  } else {
    lines.push(...warnings);
  }

  section('Ограничения');
  for (const limitation of [...BASE_LIMITATIONS, ...(options.extraLimitations ?? [])]) {
    lines.push(`- ${limitation}`);
  }

  lines.push('');
  return lines.join('\n');
}
