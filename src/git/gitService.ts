import { spawn } from 'node:child_process';
import { Logger, silentLogger } from '../utils/errorHandling';
import { ChangeKind } from '../review/reviewTypes';
import { ComparisonSnapshot, DiffEntry, GitFileContent, GitRefInfo } from './gitTypes';

export class GitError extends Error {
  readonly detail: string | undefined;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'GitError';
    this.detail = detail;
  }
}

interface GitRunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

const GIT_TIMEOUT_MS = 30000;

const ZERO_SHA_PATTERN = /^0+$/;

const NUL_SEPARATOR = String.fromCharCode(0);

export function parseRawDiff(buffer: Buffer): DiffEntry[] {
  const tokens = buffer.toString('utf8').split(NUL_SEPARATOR);
  const entries: DiffEntry[] = [];
  let index = 0;

  while (index < tokens.length) {
    let header = tokens[index];
    index += 1;
    if (header === undefined) {
      break;
    }
    header = header.replace(/^\n+/, '');
    if (header === '') {
      continue;
    }
    if (!header.startsWith(':')) {
      throw new GitError('Не удалось разобрать вывод git diff-tree.', header);
    }
    const parts = header.slice(1).split(' ');
    if (parts.length < 5) {
      throw new GitError('Не удалось разобрать вывод git diff-tree.', header);
    }
    const statusToken = parts[4] ?? '';
    const statusChar = statusToken.charAt(0);
    const takesTwoPaths = statusChar === 'R' || statusChar === 'C';
    const firstPath = tokens[index] ?? '';
    const secondPath = takesTwoPaths ? tokens[index + 1] : undefined;
    index += takesTwoPaths ? 2 : 1;
    if (firstPath === '') {
      throw new GitError('Не удалось разобрать вывод git diff-tree.', header);
    }

    const oldSha = parts[2] ?? '';
    const newSha = parts[3] ?? '';
    const oldFingerprint = oldSha === '' || ZERO_SHA_PATTERN.test(oldSha) ? null : oldSha;
    const newFingerprint = newSha === '' || ZERO_SHA_PATTERN.test(newSha) ? null : newSha;

    if (statusChar === 'A') {
      entries.push({
        status: 'added',
        oldPath: null,
        newPath: firstPath,
        oldFingerprint: null,
        newFingerprint,
      });
    } else if (statusChar === 'D') {
      entries.push({
        status: 'deleted',
        oldPath: firstPath,
        newPath: null,
        oldFingerprint,
        newFingerprint: null,
      });
    } else if (statusChar === 'R' || statusChar === 'C') {
      if (secondPath === undefined || secondPath === '') {
        throw new GitError('Не удалось разобрать вывод git diff-tree.', header);
      }
      entries.push({
        status: statusChar === 'R' ? 'renamed' : 'copied',
        oldPath: firstPath,
        newPath: secondPath,
        oldFingerprint,
        newFingerprint,
      });
    } else {
      entries.push({
        status: 'modified' as ChangeKind,
        oldPath: firstPath,
        newPath: firstPath,
        oldFingerprint,
        newFingerprint,
      });
    }
  }

  return entries;
}

function shortenRef(fullRef: string): string {
  const prefixes = ['refs/heads/', 'refs/tags/', 'refs/remotes/'];
  for (const prefix of prefixes) {
    if (fullRef.startsWith(prefix)) {
      return fullRef.slice(prefix.length);
    }
  }
  return fullRef;
}

export class GitService {
  constructor(private readonly logger: Logger = silentLogger) {}

