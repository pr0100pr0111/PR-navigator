import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitError, GitService, parseRawDiff } from '../src/git/gitService';

const execFileAsync = promisify(execFile);

let tmpRoot: string;
let repo: string;
let outsideDir: string;
const gitService = new GitService();

async function git(dir: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd: dir });
  return result.stdout;
}

async function write(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'prnav-git-'));
  repo = path.join(tmpRoot, 'repo');
  outsideDir = path.join(tmpRoot, 'outside');
  await fs.mkdir(repo, { recursive: true });
  await fs.mkdir(outsideDir, { recursive: true });

  await git(repo, 'init', '-q', '-b', 'main');
  await git(repo, 'config', 'user.email', 'test@example.com');
  await git(repo, 'config', 'user.name', 'Test');
  await git(repo, 'config', 'commit.gpgsign', 'false');

  await write(path.join(repo, 'src/app.ts'), 'line1\nline2\n');
  await write(path.join(repo, 'README.md'), 'readme\n');
  await write(path.join(repo, 'sub dir/file with space.txt'), 'space content\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', 'first');
  await git(repo, 'branch', 'base');

  await write(path.join(repo, 'src/app.ts'), 'line1\nline2 changed\n');
  await write(path.join(repo, 'new file.txt'), 'added\n');
  await git(repo, 'rm', '-q', 'README.md');
  await git(repo, 'mv', 'sub dir/file with space.txt', 'sub dir/renamed file.txt');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', 'second');
  await git(repo, 'branch', 'mid');

  await write(path.join(repo, 'src/app.ts'), 'line1\nline2 changed\nline3\n');
  await write(path.join(repo, 'sub dir/renamed file.txt'), 'space content\nmore\n');
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-q', '-m', 'third');
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('GitService: репозиторий', () => {
  it('определяет Git-репозиторий и обычный каталог', async () => {
    expect(await gitService.isRepository(repo)).toBe(true);
    expect(await gitService.isRepository(outsideDir)).toBe(false);
  });

  it('находит корни репозиториев и пропускает не-Git каталоги', async () => {
    const roots = await gitService.findRepositoryRoots([
      path.join(repo, 'src'),
      outsideDir,
      repo,
    ]);
    const topLevel = (await git(repo, 'rev-parse', '--show-toplevel')).trim();
    expect(roots).toEqual([path.normalize(topLevel)]);
  });
});

