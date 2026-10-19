import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitService } from '../src/git/gitService';
import { calculateProgress } from '../src/review/reviewProgress';
import { ReviewManager } from '../src/review/reviewManager';
import { ReviewStorage } from '../src/storage/reviewStorage';
import { resolveReviewsDir } from '../src/utils/pathUtils';

const execFileAsync = promisify(execFile);

let tmpRoot: string;
let repo: string;
const gitService = new GitService();
let manager: ReviewManager;

async function git(...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: repo });
}

async function write(relativePath: string, content: string): Promise<void> {
  const filePath = path.join(repo, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prnav-manager-'));
  repo = path.join(tmpRoot, 'repo');
  await fs.mkdir(repo, { recursive: true });
  await git('init', '-q', '-b', 'feature');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');

  await write('.gitignore', '.vscode/pr-navigator/\n');
  await write(
    'src/app.ts',
    'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\n',
  );
  await write('keep.ts', 'keep v1\n');
  await write('doomed.ts', 'doomed v1\n');
  await write('sub dir/doc file.md', 'doc\n');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'c1');
  await git('branch', 'base');

  await write(
    'src/app.ts',
    'line 1\nline 2\nline 3\nline 4\nline 5 modified\nline 6\nline 7\nline 8\n',
  );
  await write('keep.ts', 'keep v2 reviewed\n');
  await write('doomed.ts', 'doomed v2\n');
  await write('new.ts', 'new file\n');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'c2');
});

