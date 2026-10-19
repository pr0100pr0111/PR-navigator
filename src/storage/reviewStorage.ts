import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LineAnchor, ReviewNote } from '../notes/noteTypes';
import { calculateProgress } from '../review/reviewProgress';
import { isReviewStatus } from '../review/reviewState';
import {
  ChangeKind,
  FileReviewRecord,
  REVIEW_SCHEMA_VERSION,
  ReviewSession,
} from '../review/reviewTypes';
import { toUserMessage } from '../utils/errorHandling';
import { ListReviewsResult, ReviewSummary, StorageError } from './storageTypes';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const CHANGE_KINDS: readonly ChangeKind[] = [
  'added',
  'modified',
  'deleted',
  'renamed',
  'copied',
];

const ANCHOR_SIDES = ['old', 'new'];
const ANCHOR_RESOLUTIONS = ['resolved', 'ambiguous', 'missing'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(filePath: string, field: string): never {
  throw new StorageError(
    'invalid-schema',
    `Файл проверки «${filePath}» не соответствует ожидаемой схеме (поле «${field}»).`,
    filePath,
  );
}

function readString(source: Record<string, unknown>, field: string, filePath: string): string {
  const value = source[field];
  if (typeof value !== 'string' || value === '') {
    invalid(filePath, field);
  }
  return value;
}

function readNullableString(
  source: Record<string, unknown>,
  field: string,
  filePath: string,
): string | null {
  const value = source[field];
  if (value !== null && typeof value !== 'string') {
    invalid(filePath, field);
  }
  return value;
}

function readDate(source: Record<string, unknown>, field: string, filePath: string): string {
  const value = source[field];
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    invalid(filePath, field);
  }
  return value;
}

function readArray(source: Record<string, unknown>, field: string, filePath: string): unknown[] {
  const value = source[field];
  if (!Array.isArray(value)) {
    invalid(filePath, field);
  }
  return value;
}

function validateAnchor(value: unknown, filePath: string): LineAnchor {
  if (!isRecord(value)) {
    invalid(filePath, 'anchor');
  }
  const side = value['side'];
  const line = value['line'];
  const lineText = value['lineText'];
  const contextBefore = value['contextBefore'];
  const contextAfter = value['contextAfter'];
  const contextHash = value['contextHash'];
  const resolution = value['resolution'];
  const resolvedLine = value['resolvedLine'];
  if (!ANCHOR_SIDES.includes(side as string)) {
    invalid(filePath, 'anchor.side');
  }
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
    invalid(filePath, 'anchor.line');
  }
  if (typeof lineText !== 'string') {
    invalid(filePath, 'anchor.lineText');
  }
  if (
    !Array.isArray(contextBefore) ||
    !contextBefore.every((item) => typeof item === 'string') ||
    !Array.isArray(contextAfter) ||
    !contextAfter.every((item) => typeof item === 'string')
  ) {
    invalid(filePath, 'anchor.context');
  }
  if (typeof contextHash !== 'string') {
    invalid(filePath, 'anchor.contextHash');
  }
  if (!ANCHOR_RESOLUTIONS.includes(resolution as string)) {
    invalid(filePath, 'anchor.resolution');
  }
  if (resolvedLine !== null && typeof resolvedLine !== 'number') {
    invalid(filePath, 'anchor.resolvedLine');
  }
  return {
    side: side as LineAnchor['side'],
    line,
    lineText,
    contextBefore: contextBefore as string[],
    contextAfter: contextAfter as string[],
    contextHash,
    resolution: resolution as LineAnchor['resolution'],
    resolvedLine,
  };
}

function validateNote(value: unknown, filePath: string): ReviewNote {
  if (!isRecord(value)) {
    invalid(filePath, 'notes[]');
  }
  const anchor = value['anchor'];
  return {
    id: readString(value, 'id', filePath),
    text: typeof value['text'] === 'string' ? (value['text'] as string) : invalid(filePath, 'text'),
    createdAt: readDate(value, 'createdAt', filePath),
    updatedAt: readDate(value, 'updatedAt', filePath),
    anchor: anchor === null || anchor === undefined ? null : validateAnchor(anchor, filePath),
  };
}

function validateRecord(value: unknown, filePath: string): FileReviewRecord {
  if (!isRecord(value)) {
    invalid(filePath, 'files[]');
  }
  const status = value['status'];
  if (!isReviewStatus(status)) {
    invalid(filePath, 'status');
  }
  const changeKind = value['changeKind'];
  if (!CHANGE_KINDS.includes(changeKind as ChangeKind)) {
    invalid(filePath, 'changeKind');
  }
  const reviewedAt = value['reviewedAt'];
  if (reviewedAt !== null && reviewedAt !== undefined) {
    if (typeof reviewedAt !== 'string' || Number.isNaN(Date.parse(reviewedAt))) {
      invalid(filePath, 'reviewedAt');
    }
  }
  return {
    path: readString(value, 'path', filePath),
    previousPath: readNullableString(value, 'previousPath', filePath),
    status,
    changeKind: changeKind as ChangeKind,
    lastReviewedFingerprint: readNullableString(value, 'lastReviewedFingerprint', filePath),
    lastReviewedComparisonCommit: readNullableString(
      value,
      'lastReviewedComparisonCommit',
      filePath,
    ),
    reviewedAt: reviewedAt === undefined ? null : (reviewedAt as string | null),
    createdAt: readDate(value, 'createdAt', filePath),
    updatedAt: readDate(value, 'updatedAt', filePath),
    notes: readArray(value, 'notes', filePath).map((note) => validateNote(note, filePath)),
  };
}

