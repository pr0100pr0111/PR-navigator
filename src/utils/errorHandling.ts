export interface Logger {
  log(message: string): void;
}

export const silentLogger: Logger = {
  log: () => undefined,
};

export function toUserMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Произошла непредвиденная ошибка.';
}

export function isCancellationError(error: unknown): boolean {
  return error instanceof Error && error.name === 'CancellationError';
}