  private run(repositoryDir: string, args: string[]): Promise<GitRunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: repositoryDir,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_PAGER: 'cat',
          GIT_OPTIONAL_LOCKS: '0',
        },
        windowsHide: true,
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill('SIGTERM');
        reject(new GitError('Git-команда превысила таймаут и была прервана.'));
      }, GIT_TIMEOUT_MS);

      child.on('error', (error: NodeJS.ErrnoException) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error.code === 'ENOENT') {
          reject(
            new GitError(
              'Не удалось запустить Git. Убедитесь, что Git установлен и доступен в PATH.',
            ),
          );
        } else {
          reject(new GitError('Не удалось выполнить Git-команду.', String(error)));
        }
      });

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      child.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          code: code ?? -1,
          stdout: Buffer.concat(stdoutChunks),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
        });
      });
    });
  }

  private async runChecked(
    repositoryDir: string,
    args: string[],
    failureMessage: string,
  ): Promise<GitRunResult> {
    const result = await this.run(repositoryDir, args);
    if (result.code !== 0) {
      this.logger.log(`git ${args[0] ?? ''} завершился с кодом ${result.code}`);
      throw new GitError(failureMessage, result.stderr.trim());
    }
    return result;
  }

  async isRepository(repositoryDir: string): Promise<boolean> {
    const result = await this.run(repositoryDir, ['rev-parse', '--git-dir']);
    return result.code === 0;
  }

  async findRepositoryRoots(directories: string[]): Promise<string[]> {
    const roots: string[] = [];
    for (const directory of directories) {
      try {
        const result = await this.run(directory, ['rev-parse', '--show-toplevel']);
        if (result.code === 0) {
          const root = result.stdout.toString('utf8').trim();
          if (root !== '' && !roots.includes(root)) {
            roots.push(root);
          }
        }
      } catch (error) {
        this.logger.log(
          `Не удалось определить корень репозитория для ${directory}: ${String(error)}`,
        );
      }
    }
    return roots;
  }

  async resolveRef(repositoryDir: string, ref: string): Promise<string> {
    const trimmed = ref.trim();
    if (trimmed === '') {
      throw new GitError('Git-ссылка не может быть пустой.');
    }
    const result = await this.run(repositoryDir, [
      'rev-parse',
      '--verify',
      '--quiet',
      '--end-of-options',
      `${trimmed}^{commit}`,
    ]);
    if (result.code !== 0) {
      if (result.stderr.includes('not a git repository')) {
        throw new GitError(`Каталог «${repositoryDir}» не является Git-репозиторием.`);
      }
      throw new GitError(`Git-ссылка «${trimmed}» не найдена или не указывает на коммит.`);
    }
    const commit = result.stdout.toString('utf8').trim();
    if (commit === '') {
      throw new GitError(`Git-ссылка «${trimmed}» не найдена или не указывает на коммит.`);
    }
    return commit;
  }

  async listRefs(repositoryDir: string): Promise<GitRefInfo[]> {
    const result = await this.runChecked(
      repositoryDir,
      [
        'for-each-ref',
        '--format=%(refname) %(objectname) %(HEAD)',
        'refs/heads',
        'refs/tags',
        'refs/remotes',
      ],
      'Не удалось получить список Git-ссылок.',
    );
    const infos: GitRefInfo[] = [];
    for (const line of result.stdout.toString('utf8').split('\n')) {
      const trimmedLine = line.trim();
      if (trimmedLine === '') {
        continue;
      }
      const parts = trimmedLine.split(' ');
      const full = parts[0];
      const commit = parts[1];
      if (full === undefined || commit === undefined || full === '' || commit === '') {
        continue;
      }
      infos.push({
        name: shortenRef(full),
        full,
        commit,
        current: parts[2] === '*',
      });
    }

    const symbolic = await this.run(repositoryDir, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (symbolic.code !== 0) {
      const head = await this.run(repositoryDir, [
        'rev-parse',
        '--verify',
        '--quiet',
        '--end-of-options',
        'HEAD^{commit}',
      ]);
      if (head.code === 0) {
        const commit = head.stdout.toString('utf8').trim();
        infos.unshift({ name: 'HEAD', full: 'HEAD', commit, current: true });
      }
    }

    return infos.sort((left, right) => {
      if (left.current !== right.current) {
        return left.current ? -1 : 1;
      }
      return left.full.localeCompare(right.full);
    });
  }

  async mergeBase(
    repositoryDir: string,
    leftCommit: string,
    rightCommit: string,
  ): Promise<string | null> {
    const result = await this.run(repositoryDir, ['merge-base', '--all', leftCommit, rightCommit]);
    if (result.code !== 0) {
      return null;
    }
    const lines = result.stdout
      .toString('utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    if (lines.length === 0) {
      return null;
    }
    if (lines.length > 1) {
      this.logger.log(`merge-base вернул ${lines.length} значений, используется первое`);
    }
    return lines[0] ?? null;
  }

  async diffCommits(
    repositoryDir: string,
    leftCommit: string,
    rightCommit: string,
  ): Promise<DiffEntry[]> {
    const result = await this.runChecked(
      repositoryDir,
      ['diff-tree', '-r', '-M', '--no-commit-id', '--raw', '-z', leftCommit, rightCommit],
      'Не удалось получить список изменённых файлов.',
    );
    return parseRawDiff(result.stdout);
  }

  async createSnapshot(
    repositoryDir: string,
    baseRef: string,
    comparisonRef: string,
  ): Promise<ComparisonSnapshot> {
    const baseRefCommit = await this.resolveRef(repositoryDir, baseRef);
    const comparisonCommit = await this.resolveRef(repositoryDir, comparisonRef);
    const mergeBaseCommit = await this.mergeBase(repositoryDir, baseRefCommit, comparisonCommit);
    const leftCommit = mergeBaseCommit ?? baseRefCommit;
    const entries =
      leftCommit === comparisonCommit
        ? []
        : await this.diffCommits(repositoryDir, leftCommit, comparisonCommit);
    return { baseCommit: leftCommit, comparisonCommit, entries };
  }

  async showFileContent(
    repositoryDir: string,
    ref: string,
    filePath: string,
  ): Promise<GitFileContent> {
    const result = await this.run(repositoryDir, [
      'show',
      '--no-textconv',
      '--no-ext-diff',
      `${ref}:${filePath}`,
    ]);
    if (result.code === 0) {
      return { present: true, content: result.stdout };
    }
    const stderr = result.stderr;
    if (
      stderr.includes('does not exist in') ||
      stderr.includes('Not a valid object name') ||
      stderr.includes('invalid object') ||
      stderr.includes('exists on disk, but not in')
    ) {
      this.logger.log(`Объект недоступен: ${ref}:${filePath}`);
      return { present: false, content: Buffer.alloc(0) };
    }
    throw new GitError(
      `Не удалось прочитать файл «${filePath}» по ссылке «${ref}».`,
      stderr.trim(),
    );
  }
}
