import * as vscode from 'vscode';
import { registerCommands } from './commands/commandRegistration';
import { createCommands } from './commands/reviewCommands';
import { GitService } from './git/gitService';
import { DiffContentProvider, DIFF_SCHEME } from './providers/diffContentProvider';
import { ReviewTreeProvider } from './providers/reviewTreeProvider';
import { ReviewManager } from './review/reviewManager';
import { calculateProgress } from './review/reviewProgress';
import { Logger } from './utils/errorHandling';

function createLogger(output: vscode.OutputChannel): Logger {
  return {
    log(message: string): void {
      output.appendLine(`[${new Date().toISOString()}] ${message}`);
    },
  };
}

const COMMAND_STATUS_ACTION = 'prNavigator.refreshReview';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('PR Navigator');
  const logger = createLogger(output);
  const git = new GitService(logger);
  const manager = new ReviewManager(git, logger);
  const treeProvider = new ReviewTreeProvider(manager);

  const treeView = vscode.window.createTreeView('prNavigator', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  const diffProvider = new DiffContentProvider(git, logger);

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = COMMAND_STATUS_ACTION;

  const updateStatusBar = (): void => {
    const session = manager.getSession();
    if (session === null) {
      statusBar.hide();
      return;
    }
    const stats = calculateProgress(session.files);
    statusBar.text = `PR Navigator: ${stats.percentage}%`;
    statusBar.tooltip = `${session.baseRef} → ${session.comparisonRef}: проверено ${stats.reviewed} из ${stats.total}`;
    statusBar.show();
  };

  manager.onChange(() => {
    treeProvider.refresh();
    updateStatusBar();
  });

  const commands = createCommands({ manager, git, output });
  registerCommands(context, commands);

  context.subscriptions.push(
    output,
    treeView,
    statusBar,
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffProvider),
    { dispose: () => manager.dispose() },
  );

  updateStatusBar();
  void autoRestoreSingleReview(git, manager, output);
}

async function autoRestoreSingleReview(
  git: GitService,
  manager: ReviewManager,
  output: vscode.OutputChannel,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return;
  }
  try {
    const roots = await git.findRepositoryRoots(folders.map((folder) => folder.uri.fsPath));
    for (const root of roots) {
      const listed = await manager.listReviews(root);
      if (listed.reviews.length !== 1) {
        continue;
      }
      const summary = listed.reviews[0];
      if (summary === undefined) {
        continue;
      }
      const restored = await manager.restoreReview(root, summary.id);
      output.appendLine(
        `Автоматически восстановлена проверка ${restored.session.baseRef} → ${restored.session.comparisonRef}.`,
      );
      if (restored.warning !== null) {
        void vscode.window.showWarningMessage(
          `PR Navigator: проверка восстановлена с предупреждением: ${restored.warning}`,
        );
      }
      return;
    }
  } catch (error) {
    output.appendLine(`Автовосстановление проверки не выполнено: ${String(error)}`);
  }
}

export function deactivate(): void {
  return undefined;
}
