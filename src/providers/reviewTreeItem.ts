import { basename as posixBasename, dirname as posixDirname } from 'node:path';
import * as vscode from 'vscode';
import { ReviewNote } from '../notes/noteTypes';
import { STATUS_LABELS } from '../review/reviewState';
import { ChangeKind, FileReviewRecord, ReviewStatus } from '../review/reviewTypes';

const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  added: 'добавлен',
  modified: 'изменён',
  deleted: 'удалён',
  renamed: 'переименован',
  copied: 'скопирован',
};

const STATUS_ICONS: Record<ReviewStatus, string> = {
  NotReviewed: 'circle-outline',
  InProgress: 'sync',
  Reviewed: 'pass',
  NeedsReReview: 'warning',
};

export class ReviewEmptyTreeItem extends vscode.TreeItem {
  constructor(text: string) {
    super(text, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'prNavigatorEmpty';
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

export class ReviewGroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly status: ReviewStatus,
    count: number,
  ) {
    super(`${STATUS_LABELS[status]} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'prNavigatorGroup';
    this.id = `prNavigatorGroup:${status}`;
    this.iconPath = new vscode.ThemeIcon(STATUS_ICONS[status]);
  }
}

export class ReviewFileTreeItem extends vscode.TreeItem {
  public readonly record: FileReviewRecord;

  constructor(record: FileReviewRecord) {
    super(posixBasename(record.path), vscode.TreeItemCollapsibleState.Collapsed);
    this.record = record;
    this.id = `prNavigatorFile:${record.path}`;
    this.contextValue = 'prNavigatorFile';
    this.description = describeFile(record);
    this.tooltip = buildFileTooltip(record);
    this.iconPath = new vscode.ThemeIcon(STATUS_ICONS[record.status]);
    this.command = {
      command: 'prNavigator.openDiff',
      title: 'PR Navigator: Открыть diff',
      arguments: [this],
    };
  }
}

export class ReviewNoteTreeItem extends vscode.TreeItem {
  public readonly filePath: string;
  public readonly note: ReviewNote;

  constructor(filePath: string, note: ReviewNote) {
    super(firstLine(note.text), vscode.TreeItemCollapsibleState.None);
    this.filePath = filePath;
    this.note = note;
    this.id = `prNavigatorNote:${filePath}:${note.id}`;
    this.contextValue = 'prNavigatorNote';
    this.description =
      note.anchor === null
        ? 'заметка к файлу'
        : `строка ${note.anchor.line + 1}${describeAnchorResolution(note)}`;
    this.tooltip = new vscode.MarkdownString(buildNoteTooltip(note));
  }
}

function describeFile(record: FileReviewRecord): string {
  const parts: string[] = [];
  const directory = posixDirname(record.path);
  if (directory !== '.') {
    parts.push(directory);
  }
  parts.push(CHANGE_KIND_LABELS[record.changeKind]);
  if (record.previousPath !== null && record.changeKind === 'renamed') {
    parts.push(`из ${record.previousPath}`);
  }
  if (record.notes.length > 0) {
    parts.push(`заметок: ${record.notes.length}`);
  }
  return parts.join(' · ');
}

function buildFileTooltip(record: FileReviewRecord): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  tooltip.appendMarkdown(`**${record.path}**\n\n`);
  if (record.previousPath !== null) {
    tooltip.appendMarkdown(`Ранее: ${record.previousPath}\n\n`);
  }
  tooltip.appendMarkdown(`Статус: ${STATUS_LABELS[record.status]}\n\n`);
  tooltip.appendMarkdown(`Изменение: ${CHANGE_KIND_LABELS[record.changeKind]}\n\n`);
  tooltip.appendMarkdown(`Заметок: ${record.notes.length}`);
  return tooltip;
}

function buildNoteTooltip(note: ReviewNote): string {
  const lines = [note.text, '', `Создано: ${note.createdAt}`];
  if (note.anchor !== null) {
    lines.push(
      `Якорь: строка ${note.anchor.line + 1}, ${
        note.anchor.side === 'old' ? 'старая сторона' : 'новая сторона'
      }`,
    );
    if (note.anchor.resolvedLine !== null) {
      lines.push(`Текущая строка: ${note.anchor.resolvedLine + 1}`);
    }
  }
  return lines.join('\n');
}

function describeAnchorResolution(note: ReviewNote): string {
  if (note.anchor === null || note.anchor.resolvedLine === null) {
    return '';
  }
  if (note.anchor.resolvedLine === note.anchor.line) {
    return '';
  }
  return `, сейчас ${note.anchor.resolvedLine + 1}`;
}

function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? '';
  const trimmed = line.trim();
  if (trimmed.length <= 60) {
    return trimmed === '' ? 'Пустая заметка' : trimmed;
  }
  return `${trimmed.slice(0, 57)}...`;
}
