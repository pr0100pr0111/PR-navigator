import * as path from 'node:path';

export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

export function resolveReviewsDir(repositoryRoot: string): string {
  return path.join(repositoryRoot, '.vscode', 'pr-navigator', 'reviews');
}

export function relativeRepoPath(repositoryRoot: string, filePath: string): string | null {
  const relative = path.relative(repositoryRoot, filePath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return toPosixPath(relative);
}

export function basenamePosix(value: string): string {
  const normalized = toPosixPath(value);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

export function dirnamePosix(value: string): string {
  const normalized = toPosixPath(value);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}
