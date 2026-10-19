import * as vscode from 'vscode';
import { ReviewManager } from '../review/reviewManager';
import { STATUS_GROUP_ORDER } from '../review/reviewState';
import { FileReviewRecord } from '../review/reviewTypes';
import {
  ReviewEmptyTreeItem,
  ReviewFileTreeItem,
  ReviewGroupTreeItem,
  ReviewNoteTreeItem,
} from './reviewTreeItem';

export type TreeNode = ReviewGroupTreeItem | ReviewFileTreeItem | ReviewNoteTreeItem | ReviewEmptyTreeItem;

export class ReviewTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly parentByPath = new Map<string, ReviewGroupTreeItem>();
  private readonly parentByNoteId = new Map<string, ReviewFileTreeItem>();

  constructor(private readonly manager: ReviewManager) {}

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (element === undefined) {
      return this.getRootItems();
    }
    if (element instanceof ReviewGroupTreeItem) {
      return this.getGroupChildren(element);
    }
    if (element instanceof ReviewFileTreeItem) {
      return this.getFileChildren(element);
    }
    return [];
  }

  getParent(element: TreeNode): TreeNode | null {
    if (element instanceof ReviewFileTreeItem) {
      return this.parentByPath.get(element.record.path) ?? null;
    }
    if (element instanceof ReviewNoteTreeItem) {
      return this.parentByNoteId.get(element.note.id) ?? null;
    }
    return null;
  }

  private getRootItems(): TreeNode[] {
    const session = this.manager.getSession();
    if (session === null) {
      return [
        new ReviewEmptyTreeItem(
          'Нет активной проверки. Выполните «Начать новую проверку» из меню вида.',
        ),
      ];
    }
    if (session.files.length === 0) {
      return [new ReviewEmptyTreeItem('В сравнении нет изменённых файлов.')];
    }
    this.parentByPath.clear();
    this.parentByNoteId.clear();
    const items: TreeNode[] = [];
    for (const status of STATUS_GROUP_ORDER) {
      const records = session.files.filter((record) => record.status === status);
      if (records.length === 0) {
        continue;
      }
      const group = new ReviewGroupTreeItem(status, records.length);
      for (const record of records) {
        this.parentByPath.set(record.path, group);
      }
      items.push(group);
    }
    return items;
  }

  private getGroupChildren(group: ReviewGroupTreeItem): TreeNode[] {
    const session = this.manager.getSession();
    if (session === null) {
      return [];
    }
    const records = session.files
      .filter((record) => record.status === group.status)
      .sort(compareRecords);
    return records.map((record) => new ReviewFileTreeItem(record));
  }

  private getFileChildren(fileItem: ReviewFileTreeItem): TreeNode[] {
    return fileItem.record.notes.map((note) => {
      this.parentByNoteId.set(note.id, fileItem);
      return new ReviewNoteTreeItem(fileItem.record.path, note);
    });
  }
}

function compareRecords(left: FileReviewRecord, right: FileReviewRecord): number {
  return left.path.localeCompare(right.path);
}
