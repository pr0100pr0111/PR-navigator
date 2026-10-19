import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { AnchorSide } from '../notes/noteTypes';
import { buildDiffUri, DIFF_SCHEME, parseDiffUri } from '../providers/diffContentProvider';
import { ReviewFileTreeItem, ReviewNoteTreeItem } from '../providers/reviewTreeItem';
import { ReviewManager } from '../review/reviewManager';
import { calculateProgress } from '../review/reviewProgress';
import { REVIEW_STATUSES, STATUS_LABELS } from '../review/reviewState';
import { FileReviewRecord, ReviewStatus } from '../review/reviewTypes';
import { generateMarkdownReport } from '../reports/markdownReportGenerator';
import { isCancellationError, toUserMessage } from '../utils/errorHandling';

export interface CommandContext {
  manager: ReviewManager;
  git: GitService;
  output: vscode.OutputChannel;
}

export type CommandHandler = (arg?: unknown) => Promise<void>;

export type CommandMap = Record<string, CommandHandler>;

async function withErrorHandling(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (isCancellationError(error)) {
      return;
    }
    void vscode.window.showErrorMessage(toUserMessage(error));
  }
}

async function resolveRepositoryRoot(git: CommandContext['git']): Promise<string> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    throw new Error('Откройте папку с Git-репозиторием в VS Code.');
  }
  const roots = await git.findRepositoryRoots(folders.map((folder) => folder.uri.fsPath));
  if (roots.length === 0) {
    throw new Error('Открытая папка не является Git-репозиторием.');
  }
  if (roots.length === 1) {
    return roots[0] as string;
  }
  const picked = await vscode.window.showQuickPick(roots, {
    placeHolder: 'Выберите репозиторий для проверки',
  });
  if (picked === undefined) {
    throw new vscode.CancellationError();
  }
  return picked;
}

async function pickRef(
  git: CommandContext['git'],
  repositoryRoot: string,
  title: string,
): Promise<string> {
  const refs = await git.listRefs(repositoryRoot);
  const items: vscode.QuickPickItem[] = refs.map((ref) => ({
    label: ref.current ? `$(git-branch) ${ref.name}` : ref.name,
    description: ref.full === ref.name ? '' : ref.full,
    detail: ref.commit.slice(0, 8),
  }));
  items.push({ label: '$(edit) Ввести имя ссылки вручную...' });
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: title,
    ignoreFocusOut: true,
  });
  if (picked === undefined) {
    throw new vscode.CancellationError();
  }
  if (picked.label.includes('Ввести имя ссылки')) {
    const typed = await vscode.window.showInputBox({
      title,
      prompt: 'Например: main, origin/feature, тег или SHA',
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim() === '' ? 'Имя ссылки не может быть пустым.' : undefined,
    });
    if (typed === undefined) {
      throw new vscode.CancellationError();
    }
    return typed.trim();
  }
  const ref = refs.find((candidate) => picked.label.endsWith(candidate.name));
  return ref === undefined ? picked.label.replace(/^\S+\s/, '') : ref.name;
}

async function requireRecord(manager: ReviewManager, filePath: string): Promise<FileReviewRecord> {
  const record = manager.getRecord(filePath);
  if (record === null) {
    throw new Error(`Файл «${filePath}» не найден в активной проверке.`);
  }
  return record;
}