export function validateStoredSession(value: unknown, filePath: string): ReviewSession {
  if (!isRecord(value)) {
    invalid(filePath, 'корень документа');
  }
  const schemaVersion = value['schemaVersion'];
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    invalid(filePath, 'schemaVersion');
  }
  if (schemaVersion > REVIEW_SCHEMA_VERSION) {
    throw new StorageError(
      'unsupported-version',
      `Файл проверки «${filePath}» сохранён более новой версией схемы (${schemaVersion}), которая не поддерживается этой версией расширения. Файл не изменён.`,
      filePath,
    );
  }
  if (schemaVersion < REVIEW_SCHEMA_VERSION) {
    throw new StorageError(
      'unsupported-version',
      `Файл проверки «${filePath}» использует устаревшую версию схемы (${schemaVersion}), для которой миграция не реализована. Файл не изменён.`,
      filePath,
    );
  }
  const id = readString(value, 'id', filePath);
  if (!ID_PATTERN.test(id)) {
    invalid(filePath, 'id');
  }
  const repository = value['repository'];
  if (!isRecord(repository)) {
    invalid(filePath, 'repository');
  }
  const baseCommit = readNullableString(value, 'baseCommit', filePath);
  const comparisonCommit = readNullableString(value, 'comparisonCommit', filePath);
  return {
    schemaVersion,
    id,
    repository: {
      root: readString(repository, 'root', filePath),
      name: readString(repository, 'name', filePath),
    },
    baseRef: readString(value, 'baseRef', filePath),
    comparisonRef: readString(value, 'comparisonRef', filePath),
    baseCommit,
    comparisonCommit,
    createdAt: readDate(value, 'createdAt', filePath),
    updatedAt: readDate(value, 'updatedAt', filePath),
    files: readArray(value, 'files', filePath).map((record) => validateRecord(record, filePath)),
    historical: readArray(value, 'historical', filePath).map((record) =>
      validateRecord(record, filePath),
    ),
  };
}

function isEnoent(error: unknown): boolean {
  return isRecordLikeError(error) && error.code === 'ENOENT';
}

function isRecordLikeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export class ReviewStorage {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly reviewsDir: string) {}

  get directory(): string {
    return this.reviewsDir;
  }

  private fileFor(id: string): string {
    if (!ID_PATTERN.test(id)) {
      throw new StorageError(
        'invalid-id',
        `Недопустимый идентификатор проверки «${id}».`,
        this.reviewsDir,
      );
    }
    return path.join(this.reviewsDir, `${id}.json`);
  }

  async loadReview(id: string): Promise<ReviewSession | null> {
    const filePath = this.fileFor(id);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (isEnoent(error)) {
        return null;
      }
      throw new StorageError(
        'io-error',
        `Не удалось прочитать файл проверки «${filePath}».`,
        filePath,
        String(error),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new StorageError(
        'malformed-json',
        `Файл проверки «${filePath}» содержит некорректный JSON. Файл не изменён, данные не перезаписаны.`,
        filePath,
        String(error),
      );
    }
    return validateStoredSession(parsed, filePath);
  }

  async saveReview(session: ReviewSession): Promise<void> {
    const filePath = this.fileFor(session.id);
    const payload = `${JSON.stringify(session, null, 2)}\n`;
    const task = this.writeChain.then(() => this.writeFileAtomic(filePath, payload));
    this.writeChain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async writeFileAtomic(filePath: string, payload: string): Promise<void> {
    try {
      await fs.mkdir(this.reviewsDir, { recursive: true });
    } catch (error) {
      throw new StorageError(
        'io-error',
        `Не удалось создать каталог проверок «${this.reviewsDir}».`,
        filePath,
        String(error),
      );
    }
    const tmpPath = path.join(
      this.reviewsDir,
      `.${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`,
    );
    try {
      await fs.writeFile(tmpPath, payload, 'utf8');
      await fs.rename(tmpPath, filePath);
    } catch (error) {
      let cleanupDetail = '';
      try {
        await fs.rm(tmpPath, { force: true });
      } catch (cleanupError) {
        cleanupDetail = `; не удалось удалить временный файл: ${String(cleanupError)}`;
      }
      throw new StorageError(
        'io-error',
        `Не удалось сохранить файл проверки «${filePath}».`,
        filePath,
        `${String(error)}${cleanupDetail}`,
      );
    }
  }

  async deleteReview(id: string): Promise<void> {
    const filePath = this.fileFor(id);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (isEnoent(error)) {
        return;
      }
      throw new StorageError(
        'io-error',
        `Не удалось удалить файл проверки «${filePath}».`,
        filePath,
        String(error),
      );
    }
  }

  async listReviews(): Promise<ListReviewsResult> {
    const reviews: ReviewSummary[] = [];
    const errors: ListReviewsResult['errors'] = [];
    let entries: string[];
    try {
      entries = await fs.readdir(this.reviewsDir);
    } catch (error) {
      if (isEnoent(error)) {
        return { reviews, errors };
      }
      throw new StorageError(
        'io-error',
        `Не удалось прочитать каталог проверок «${this.reviewsDir}».`,
        this.reviewsDir,
        String(error),
      );
    }
    for (const entry of [...entries].sort()) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const id = entry.slice(0, -'.json'.length);
      try {
        const session = await this.loadReview(id);
        if (session === null) {
          continue;
        }
        reviews.push(toSummary(session));
      } catch (error) {
        errors.push({ file: entry, message: toUserMessage(error) });
      }
    }
    return { reviews, errors };
  }
}

export function toSummary(session: ReviewSession): ReviewSummary {
  const stats = calculateProgress(session.files);
  return {
    id: session.id,
    repositoryRoot: session.repository.root,
    repositoryName: session.repository.name,
    baseRef: session.baseRef,
    comparisonRef: session.comparisonRef,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    fileCount: stats.total,
    reviewedCount: stats.reviewed,
    percentage: stats.percentage,
  };
}
