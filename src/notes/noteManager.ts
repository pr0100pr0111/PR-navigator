import { randomUUID } from 'node:crypto';
import { AnchorSide, ReviewNote } from './noteTypes';
import {
  AnchorResolutionResult,
  createLineAnchor,
  resolveLineAnchor,
  toLines,
} from './anchorResolver';

export function ensureNoteText(text: string): string {
  if (text.trim() === '') {
    throw new Error('Текст заметки не может быть пустым.');
  }
  return text;
}

export function createFileNote(text: string, now: string): ReviewNote {
  return {
    id: randomUUID(),
    text: ensureNoteText(text),
    createdAt: now,
    updatedAt: now,
    anchor: null,
  };
}

export function createLineNote(
  text: string,
  content: string,
  lineIndex: number,
  side: AnchorSide,
  now: string,
): ReviewNote {
  const anchor = createLineAnchor(toLines(content), lineIndex, side);
  return {
    id: randomUUID(),
    text: ensureNoteText(text),
    createdAt: now,
    updatedAt: now,
    anchor,
  };
}

export function updateNoteText(note: ReviewNote, text: string, now: string): ReviewNote {
  return { ...note, text: ensureNoteText(text), updatedAt: now };
}

export function findNote(notes: readonly ReviewNote[], noteId: string): ReviewNote | null {
  return notes.find((note) => note.id === noteId) ?? null;
}

export function removeNote(notes: readonly ReviewNote[], noteId: string): ReviewNote[] {
  if (findNote(notes, noteId) === null) {
    throw new Error('Заметка не найдена.');
  }
  return notes.filter((note) => note.id !== noteId);
}

export interface AnchorRefreshResult {
  notes: ReviewNote[];
  changed: boolean;
}

export function refreshNoteAnchors(
  notes: readonly ReviewNote[],
  newContent: string | null,
  oldContent: string | null,
): AnchorRefreshResult {
  const newLines = newContent === null ? null : toLines(newContent);
  const oldLines = oldContent === null ? null : toLines(oldContent);
  let changed = false;
  const updated = notes.map((note) => {
    if (note.anchor === null) {
      return note;
    }
    const lines = note.anchor.side === 'new' ? newLines : oldLines;
    let result: AnchorResolutionResult;
    if (lines === null) {
      result = { resolution: 'missing', resolvedLine: null };
    } else {
      result = resolveLineAnchor(lines, note.anchor);
    }
    if (
      result.resolution === note.anchor.resolution &&
      result.resolvedLine === note.anchor.resolvedLine
    ) {
      return note;
    }
    changed = true;
    return {
      ...note,
      anchor: {
        ...note.anchor,
        resolution: result.resolution,
        resolvedLine: result.resolvedLine,
      },
    };
  });
  return { notes: updated, changed };
}