export function createCommands(context: CommandContext): CommandMap {
  const { manager, git, output } = context;

  const startReview = () =>
    withErrorHandling(async () => {
      const repositoryRoot = await resolveRepositoryRoot(git);
      const baseRef = await pickRef(git, repositoryRoot, 'Базовая ссылка (от неё строится сравнение)');
      const comparisonRef = await pickRef(
        git,
        repositoryRoot,
        'Сравниваемая ссылка (её изменения проверяем)',
      );
      const result = await manager.openReview(repositoryRoot, baseRef, comparisonRef);
      const stats = calculateProgress(result.session.files);
      const message = result.created
        ? `Проверка начата: ${baseRef} → ${comparisonRef}, файлов: ${stats.total}.`
        : `Проверка восстановлена: ${baseRef} → ${comparisonRef}, файлов: ${stats.total}.`;
      void vscode.window.showInformationMessage(message);
      output.appendLine(message);
    });

  const openReview = () =>
    withErrorHandling(async () => {
      const repositoryRoot = await resolveRepositoryRoot(git);
      const listed = await manager.listReviews(repositoryRoot);
      if (listed.errors.length > 0) {
        for (const item of listed.errors) {
          output.appendLine(`Не удалось прочитать ${item.file}: ${item.message}`);
        }
      }
      if (listed.reviews.length === 0) {
        void vscode.window.showInformationMessage('Сохранённых проверок не найдено.');
        return;
      }
      const items: (vscode.QuickPickItem & { summaryId: string })[] = listed.reviews.map(
        (summary) => ({
          summaryId: summary.id,
          label: `${summary.baseRef} → ${summary.comparisonRef}`,
          description: `${summary.percentage}%`,
          detail: `${summary.fileCount} файлов, обновлено: ${summary.updatedAt}`,
        }),
      );
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Выберите сохранённую проверку',
      });
      if (picked === undefined) {
        throw new vscode.CancellationError();
      }
      const restored = await manager.restoreReview(repositoryRoot, picked.summaryId);
      const stats = calculateProgress(restored.session.files);
      void vscode.window.showInformationMessage(
        `Проверка открыта: ${restored.session.baseRef} → ${restored.session.comparisonRef}, прогресс: ${stats.percentage}%.`,
      );
      if (restored.warning !== null) {
        void vscode.window.showWarningMessage(
          `Проверка открыта, но состояние требует обновления: ${restored.warning}`,
        );
      }
    });

  const refreshReview = () =>
    withErrorHandling(async () => {
      const result = await manager.refresh();
      const stats = calculateProgress(result.session.files);
      const parts = [
        `новых: ${result.detection.addedPaths.length}`,
        `устаревших: ${result.detection.stalePaths.length}`,
        `в архив: ${result.detection.archivedPaths.length}`,
        `возвращено из архива: ${result.detection.restoredPaths.length}`,
        `якорей обновлено: ${result.anchorsUpdated}`,
      ];
      const message = `Проверка обновлена (${stats.percentage}%): ${parts.join(', ')}.`;
      void vscode.window.showInformationMessage(message);
      output.appendLine(message);
    });

  const exportReport = () =>
    withErrorHandling(async () => {
      const session = manager.getSession();
      if (session === null) {
        throw new Error(
          'Нет активной проверки. Сначала выполните «PR Navigator: Начать новую проверку».',
        );
      }
      const suggestedName = `pr-review-${session.baseRef}...${session.comparisonRef}.md`
        .replace(/[/\\]/g, '_');
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(session.repository.root, suggestedName)),
        filters: { Markdown: ['md'] },
        saveLabel: 'Сохранить отчёт',
      });
      if (target === undefined) {
        throw new vscode.CancellationError();
      }
      const markdown = generateMarkdownReport(session, { generatedAt: new Date().toISOString() });
      await fs.writeFile(target.fsPath, markdown, 'utf8');
      output.appendLine(`Отчёт сохранён: ${target.fsPath}`);
      const action = await vscode.window.showInformationMessage(
        `Отчёт сохранён: ${target.fsPath}`,
        'Открыть',
      );
      if (action === 'Открыть') {
        const document = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(document, { preview: false });
      }
    });

  const changeStatus = () =>
    withErrorHandling(async () => {
      const session = manager.getSession();
      if (session === null) {
        throw new Error(
          'Нет активной проверки. Сначала выполните «PR Navigator: Начать новую проверку».',
        );
      }
      const fileItems: (vscode.QuickPickItem & { filePath: string })[] = session.files.map(
        (record) => ({
          filePath: record.path,
          label: record.path,
          description: STATUS_LABELS[record.status],
        }),
      );
      const filePick = await vscode.window.showQuickPick(fileItems, {
        placeHolder: 'Выберите файл',
      });
      if (filePick === undefined) {
        throw new vscode.CancellationError();
      }
      const statusPick = await vscode.window.showQuickPick(
        REVIEW_STATUSES.map((status) => ({ label: STATUS_LABELS[status], status })),
        { placeHolder: 'Новый статус файла' },
      );
      if (statusPick === undefined) {
        throw new vscode.CancellationError();
      }
      await setStatusForFile(filePick.filePath, statusPick.status);
    });

  async function setStatusForFile(filePath: string, status: ReviewStatus): Promise<void> {
    await manager.setStatus(filePath, status);
    const record = await requireRecord(manager, filePath);
    const message = `«${filePath}» → ${STATUS_LABELS[status]}.`;
    void vscode.window.showInformationMessage(message);
    output.appendLine(message);
    if (record.status === 'Reviewed') {
      const stats = calculateProgress(manager.getSession()?.files ?? []);
      output.appendLine(`Прогресс проверки: ${stats.percentage}% (${stats.reviewed}/${stats.total}).`);
    }
  }

  function requireFileItem(arg: unknown): FileReviewRecord {
    if (arg instanceof ReviewFileTreeItem) {
      return arg.record;
    }
    throw new Error('Команда доступна только для файлов в списке PR Navigator.');
  }

  const markInProgress: CommandHandler = (arg) =>
    withErrorHandling(() => setStatusForFile(requireFileItem(arg).path, 'InProgress'));

  const markReviewed: CommandHandler = (arg) =>
    withErrorHandling(() => setStatusForFile(requireFileItem(arg).path, 'Reviewed'));

  const markNeedsReReview: CommandHandler = (arg) =>
    withErrorHandling(() => setStatusForFile(requireFileItem(arg).path, 'NeedsReReview'));

  const markNotReviewed: CommandHandler = (arg) =>
    withErrorHandling(() => setStatusForFile(requireFileItem(arg).path, 'NotReviewed'));

  const openDiff: CommandHandler = (arg) =>
    withErrorHandling(async () => {
      const record = requireFileItem(arg);
      const session = manager.getSession();
      if (session === null) {
        throw new Error(
          'Нет активной проверки. Сначала выполните «PR Navigator: Начать новую проверку».',
        );
      }
      const snapshot = manager.requireSnapshot();
      const repositoryRoot = session.repository.root;
      const leftPath = record.previousPath ?? record.path;
      const leftUri = buildDiffUri({
        root: repositoryRoot,
        commit: snapshot.baseCommit,
        filePath: leftPath,
      });
      const rightUri = buildDiffUri({
        root: repositoryRoot,
        commit: snapshot.comparisonCommit,
        filePath: record.path,
      });
      const title = `${record.path} (${session.baseRef} → ${session.comparisonRef})`;
      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    });

  const addFileNote: CommandHandler = (arg) =>
    withErrorHandling(async () => {
      const record = requireFileItem(arg);
      const text = await promptNoteText(`Новая заметка к файлу «${record.path}»`);
      await manager.addFileNote(record.path, text);
      output.appendLine(`Заметка добавлена к файлу ${record.path}.`);
    });

  async function promptNoteText(title: string, initial?: string): Promise<string> {
    const text = await vscode.window.showInputBox({
      title,
      value: initial,
      ignoreFocusOut: true,
      prompt: 'Текст заметки (поддерживается Markdown)',
      validateInput: (value) =>
        value.trim() === '' ? 'Текст заметки не может быть пустым.' : undefined,
    });
    if (text === undefined) {
      throw new vscode.CancellationError();
    }
    return text.trim();
  }

  const addLineNote: CommandHandler = (arg) =>
    withErrorHandling(async () => {
      const session = manager.getSession();
      if (session === null) {
        throw new Error(
          'Нет активной проверки. Сначала выполните «PR Navigator: Начать новую проверку».',
        );
      }
      const target = resolveLineNoteTarget(arg, session.repository.root);
      if (target === null) {
        void vscode.window.showWarningMessage(
          'Файл не принадлежит активной проверке или не найден в ней.',
        );
        return;
      }
      const text = await promptNoteText(`Новая заметка к строке «${target.filePath}»`);
      await manager.addLineNote(
        target.filePath,
        text,
        target.content,
        target.lineIndex,
        target.side,
      );
      output.appendLine(`Строчная заметка добавлена: ${target.filePath}:${target.lineIndex + 1}.`);
    });

  interface LineNoteTarget {
    filePath: string;
    content: string;
    lineIndex: number;
    side: AnchorSide;
  }

  function resolveLineNoteTarget(arg: unknown, repositoryRoot: string): LineNoteTarget | null {
    if (arg instanceof ReviewNoteTreeItem) {
      return null;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      return null;
    }
    const document = editor.document;
    const lineIndex = editor.selection.active.line;
    if (document.uri.scheme === DIFF_SCHEME) {
      const query = parseDiffUri(document.uri);
      if (query === null) {
        return null;
      }
      const record = manager.getRecord(query.filePath);
      if (record === null) {
        return null;
      }
      const side: AnchorSide =
        query.commit === (manager.getSession()?.baseCommit ?? '') ? 'old' : 'new';
      return { filePath: query.filePath, content: document.getText(), lineIndex, side };
    }
    if (document.uri.scheme !== 'file') {
      return null;
    }
    const relative = path.relative(repositoryRoot, document.uri.fsPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }
    const filePath = relative.split(path.sep).join('/');
    const record = manager.getRecord(filePath);
    if (record === null) {
      return null;
    }
    return { filePath, content: document.getText(), lineIndex, side: 'new' };
  }

  const manageNotes: CommandHandler = (arg) =>
    withErrorHandling(async () => {
      const record = requireFileItem(arg);
      if (record.notes.length === 0) {
        void vscode.window.showInformationMessage(`У файла «${record.path}» нет заметок.`);
        return;
      }
      const noteItems: (vscode.QuickPickItem & { noteId: string })[] = record.notes.map(
        (note) => ({
          noteId: note.id,
          label: note.text.split('\n')[0] ?? '',
          description:
            note.anchor === null
              ? 'заметка к файлу'
              : `строка ${note.anchor.line + 1} (${describeResolution(note)})`,
        }),
      );
      const notePick = await vscode.window.showQuickPick(noteItems, {
        placeHolder: `Заметки файла «${record.path}»`,
      });
      if (notePick === undefined) {
        throw new vscode.CancellationError();
      }
      const note = record.notes.find((candidate) => candidate.id === notePick.noteId);
      if (note === undefined) {
        throw new Error('Заметка не найдена.');
      }
      const action = await vscode.window.showQuickPick(
        [
          { label: '$(edit) Редактировать текст' },
          { label: '$(trash) Удалить заметку' },
        ],
        { placeHolder: 'Действие с заметкой' },
      );
      if (action === undefined) {
        throw new vscode.CancellationError();
      }
      if (action.label.includes('Редактировать')) {
        const text = await promptNoteText('Редактирование заметки', note.text);
        await manager.updateNote(record.path, note.id, text);
        output.appendLine(`Заметка обновлена: ${record.path}.`);
        return;
      }
      const confirmation = await vscode.window.showWarningMessage(
        'Удалить заметку? Действие необратимо.',
        { modal: true },
        'Удалить',
      );
      if (confirmation !== 'Удалить') {
        return;
      }
      await manager.deleteNote(record.path, note.id);
      output.appendLine(`Заметка удалена: ${record.path}.`);
    });

  function describeResolution(note: { anchor: { resolution: string; resolvedLine: number | null; line: number } | null }): string {
    if (note.anchor === null) {
      return 'файловая';
    }
    if (note.anchor.resolution === 'resolved' && note.anchor.resolvedLine === note.anchor.line) {
      return 'точно';
    }
    if (note.anchor.resolution === 'resolved' && note.anchor.resolvedLine !== null) {
      return `сдвинута на ${note.anchor.resolvedLine + 1}`;
    }
    if (note.anchor.resolution === 'ambiguous') {
      return 'неоднозначно';
    }
    return 'строка не найдена';
  }

  return {
    startReview,
    openReview,
    refreshReview,
    exportReport,
    changeStatus,
    markInProgress,
    markReviewed,
    markNeedsReReview,
    markNotReviewed,
    openDiff,
    addFileNote,
    addLineNote,
    manageNotes,
  };
}
