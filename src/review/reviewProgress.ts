import { FileReviewRecord } from './reviewTypes';

export interface ProgressStats {
  total: number;
  notReviewed: number;
  inProgress: number;
  reviewed: number;
  needsReReview: number;
  percentage: number;
}

export function calculateProgress(files: readonly FileReviewRecord[]): ProgressStats {
  let notReviewed = 0;
  let inProgress = 0;
  let reviewed = 0;
  let needsReReview = 0;

  for (const file of files) {
    if (file.status === 'Reviewed') {
      reviewed += 1;
    } else if (file.status === 'InProgress') {
      inProgress += 1;
    } else if (file.status === 'NeedsReReview') {
      needsReReview += 1;
    } else {
      notReviewed += 1;
    }
  }

  const total = files.length;
  const percentage = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  return { total, notReviewed, inProgress, reviewed, needsReReview, percentage };
}