describe('GitService: ссылки', () => {
  it('резолвит существующие ссылки', async () => {
    const mainCommit = await gitService.resolveRef(repo, 'main');
    const baseCommit = await gitService.resolveRef(repo, 'base');
    expect(mainCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(baseCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(mainCommit).not.toBe(baseCommit);
  });

  it('сообщает об отсутствующей ссылке на русском', async () => {
    await expect(gitService.resolveRef(repo, 'no-such-branch')).rejects.toThrow(
      /Git-ссылка «no-such-branch» не найдена/,
    );
  });

  it('различает отсутствующую ссылку и не-Git каталог', async () => {
    await expect(gitService.resolveRef(outsideDir, 'main')).rejects.toThrow(
      /не является Git-репозиторием/,
    );
    await expect(gitService.resolveRef(repo, '  ')).rejects.toThrow(GitError);
  });

  it('возвращает список ссылок с текущей веткой первой', async () => {
    const refs = await gitService.listRefs(repo);
    const names = refs.map((ref) => ref.name);
    expect(names).toContain('main');
    expect(names).toContain('base');
    expect(refs[0]?.current).toBe(true);
    expect(refs[0]?.name).toBe('main');
  });
});

describe('GitService: снимок сравнения', () => {
  it('обнаруживает добавленные, изменённые, удалённые и переименованные файлы', async () => {
    const snapshot = await gitService.createSnapshot(repo, 'base', 'mid');
    const byPath = new Map(snapshot.entries.map((entry) => [entry.newPath ?? entry.oldPath, entry]));

    const modified = byPath.get('src/app.ts');
    expect(modified?.status).toBe('modified');
    expect(modified?.oldFingerprint).toBeTruthy();
    expect(modified?.newFingerprint).toBeTruthy();
    expect(modified?.oldFingerprint).not.toBe(modified?.newFingerprint);

    const added = byPath.get('new file.txt');
    expect(added?.status).toBe('added');
    expect(added?.oldFingerprint).toBeNull();
    expect(added?.newFingerprint).toBeTruthy();

    const deleted = byPath.get('README.md');
    expect(deleted?.status).toBe('deleted');
    expect(deleted?.newFingerprint).toBeNull();
    expect(deleted?.oldFingerprint).toBeTruthy();

    const renamed = snapshot.entries.find((entry) => entry.status === 'renamed');
    expect(renamed?.oldPath).toBe('sub dir/file with space.txt');
    expect(renamed?.newPath).toBe('sub dir/renamed file.txt');
    expect(renamed?.newFingerprint).toBeTruthy();
  });

  it('корректно разбирает пути с пробелами', async () => {
    const snapshot = await gitService.createSnapshot(repo, 'base', 'mid');
    const paths = snapshot.entries.map((entry) => entry.newPath ?? entry.oldPath);
    expect(paths).toContain('sub dir/renamed file.txt');
    const renamed = snapshot.entries.find((entry) => entry.status === 'renamed');
    expect(renamed?.oldPath).toContain(' ');
    expect(renamed?.oldPath?.split(' ')).toHaveLength(4);
  });

  it('пустое сравнение возвращает ноль записей', async () => {
    const snapshot = await gitService.createSnapshot(repo, 'HEAD', 'HEAD');
    expect(snapshot.entries).toHaveLength(0);
    expect(snapshot.baseCommit).toBe(snapshot.comparisonCommit);
  });

  it('ветка без изменений относительно базы даёт пустое сравнение', async () => {
    await git(repo, 'checkout', '-q', '-b', 'empty-branch', 'base');
    await git(repo, 'commit', '-q', '--allow-empty', '-m', 'no changes');
    await git(repo, 'checkout', '-q', 'main');
    const snapshot = await gitService.createSnapshot(repo, 'base', 'empty-branch');
    expect(snapshot.entries).toHaveLength(0);
    await git(repo, 'branch', '-D', 'empty-branch');
  });

  it('отпечаток изменённого файла отличается между коммитами', async () => {
    const toMid = await gitService.createSnapshot(repo, 'base', 'mid');
    const toMain = await gitService.createSnapshot(repo, 'base', 'main');
    const appMid = toMid.entries.find((entry) => entry.newPath === 'src/app.ts');
    const appMain = toMain.entries.find((entry) => entry.newPath === 'src/app.ts');
    expect(appMid?.newFingerprint).not.toBe(appMain?.newFingerprint);
  });

  it('использует merge-base как левую сторону сравнения', async () => {
    await git(repo, 'checkout', '-q', '-b', 'diverged', 'base');
    await write(path.join(repo, 'feature-only.txt'), 'feature\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-q', '-m', 'feature commit');
    await git(repo, 'checkout', '-q', 'main');
    const snapshot = await gitService.createSnapshot(repo, 'diverged', 'main');
    const baseCommit = await gitService.resolveRef(repo, 'base');
    expect(snapshot.baseCommit).toBe(baseCommit);
    await git(repo, 'branch', '-D', 'diverged');
  });

  it('недоступное сравнение приводит к GitError', async () => {
    await expect(gitService.createSnapshot(repo, 'base', 'missing-ref')).rejects.toThrow(GitError);
    await expect(gitService.createSnapshot(repo, 'base', 'missing-ref')).rejects.toThrow(
      /не найдена/,
    );
  });
});

describe('GitService: содержимое файлов', () => {
  it('читает файл по ссылке', async () => {
    const content = await gitService.showFileContent(repo, 'base', 'src/app.ts');
    expect(content.present).toBe(true);
    expect(content.content.toString('utf8')).toBe('line1\nline2\n');
  });

  it('читает файл по пути с пробелами', async () => {
    const content = await gitService.showFileContent(repo, 'base', 'sub dir/file with space.txt');
    expect(content.present).toBe(true);
    expect(content.content.toString('utf8')).toBe('space content\n');
  });

  it('возвращает отсутствие файла, которого нет на стороне сравнения', async () => {
    const missing = await gitService.showFileContent(repo, 'mid', 'README.md');
    expect(missing.present).toBe(false);
    const notCreatedYet = await gitService.showFileContent(repo, 'base', 'new file.txt');
    expect(notCreatedYet.present).toBe(false);
    const unknownPath = await gitService.showFileContent(repo, 'base', 'no/such/file.ts');
    expect(unknownPath.present).toBe(false);
  });
});

describe('parseRawDiff', () => {
  const NUL = String.fromCharCode(0);

  it('разбирает изменённый файл', () => {
    const buffer = Buffer.from(`:100644 100644 aaa111 bbb222 M${NUL}src/a.ts${NUL}`, 'utf8');
    const entries = parseRawDiff(buffer);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('modified');
    expect(entries[0]?.oldPath).toBe('src/a.ts');
    expect(entries[0]?.newPath).toBe('src/a.ts');
    expect(entries[0]?.oldFingerprint).toBe('aaa111');
    expect(entries[0]?.newFingerprint).toBe('bbb222');
  });

  it('разбирает несколько записей подряд', () => {
    const buffer = Buffer.from(
      `:100644 100644 aaa111 bbb222 M${NUL}src/a.ts${NUL}` +
        `:100644 100644 0000000 ccc333 A${NUL}src/b.ts${NUL}` +
        `:100644 100644 ddd444 0000000 D${NUL}src/c.ts${NUL}`,
      'utf8',
    );
    const entries = parseRawDiff(buffer);
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.status)).toEqual(['modified', 'added', 'deleted']);
    expect(entries[2]?.newFingerprint).toBeNull();
  });

  it('разбирает переименование с двумя путями', () => {
    const buffer = Buffer.from(
      `:100644 100644 aaa111 aaa111 R100${NUL}old name.txt${NUL}new name.txt${NUL}`,
      'utf8',
    );
    const entries = parseRawDiff(buffer);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe('renamed');
    expect(entries[0]?.oldPath).toBe('old name.txt');
    expect(entries[0]?.newPath).toBe('new name.txt');
    expect(entries[0]?.oldFingerprint).toBe('aaa111');
    expect(entries[0]?.newFingerprint).toBe('aaa111');
  });

  it('бросает GitError на некорректном выводе', () => {
    expect(() => parseRawDiff(Buffer.from('что-то не то', 'utf8'))).toThrow(GitError);
    expect(() => parseRawDiff(Buffer.from(':100644 100644 aaa bbb', 'utf8'))).toThrow(GitError);
  });
});
