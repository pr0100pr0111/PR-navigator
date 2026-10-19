export type StorageErrorCode =
  | 'not-found'
  | 'malformed-json'
  | 'unsupported-version'
  | 'invalid-schema'
  | 'invalid-id'
  | 'io-error';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly filePath: string;
  readonly detail: string | undefined;

  constructor(code: StorageErrorCode, message: string, filePath: string, detail?: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.filePath = filePath;
    this.detail = detail;
  }
}

export interface ReviewSummary {
  id: string;
  repositoryRoot: string;
  repositoryName: string;
  baseRef: string;
  comparisonRef: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
  reviewedCount: number;
  percentage: number;
}

export interface ListReviewsResult {
  reviews: ReviewSummary[];
  errors: StorageListError[];
}

export interface StorageListError {
  file: string;
  message: string;
}
