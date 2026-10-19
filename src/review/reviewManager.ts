import { basename } from 'node:path';
import { ComparisonSnapshot } from '../git/gitTypes';
import { GitService } from '../git/gitService';
import {
  createFileNote,
  createLineNote,
  findNote,
  refreshNoteAnchors,
  removeNote,
  updateNoteText,
} from '../notes/noteManager';
import { AnchorSide, ReviewNote } from '../notes/noteTypes';
import { ReviewStorage } from '../storage/reviewStorage';
import { ListReviewsResult } from '../storage/storageTypes';
import { Logger, silentLogger, toUserMessage } from '../utils/errorHandling';
import { resolveReviewsDir } from '../utils/pathUtils';
import { activeFingerprintOf, detectChanges, DetectionResult } from './changeDetector';
import { applyStatusChange, computeReviewId } from './reviewState';
import {
  FileReviewRecord,
  REVIEW_SCHEMA_VERSION,
  ReviewSession,
  ReviewStatus,
} from './reviewTypes';

export type ReviewChangeListener = () => void;

export interface OpenReviewResult {
  session: ReviewSession;
  created: boolean;
  detection: DetectionResult;
}

export interface RestoreResult {
  session: ReviewSession;
  detection: DetectionResult | null;
  warning: string | null;
}

export interface RefreshResult {
  session: ReviewSession;
  detection: DetectionResult;
  anchorsUpdated: number;
}

const NO_SESSION_MESSAGE =
  'Нет активной проверки. Сначала выполните «PR Navigator: Начать новую проверку».';
const NO_SNAPSHOT_MESSAGE =
  'Снимок сравнения недоступен. Выполните «PR Navigator: Обновить проверку» или откройте проверку заново.';

export class ReviewManager {
  private session: ReviewSession | null = null;
  private snapshot: ComparisonSnapshot | null = null;
  private storage: ReviewStorage | null = null;
  private repositoryRoot: string | null = null;
  private readonly listeners = new Set<ReviewChangeListener>();

  constructor(
    private readonly git: GitService,
    private readonly logger: Logger = silentLogger,
  ) {}

