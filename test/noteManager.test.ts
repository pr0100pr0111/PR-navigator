import { describe, expect, it } from 'vitest';
import { createLineAnchor, resolveLineAnchor, toLines } from '../src/notes/anchorResolver';
import {
  createFileNote,
  createLineNote,
  findNote,
  refreshNoteAnchors,
  removeNote,
  updateNoteText,
} from '../src/notes/noteManager';

const NOW = '2026-04-01T12:00:00.000Z';
const LATER = '2026-04-02T12:00:00.000Z';

const SOURCE = [
  'function alpha() {',
  '  const value = 1;',
  '  return value;',
  '}',
  '',
  'function beta() {',
  '  const value = 2;',
  '  return value;',
  '}',
  'const shared = compute();',
  'const other = 42;',
].join('\n');

describe('заметки: создание и редактирование', () => {
  it('создаёт файловую заметку', () => {
    const note = createFileNote('общее наблюдение', NOW);
    expect(note.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(note.text).toBe('общее наблюдение');
    expect(note.createdAt).toBe(NOW);
    expect(note.updatedAt).toBe(NOW);
    expect(note.anchor).toBeNull();
  });

  it('создаёт заметку к строке с якорем', () => {
    const note = createLineNote('проверить вычисление', SOURCE, 9, 'new', NOW);
    expect(note.anchor).not.toBeNull();
    expect(note.anchor?.side).toBe('new');
    expect(note.anchor?.line).toBe(10);
    expect(note.anchor?.lineText).toBe('const shared = compute();');
    expect(note.anchor?.contextBefore).toEqual(['  const value = 2;', '  return value;', '}']);
    expect(note.anchor?.contextAfter).toEqual(['const other = 42;']);
    expect(note.anchor?.resolution).toBe('resolved');
    expect(note.anchor?.resolvedLine).toBe(10);
    expect(note.anchor?.contextHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('редактирует заметку, сохраняя идентификатор и момент создания', () => {
    const note = createFileNote('первый текст', NOW);
    const updated = updateNoteText(note, 'второй текст', LATER);
    expect(updated.id).toBe(note.id);
    expect(updated.createdAt).toBe(NOW);
    expect(updated.updatedAt).toBe(LATER);
    expect(updated.text).toBe('второй текст');
    expect(note.text).toBe('первый текст');
  });

  it('удаляет заметку и отклоняет неизвестный идентификатор', () => {
    const first = createFileNote('первая', NOW);
    const second = createFileNote('вторая', NOW);
    const remaining = removeNote([first, second], first.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(second.id);
    expect(() => removeNote([second], 'missing-id')).toThrow('Заметка не найдена.');
    expect(findNote([second], second.id)?.text).toBe('вторая');
    expect(findNote([second], 'missing')).toBeNull();
  });

  it('отклоняет пустой текст заметки', () => {
    expect(() => createFileNote('   ', NOW)).toThrow('не может быть пустым');
    expect(() => updateNoteText(createFileNote('x', NOW), ' ', LATER)).toThrow(
      'не может быть пустым',
    );
  });

  it('сохраняет текст со специальными символами Markdown без изменений', () => {
    const tricky = '# заголовок *жирный* [ссылка](url) `код` _курсив_ > цитата | таблица';
    const note = createFileNote(tricky, NOW);
    expect(note.text).toBe(tricky);
    expect(updateNoteText(note, tricky, LATER).text).toBe(tricky);
  });

  it('ошибка при создании заметки к несуществующей строке', () => {
    expect(() => createLineNote('x', SOURCE, 999, 'new', NOW)).toThrow('не существует');
  });
});

describe('разрешение якорей', () => {
  const anchor = createLineAnchor(toLines(SOURCE), 9, 'new');

  it('уникальная строка разрешается однозначно', () => {
    const result = resolveLineAnchor(toLines(SOURCE), anchor);
    expect(result.resolution).toBe('resolved');
    expect(result.resolvedLine).toBe(10);
  });

  it('якорь остаётся разрешаемым после вставки несвязанных строк', () => {
    const modified = ['// новый блок', 'const inserted = true;', '', ...toLines(SOURCE)].join('\n');
    const result = resolveLineAnchor(toLines(modified), anchor);
    expect(result.resolution).toBe('resolved');
    expect(result.resolvedLine).toBe(13);
  });

  it('неоднозначный якорь не привязывается к чужой строке молча', () => {
    const duplicated = ['const shared = compute();', 'const shared = compute();'].join('\n');
    const result = resolveLineAnchor(toLines(duplicated), anchor);
    expect(result.resolution).toBe('ambiguous');
    expect(result.resolvedLine).toBeNull();
  });

  it('контекст разрешает неоднозначность между одинаковыми строками', () => {
    const modified = [
      'function alpha() {',
      '  const value = 1;',
      '  return value;',
      '}',
      '',
      'function beta() {',
      '  const value = 2;',
      '  return value;',
      '}',
      'const shared = compute();',
      'const other = 42;',
      'const shared = compute();',
      'let trailing = true;',
    ].join('\n');
    const result = resolveLineAnchor(toLines(modified), anchor);
    expect(result.resolution).toBe('resolved');
    expect(result.resolvedLine).toBe(10);
  });

  it('удалённая строка даёт missing без потери исходной информации', () => {
    const modified = ['const other = 42;', 'const unrelated = 1;'].join('\n');
    const result = resolveLineAnchor(toLines(modified), anchor);
    expect(result.resolution).toBe('missing');
    expect(result.resolvedLine).toBeNull();
    expect(anchor.line).toBe(10);
    expect(anchor.lineText).toBe('const shared = compute();');
  });

  it('пустое содержимое даёт missing', () => {
    expect(resolveLineAnchor([], anchor).resolution).toBe('missing');
  });

  it('строка в начале файла без контекста разрешается при единственном вхождении', () => {
    const topAnchor = createLineAnchor(['first line', 'second line'], 0, 'old');
    expect(resolveLineAnchor(['first line', 'changed'], topAnchor)).toEqual({
      resolution: 'resolved',
      resolvedLine: 1,
    });
    expect(resolveLineAnchor(['first line', 'first line'], topAnchor).resolution).toBe('ambiguous');
  });

  it('сторона якоря сохраняется', () => {
    const oldAnchor = createLineAnchor(toLines(SOURCE), 0, 'old');
    expect(oldAnchor.side).toBe('old');
    expect(resolveLineAnchor(toLines(SOURCE), oldAnchor).resolvedLine).toBe(1);
  });
});

describe('обновление якорей при изменениях файла', () => {
  const lineNote = createLineNote('привязка', SOURCE, 9, 'new', NOW);
  const fileNote = createFileNote('файловая', NOW);

  it('без изменений якоря обновление ничего не меняет', () => {
    const outcome = refreshNoteAnchors([fileNote, lineNote], SOURCE, SOURCE);
    expect(outcome.changed).toBe(false);
    expect(outcome.notes[1]).toBe(lineNote);
  });

  it('вставка строк сдвигает resolvedLine и помечает изменение', () => {
    const modified = `const header = 1;\n${SOURCE}`;
    const outcome = refreshNoteAnchors([lineNote], modified, null);
    expect(outcome.changed).toBe(true);
    expect(outcome.notes[0]?.anchor?.resolution).toBe('resolved');
    expect(outcome.notes[0]?.anchor?.resolvedLine).toBe(11);
    expect(outcome.notes[0]?.anchor?.line).toBe(10);
    expect(outcome.notes[0]?.text).toBe('привязка');
    expect(lineNote.anchor?.resolvedLine).toBe(10);
  });

  it('удаление строки переводит якорь в missing, заметка сохраняется', () => {
    const modified = ['const other = 42;'].join('\n');
    const outcome = refreshNoteAnchors([lineNote], modified, null);
    expect(outcome.changed).toBe(true);
    expect(outcome.notes).toHaveLength(1);
    expect(outcome.notes[0]?.anchor?.resolution).toBe('missing');
    expect(outcome.notes[0]?.text).toBe('привязка');
  });

  it('недоступная сторона файла переводит якорь в missing', () => {
    const outcome = refreshNoteAnchors([lineNote], null, null);
    expect(outcome.changed).toBe(true);
    expect(outcome.notes[0]?.anchor?.resolution).toBe('missing');
    const again = refreshNoteAnchors(outcome.notes, null, null);
    expect(again.changed).toBe(false);
  });

  it('заметки к строкам старой стороны разрешаются по старому содержимому', () => {
    const oldNote = createLineNote('старая сторона', SOURCE, 0, 'old', NOW);
    const baseContent = `extra line\n${SOURCE}`;
    const outcome = refreshNoteAnchors([oldNote], null, baseContent);
    expect(outcome.notes[0]?.anchor?.resolvedLine).toBe(2);
  });
});
