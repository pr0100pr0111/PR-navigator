import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { Logger, toUserMessage } from '../utils/errorHandling';

export const DIFF_SCHEME = 'pr-navigator';

export interface DiffUriQuery {
  root: string;
  commit: string;
  filePath: string;
}

export function buildDiffUri(query: DiffUriQuery): vscode.Uri {
  return vscode.Uri.from({
    scheme: DIFF_SCHEME,
    path: `/${query.filePath}`,
    query: new URLSearchParams({
      root: query.root,
      commit: query.commit,
      path: query.filePath,
    }).toString(),
  });
}

export function parseDiffUri(uri: vscode.Uri): DiffUriQuery | null {
  const params = new URLSearchParams(uri.query);
  const root = params.get('root');
  const commit = params.get('commit');
  const filePath = params.get('path');
  if (root === null || commit === null || filePath === null) {
    return null;
  }
  return { root, commit, filePath };
}

const BINARY_MESSAGE = 'Файл является бинарным, текстовое сравнение недоступно.';
const MISSING_MESSAGE = 'Файл недоступен в указанной версии репозитория.';
const MALFORMED_MESSAGE = 'Некорректный URI сравнения.';

export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly git: GitService,
    private readonly logger: Logger,
  ) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const query = parseDiffUri(uri);
    if (query === null) {
      return MALFORMED_MESSAGE;
    }
    try {
      const result = await this.git.showFileContent(query.root, query.commit, query.filePath);
      if (!result.present) {
        return MISSING_MESSAGE;
      }
      if (result.content.includes(0)) {
        return BINARY_MESSAGE;
      }
      return result.content.toString('utf8');
    } catch (error) {
      const message = toUserMessage(error);
      this.logger.log(`Не удалось загрузить содержимое для сравнения: ${message}`);
      return `Не удалось загрузить содержимое файла: ${message}`;
    }
  }
}