  onChange(listener: ReviewChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.logger.log(`Ошибка обработчика изменения проверки: ${String(error)}`);
      }
    }
  }

  getSession(): ReviewSession | null {
    return this.session;
  }

  getSnapshot(): ComparisonSnapshot | null {
    return this.snapshot;
  }

  requireSnapshot(): ComparisonSnapshot {
    if (this.snapshot === null) {
      throw new Error(NO_SNAPSHOT_MESSAGE);
    }
    return this.snapshot;
  }

  getRepositoryRoot(): string | null {
    return this.repositoryRoot;
  }

  private requireSession(): ReviewSession {
    if (this.session === null || this.storage === null || this.repositoryRoot === null) {
      throw new Error(NO_SESSION_MESSAGE);
    }
    return this.session;
  }

  private requireStorage(): ReviewStorage {
    if (this.storage === null) {
      throw new Error(NO_SESSION_MESSAGE);
    }
    return this.storage;
  }

  async listReviews(repositoryRoot: string): Promise<ListReviewsResult> {
    const storage = new ReviewStorage(resolveReviewsDir(repositoryRoot));
    return storage.listReviews();
  }

  async openReview(
    repositoryRoot: string,
    baseRef: string,
    comparisonRef: string,
  ): Promise<OpenReviewResult> {
    const id = computeReviewId(repositoryRoot, baseRef, comparisonRef);
    const storage = new ReviewStorage(resolveReviewsDir(repositoryRoot));
    const existing = await storage.loadReview(id);
    const snapshot = await this.git.createSnapshot(repositoryRoot, baseRef, comparisonRef);
    const now = new Date().toISOString();
    const detection = detectChanges({
      previousFiles: existing === null ? [] : existing.files,
      previousHistorical: existing === null ? [] : existing.historical,
      snapshot,
      now,
    });
    const session: ReviewSession = {
      schemaVersion: REVIEW_SCHEMA_VERSION,
      id,
      repository: { root: repositoryRoot, name: basename(repositoryRoot) },
      baseRef,
      comparisonRef,
      baseCommit: snapshot.baseCommit,
      comparisonCommit: snapshot.comparisonCommit,
      createdAt: existing === null ? now : existing.createdAt,
      updatedAt: now,
      files: detection.files,
      historical: detection.historical,
    };
    await storage.saveReview(session);
    this.session = session;
    this.snapshot = snapshot;
    this.storage = storage;
    this.repositoryRoot = repositoryRoot;
    this.notify();
    this.logger.log(`Проверка ${id} открыта, активных файлов: ${session.files.length}`);
    return { session, created: existing === null, detection };
  }

  async restoreReview(repositoryRoot: string, id: string): Promise<RestoreResult> {
    const storage = new ReviewStorage(resolveReviewsDir(repositoryRoot));
    const loaded = await storage.loadReview(id);
    if (loaded === null) {
      throw new Error(`Сохранённая проверка «${id}» не найдена.`);
    }
    const rootChanged = loaded.repository.root !== repositoryRoot;
    let session: ReviewSession = rootChanged
      ? { ...loaded, repository: { root: repositoryRoot, name: basename(repositoryRoot) } }
      : loaded;
    this.session = session;
    this.storage = storage;
    this.repositoryRoot = repositoryRoot;
    this.snapshot = null;

    let detection: DetectionResult | null = null;
    let warning: string | null = null;
    try {
      const snapshot = await this.git.createSnapshot(
        repositoryRoot,
        session.baseRef,
        session.comparisonRef,
      );
      const now = new Date().toISOString();
      detection = detectChanges({
        previousFiles: session.files,
        previousHistorical: session.historical,
        snapshot,
        now,
      });
      session = {
        ...session,
        baseCommit: snapshot.baseCommit,
        comparisonCommit: snapshot.comparisonCommit,
        updatedAt: now,
        files: detection.files,
        historical: detection.historical,
      };
      await storage.saveReview(session);
      this.snapshot = snapshot;
    } catch (error) {
      warning = toUserMessage(error);
      this.logger.log(`Сравнение не рассчитано при восстановлении проверки: ${warning}`);
      if (rootChanged) {
        await storage.saveReview(session);
      }
    }
    this.session = session;
    this.notify();
    return { session, detection, warning };
  }

  async refresh(): Promise<RefreshResult> {
    const session = this.requireSession();
    const storage = this.requireStorage();
    const repositoryRoot = this.repositoryRoot as string;
    const snapshot = await this.git.createSnapshot(
      repositoryRoot,
      session.baseRef,
      session.comparisonRef,
    );
    const now = new Date().toISOString();
    const detection = detectChanges({
      previousFiles: session.files,
      previousHistorical: session.historical,
      snapshot,
      now,
    });
    let anchorsUpdated = 0;
    const files: FileReviewRecord[] = [];
    for (const record of detection.files) {
      const hasLineNotes = record.notes.some((note) => note.anchor !== null);
      if (!hasLineNotes) {
        files.push(record);
        continue;
      }
      const oldPath = record.previousPath ?? record.path;
      const newContent = await this.loadSideContent(snapshot.comparisonCommit, record.path);
      const oldContent = await this.loadSideContent(snapshot.baseCommit, oldPath);
      const outcome = refreshNoteAnchors(record.notes, newContent, oldContent);
      if (outcome.changed) {
        anchorsUpdated += 1;
        files.push({ ...record, notes: outcome.notes });
      } else {
        files.push(record);
      }
    }
    const updated: ReviewSession = {
      ...session,
      baseCommit: snapshot.baseCommit,
      comparisonCommit: snapshot.comparisonCommit,
      updatedAt: now,
      files,
      historical: detection.historical,
    };
    await storage.saveReview(updated);
    this.session = updated;
    this.snapshot = snapshot;
    this.notify();
    this.logger.log(
      `Проверка обновлена: новых ${detection.addedPaths.length}, устаревших ${detection.stalePaths.length}, в архив ${detection.archivedPaths.length}`,
    );
    return { session: updated, detection, anchorsUpdated };
  }

  private async loadSideContent(commit: string, filePath: string): Promise<string | null> {
    try {
      const result = await this.git.showFileContent(
        this.repositoryRoot as string,
        commit,
        filePath,
      );
      return result.present ? result.content.toString('utf8') : null;
    } catch (error) {
      this.logger.log(
        `Не удалось прочитать ${filePath}@${commit} для обновления якорей: ${toUserMessage(error)}`,
      );
      return null;
    }
  }

  async setStatus(filePath: string, status: ReviewStatus): Promise<FileReviewRecord> {
    const session = this.requireSession();
    const storage = this.requireStorage();
    const index = session.files.findIndex((record) => record.path === filePath);
    if (index === -1) {
      throw new Error(`Файл «${filePath}» не найден в активной проверке.`);
    }
    const record = session.files[index] as FileReviewRecord;
    const entry = this.snapshot?.entries.find(
      (candidate) => (candidate.newPath ?? candidate.oldPath) === filePath,
    );
    const currentFingerprint = entry === undefined ? null : activeFingerprintOf(entry);
    const now = new Date().toISOString();
    const updatedRecord = applyStatusChange(record, status, {
      comparisonCommit: session.comparisonCommit,
      currentFingerprint,
      now,
    });
    const files = [...session.files];
    files[index] = updatedRecord;
    const updated: ReviewSession = { ...session, updatedAt: now, files };
    await storage.saveReview(updated);
    this.session = updated;
    this.notify();
    return updatedRecord;
  }

  private async mutateRecord(
    filePath: string,
    mutate: (record: FileReviewRecord, now: string) => FileReviewRecord,
  ): Promise<FileReviewRecord> {
    const session = this.requireSession();
    const storage = this.requireStorage();
    const index = session.files.findIndex((record) => record.path === filePath);
    if (index === -1) {
      throw new Error(`Файл «${filePath}» не найден в активной проверке.`);
    }
    const now = new Date().toISOString();
    const record = session.files[index] as FileReviewRecord;
    const updatedRecord = mutate(record, now);
    const files = [...session.files];
    files[index] = updatedRecord;
    const updated: ReviewSession = { ...session, updatedAt: now, files };
    await storage.saveReview(updated);
    this.session = updated;
    this.notify();
    return updatedRecord;
  }

  async addFileNote(filePath: string, text: string): Promise<ReviewNote> {
    const note = createFileNote(text, new Date().toISOString());
    await this.mutateRecord(filePath, (record) => ({
      ...record,
      notes: [...record.notes, note],
    }));
    return note;
  }

  async addLineNote(
    filePath: string,
    text: string,
    content: string,
    lineIndex: number,
    side: AnchorSide,
  ): Promise<ReviewNote> {
    const note = createLineNote(text, content, lineIndex, side, new Date().toISOString());
    await this.mutateRecord(filePath, (record) => ({
      ...record,
      notes: [...record.notes, note],
    }));
    return note;
  }

  async updateNote(filePath: string, noteId: string, text: string): Promise<ReviewNote> {
    const session = this.requireSession();
    const record = session.files.find((candidate) => candidate.path === filePath);
    if (record === undefined) {
      throw new Error(`Файл «${filePath}» не найден в активной проверке.`);
    }
    const existing = findNote(record.notes, noteId);
    if (existing === null) {
      throw new Error('Заметка не найдена.');
    }
    const updatedNote = updateNoteText(existing, text, new Date().toISOString());
    await this.mutateRecord(filePath, (current) => ({
      ...current,
      notes: current.notes.map((note) => (note.id === noteId ? updatedNote : note)),
    }));
    return updatedNote;
  }

  async deleteNote(filePath: string, noteId: string): Promise<void> {
    await this.mutateRecord(filePath, (record) => ({
      ...record,
      notes: removeNote(record.notes, noteId),
    }));
  }

  getRecord(filePath: string): FileReviewRecord | null {
    return this.session?.files.find((record) => record.path === filePath) ?? null;
  }

  dispose(): void {
    this.listeners.clear();
  }
}
