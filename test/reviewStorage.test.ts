import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ReviewStorage, toSummary } from '../src/storage/reviewStorage';
import { StorageError } from '../src/storage/storageTypes';
import { ReviewSession, REVIEW_SCHEMA_VERSION } from '../src/review/reviewTypes';

let tmpDir: string;
let counter = 0;

function makeSession(id: string): ReviewSession {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    id,
    repository: { root: '/tmp/example-repo', name: 'example-repo' },
    baseRef: 'refs/heads/main',
    comparisonRef: 'refs/heads/feature',
    baseCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    comparisonCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-01-12T09:30:00.000Z',
    files: [
      {
        path: 'src/app.ts',
        previousPath: null,
        status: 'Reviewed',
        changeKind: 'modified',
        lastReviewedFingerprint: 'fp-app',
        lastReviewedComparisonCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        reviewedAt: '2026-01-11T10:00:00.000Z',
        createdAt: '2026-01-10T08:05:00.000Z',
        updatedAt: '2026-01-11T10:00:00.000Z',
        notes: [
          {
            id: 'note-file-1',
            text: 'Файловая заметка про *специальные* символы',
            createdAt: '2026-01-11T10:01:00.000Z',
            updatedAt: '2026-01-11T10:01:00.000Z',
            anchor: null,
          },
          {
            id: 'note-line-1',
            text: 'Проверить эту строку',
            createdAt: '2026-01-11T10:02:00.000Z',
            updatedAt: '2026-01-11T10:02:00.000Z',
            anchor: {
              side: 'new',
              line: 42,
              lineText: 'const value = compute();',
              contextBefore: ['function run() {', 'let x = 1;'],
              contextAfter: ['return value;', '}'],
              contextHash: 'hash-123',
              resolution: 'resolved',
              resolvedLine: 45,
            },
          },
        ],
      },
      {
        path: 'docs/readme.md',
        previousPath: null,
        status: 'NotReviewed',
        changeKind: 'added',
        lastReviewedFingerprint: null,
        lastReviewedComparisonCommit: null,
        reviewedAt: null,
        createdAt: '2026-01-10T08:05:00.000Z',
        updatedAt: '2026-01-10T08:05:00.000Z',
        notes: [],
      },
    ],
    historical: [],
  };
}

beforeEach(async () => {
  counter += 1;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `prnav-storage-${counter}-`));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ReviewStorage: сохранение и загрузка', () => {
  it('сохраняет и загружает проверку со статусами, заметками и метками времени', async () => {
    const storage = new ReviewStorage(tmpDir);
    const session = makeSession('review-abc');
    await storage.saveReview(session);
    const loaded = await storage.loadReview('review-abc');
    expect(loaded).toEqual(session);
    expect(loaded?.files[0]?.status).toBe('Reviewed');
    expect(loaded?.files[0]?.notes).toHaveLength(2);
    expect(loaded?.files[0]?.notes[1]?.anchor?.line).toBe(42);
    expect(loaded?.files[0]?.notes[1]?.anchor?.resolvedLine).toBe(45);
    expect(loaded?.createdAt).toBe('2026-01-10T08:00:00.000Z');
    expect(loaded?.updatedAt).toBe('2026-01-12T09:30:00.000Z');
    expect(loaded?.files[0]?.reviewedAt).toBe('2026-01-11T10:00:00.000Z');
  });

  it('сохраняет и загружает пустую проверку', async () => {
    const storage = new ReviewStorage(tmpDir);
    const session = makeSession('review-empty');
    session.files = [];
    session.historical = [];
    await storage.saveReview(session);
    const loaded = await storage.loadReview('review-empty');
    expect(loaded?.files).toHaveLength(0);
    expect(toSummary(loaded as ReviewSession).percentage).toBe(0);
  });

  it('возвращает null для отсутствующего файла', async () => {
    const storage = new ReviewStorage(path.join(tmpDir, 'missing-dir'));
    expect(await storage.loadReview('review-none')).toBeNull();
    const listed = await storage.listReviews();
    expect(listed.reviews).toHaveLength(0);
    expect(listed.errors).toHaveLength(0);
  });

  it('создаёт родительские каталоги при записи', async () => {
    const storage = new ReviewStorage(path.join(tmpDir, 'a', 'b', 'c'));
    await storage.saveReview(makeSession('review-nested'));
    expect(await storage.loadReview('review-nested')).not.toBeNull();
  });
});

