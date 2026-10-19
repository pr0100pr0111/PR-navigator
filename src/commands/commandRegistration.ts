import * as vscode from 'vscode';
import { CommandHandler, CommandMap } from './reviewCommands';

export const COMMAND_IDS = {
  startReview: 'prNavigator.startReview',
  openReview: 'prNavigator.openReview',
  refreshReview: 'prNavigator.refreshReview',
  exportReport: 'prNavigator.exportReport',
  changeStatus: 'prNavigator.changeStatus',
  markInProgress: 'prNavigator.markInProgress',
  markReviewed: 'prNavigator.markReviewed',
  markNeedsReReview: 'prNavigator.markNeedsReReview',
  markNotReviewed: 'prNavigator.markNotReviewed',
  openDiff: 'prNavigator.openDiff',
  addFileNote: 'prNavigator.addFileNote',
  addLineNote: 'prNavigator.addLineNote',
  manageNotes: 'prNavigator.manageNotes',
} as const;

const HANDLER_BY_ID: Record<string, keyof CommandMap> = {
  [COMMAND_IDS.startReview]: 'startReview',
  [COMMAND_IDS.openReview]: 'openReview',
  [COMMAND_IDS.refreshReview]: 'refreshReview',
  [COMMAND_IDS.exportReport]: 'exportReport',
  [COMMAND_IDS.changeStatus]: 'changeStatus',
  [COMMAND_IDS.markInProgress]: 'markInProgress',
  [COMMAND_IDS.markReviewed]: 'markReviewed',
  [COMMAND_IDS.markNeedsReReview]: 'markNeedsReReview',
  [COMMAND_IDS.markNotReviewed]: 'markNotReviewed',
  [COMMAND_IDS.openDiff]: 'openDiff',
  [COMMAND_IDS.addFileNote]: 'addFileNote',
  [COMMAND_IDS.addLineNote]: 'addLineNote',
  [COMMAND_IDS.manageNotes]: 'manageNotes',
};

export function registerCommands(
  context: vscode.ExtensionContext,
  commands: CommandMap,
): void {
  for (const [id, handlerKey] of Object.entries(HANDLER_BY_ID)) {
    const handler: CommandHandler | undefined = commands[handlerKey];
    if (handler === undefined) {
      continue;
    }
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (arg?: unknown) => handler(arg)),
    );
  }
}