afterAll(async () => {
  manager?.dispose();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('ReviewManager: жизненный цикл проверки', () => {
  it('создаёт проверку со всеми файлами в статусе NotReviewed', async () => {
    manager = new ReviewManager(gitService);
    const result = await manager.openReview(repo, 'base', 'feature');
    expect(result.created).toBe(true);
    expect(result.session.files.map((record) => record.path).sort()).toEqual([
      'doomed.ts',
      'keep.ts',
      'new.ts',
      'src/app.ts',
    ]);
    expect(result.session.files.every((record) => record.status === 'NotReviewed')).toBe(true);
    expect(calculateProgress(result.session.files).percentage).toBe(0);
    expect(result.session.baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.session.comparisonCommit).toMatch(/^[0-9a-f]{40}$/);

    const storage = new ReviewStorage(resolveReviewsDir(repo));
    const stored = await storage.loadReview(result.session.id);
    expect(stored?.files).toHaveLength(4);
  });

  it('статусы сохраняются и переживают повторное открытие той же пары ссылок', async () => {
    await manager.setStatus('src/app.ts', 'InProgress');
    await manager.setStatus('keep.ts', 'Reviewed');
    const reopened = await manager.openReview(repo, 'base', 'feature');
    expect(reopened.created).toBe(false);
    const app = reopened.session.files.find((record) => record.path === 'src/app.ts');
    const keep = reopened.session.files.find((record) => record.path === 'keep.ts');
    expect(app?.status).toBe('InProgress');
    expect(app?.lastReviewedFingerprint).toBeTruthy();
    expect(keep?.status).toBe('Reviewed');
    expect(keep?.reviewedAt).toBeTruthy();
    expect(calculateProgress(reopened.session.files).percentage).toBe(25);
  });

  it('файловая и строчная заметки создаются и сохраняются на диск', async () => {
    const content = await fs.readFile(path.join(repo, 'src/app.ts'), 'utf8');
    const fileNote = await manager.addFileNote('src/app.ts', 'Файловая заметка про *важно*');
    const lineNote = await manager.addLineNote('src/app.ts', 'Привязка к строке', content, 1, 'new');
    expect(fileNote.anchor).toBeNull();
    expect(lineNote.anchor?.line).toBe(2);
    expect(lineNote.anchor?.resolvedLine).toBe(2);

    const storage = new ReviewStorage(resolveReviewsDir(repo));
    const session = manager.getSession();
    expect(session).not.toBeNull();
    const loaded = await storage.loadReview(session?.id ?? 'missing');
    expect(loaded?.files.find((record) => record.path === 'src/app.ts')?.notes).toHaveLength(2);
  });

  it('обновление помечает изменённый файл и сдвигает якорь заметки', async () => {
    await write(
      'src/app.ts',
      'line inserted before\nline 1\nline 2\nline 3\nline 4\nline 5 modified\nline 6\nline 7\nline 8\n',
    );
    await git('add', '-A');
    await git('commit', '-q', '-m', 'c3 app changed');

    const result = await manager.refresh();
    const app = result.session.files.find((record) => record.path === 'src/app.ts');
    const keep = result.session.files.find((record) => record.path === 'keep.ts');
    const added = result.session.files.find((record) => record.path === 'new.ts');

    expect(app?.status).toBe('NeedsReReview');
    expect(app?.notes).toHaveLength(2);
    expect(app?.notes[1]?.anchor?.line).toBe(2);
    expect(app?.notes[1]?.anchor?.resolvedLine).toBe(3);
    expect(app?.notes[1]?.anchor?.resolution).toBe('resolved');
    expect(keep?.status).toBe('Reviewed');
    expect(added?.status).toBe('NotReviewed');
    expect(result.detection.stalePaths).toEqual(['src/app.ts']);
    expect(result.anchorsUpdated).toBe(1);
    expect(calculateProgress(result.session.files).percentage).toBe(25);
  });

  it('ранее устаревший файл не становится Reviewed без действий пользователя', async () => {
    const result = await manager.refresh();
    const app = result.session.files.find((record) => record.path === 'src/app.ts');
    expect(app?.status).toBe('NeedsReReview');
    expect(result.detection.stalePaths).toHaveLength(0);
  });

  it('надёжное переименование переносит состояние, заметки и устаревший статус', async () => {
    await git('mv', 'src/app.ts', 'src/renamed-app.ts');
    await git('commit', '-q', '-m', 'c4 rename app');

    const result = await manager.refresh();
    const renamedApp = result.session.files.find(
      (record) => record.path === 'src/renamed-app.ts',
    );
    expect(renamedApp?.previousPath).toBe('src/app.ts');
    expect(renamedApp?.changeKind).toBe('renamed');
    expect(renamedApp?.status).toBe('NeedsReReview');
    expect(renamedApp?.notes).toHaveLength(2);
    expect(result.session.files.find((record) => record.path === 'src/app.ts')).toBeUndefined();
    expect(result.session.historical).toHaveLength(0);
  });

  it('удаление разбирается корректно, ненадёжный rename сохраняет историю', async () => {
    await manager.addFileNote('doomed.ts', 'Заметка перед удалением');
    await git('mv', 'keep.ts', 'renamed-keep.ts');
    await git('rm', '-q', 'doomed.ts');
    await git('commit', '-q', '-m', 'c5 unreliable rename and delete');

    const result = await manager.refresh();
    const removed = result.session.files.find((record) => record.path === 'doomed.ts');
    expect(removed?.changeKind).toBe('deleted');
    expect(removed?.status).toBe('NotReviewed');
    expect(removed?.notes[0]?.text).toBe('Заметка перед удалением');

    const archivedKeep = result.session.files.find((record) => record.path === 'keep.ts');
    expect(archivedKeep?.changeKind).toBe('deleted');
    expect(archivedKeep?.status).toBe('NeedsReReview');

    const freshCopy = result.session.files.find((record) => record.path === 'renamed-keep.ts');
    expect(freshCopy?.status).toBe('NotReviewed');
    expect(freshCopy?.previousPath).toBeNull();

    expect(result.session.historical).toHaveLength(0);
    expect(result.session.files).toHaveLength(5);
    expect(calculateProgress(result.session.files).total).toBe(5);
  });

  it('восстанавливает проверку из хранилища новым экземпляром менеджера', async () => {
    const listed = await manager.listReviews(repo);
    expect(listed.reviews).toHaveLength(1);
    expect(listed.errors).toHaveLength(0);
    const summary = listed.reviews[0];
    expect(summary).toBeDefined();

    const fresh = new ReviewManager(new GitService());
    try {
      const restored = await fresh.restoreReview(repo, summary?.id ?? 'missing');
      expect(restored.warning).toBeNull();
      expect(restored.detection).not.toBeNull();
      const original = manager.getSession();
      expect(restored.session.files.map((record) => record.path)).toEqual(
        original?.files.map((record) => record.path),
      );
      expect(restored.session.files.map((record) => record.status)).toEqual(
        original?.files.map((record) => record.status),
      );
      expect(restored.session.updatedAt >= (original?.updatedAt ?? '')).toBe(true);
      const originalNotes = original?.files.flatMap((record) => record.notes) ?? [];
      const restoredNotes = restored.session.files.flatMap((record) => record.notes);
      expect(restoredNotes.map((note) => note.id).sort()).toEqual(
        originalNotes.map((note) => note.id).sort(),
      );
    } finally {
      fresh.dispose();
    }
  });

  it('пустое сравнение даёт ноль файлов и 0%', async () => {
    const result = await manager.openReview(repo, 'base', 'base');
    expect(result.session.files).toHaveLength(0);
    expect(calculateProgress(result.session.files)).toMatchObject({
      total: 0,
      percentage: 0,
    });
  });

  it('несуществующая ссылка отклоняется и не затирает активную проверку', async () => {
    await expect(manager.openReview(repo, 'base', 'no-such-ref')).rejects.toThrow(
      /не найдена/,
    );
    expect(manager.getSession()?.baseRef).toBe('base');
    expect(manager.getSession()?.comparisonRef).toBe('base');
  });

  it('статус для неизвестного пути отклоняется', async () => {
    await expect(manager.setStatus('no/file.ts', 'Reviewed')).rejects.toThrow(
      'не найден в активной проверке',
    );
    await expect(manager.addFileNote('no/file.ts', 'x')).rejects.toThrow(
      'не найден в активной проверке',
    );
  });
});