describe('ReviewStorage: повреждённые данные', () => {
  it('некорректный JSON даёт контролируемую ошибку и не перезаписывает файл', async () => {
    const storage = new ReviewStorage(tmpDir);
    const filePath = path.join(tmpDir, 'review-broken.json');
    await fs.writeFile(filePath, '{ это не json', 'utf8');
    await expect(storage.loadReview('review-broken')).rejects.toMatchObject({
      name: 'StorageError',
      code: 'malformed-json',
    });
    const rawAfter = await fs.readFile(filePath, 'utf8');
    expect(rawAfter).toBe('{ это не json');
  });

  it('неподдерживаемая версия схемы обрабатывается безопасно', async () => {
    const storage = new ReviewStorage(tmpDir);
    const session = makeSession('review-future');
    const payload = JSON.parse(JSON.stringify(session)) as Record<string, unknown>;
    payload['schemaVersion'] = 999;
    await fs.writeFile(path.join(tmpDir, 'review-future.json'), JSON.stringify(payload), 'utf8');
    await expect(storage.loadReview('review-future')).rejects.toMatchObject({
      code: 'unsupported-version',
    });
    payload['schemaVersion'] = 0;
    await fs.writeFile(path.join(tmpDir, 'review-future.json'), JSON.stringify(payload), 'utf8');
    await expect(storage.loadReview('review-future')).rejects.toMatchObject({
      code: 'unsupported-version',
    });
  });

  it('нарушение схемы даёт invalid-schema, а не пустое состояние', async () => {
    const storage = new ReviewStorage(tmpDir);
    const session = makeSession('review-invalid');
    const payload = JSON.parse(JSON.stringify(session)) as Record<string, unknown>;
    const files = payload['files'] as Array<Record<string, unknown>>;
    files[0]!['status'] = 'Проверен';
    await fs.writeFile(path.join(tmpDir, 'review-invalid.json'), JSON.stringify(payload), 'utf8');
    await expect(storage.loadReview('review-invalid')).rejects.toMatchObject({
      code: 'invalid-schema',
    });
  });

  it('недопустимый идентификатор отклоняется (защита от path traversal)', async () => {
    const storage = new ReviewStorage(tmpDir);
    await expect(storage.loadReview('../outside')).rejects.toMatchObject({ code: 'invalid-id' });
    await expect(storage.saveReview({ ...makeSession('x'), id: '../evil' })).rejects.toMatchObject(
      { code: 'invalid-id' },
    );
  });

  it('повреждённый файл не мешает загрузке других проверок', async () => {
    const storage = new ReviewStorage(tmpDir);
    await storage.saveReview(makeSession('review-good'));
    await fs.writeFile(path.join(tmpDir, 'review-bad.json'), 'null', 'utf8');
    const listed = await storage.listReviews();
    expect(listed.reviews.map((review) => review.id)).toEqual(['review-good']);
    expect(listed.errors).toHaveLength(1);
    expect(listed.errors[0]?.file).toBe('review-bad.json');
    expect(listed.errors[0]?.message).toContain('не соответствует');
  });
});

describe('ReviewStorage: целостность данных', () => {
  it('сохранение одной проверки не портит другую', async () => {
    const storage = new ReviewStorage(tmpDir);
    await storage.saveReview(makeSession('review-one'));
    const other = makeSession('review-two');
    other.files[0]!.status = 'NeedsReReview';
    await storage.saveReview(other);
    const first = await storage.loadReview('review-one');
    const second = await storage.loadReview('review-two');
    expect(first?.files[0]?.status).toBe('Reviewed');
    expect(second?.files[0]?.status).toBe('NeedsReReview');
  });

  it('параллельные записи сериализуются и не теряют данные', async () => {
    const storage = new ReviewStorage(tmpDir);
    const sessions = ['review-p1', 'review-p2', 'review-p3', 'review-p4'].map((id, index) => {
      const session = makeSession(id);
      session.updatedAt = `2026-02-0${index + 1}T00:00:00.000Z`;
      return session;
    });
    await Promise.all(sessions.map((session) => storage.saveReview(session)));
    const listed = await storage.listReviews();
    expect(listed.reviews).toHaveLength(4);
    for (const session of sessions) {
      const loaded = await storage.loadReview(session.id);
      expect(loaded?.updatedAt).toBe(session.updatedAt);
    }
  });

  it('повторная запись обновляет файл целиком', async () => {
    const storage = new ReviewStorage(tmpDir);
    const session = makeSession('review-rewrite');
    await storage.saveReview(session);
    const updated: ReviewSession = {
      ...session,
      updatedAt: '2026-05-05T05:05:05.000Z',
      files: session.files.slice(0, 1),
    };
    await storage.saveReview(updated);
    const loaded = await storage.loadReview('review-rewrite');
    expect(loaded?.updatedAt).toBe('2026-05-05T05:05:05.000Z');
    expect(loaded?.files).toHaveLength(1);
    expect(loaded?.files[0]?.notes).toHaveLength(2);
  });

  it('удаление проверки идемпотентно', async () => {
    const storage = new ReviewStorage(tmpDir);
    await storage.saveReview(makeSession('review-del'));
    await storage.deleteReview('review-del');
    expect(await storage.loadReview('review-del')).toBeNull();
    await storage.deleteReview('review-del');
    await expect(storage.deleteReview('../bad')).rejects.toBeInstanceOf(StorageError);
  });
});
