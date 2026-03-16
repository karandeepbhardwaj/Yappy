import * as vscode from 'vscode';
import { getConfig } from '../config/Settings';

export class TextInserter {
  /** Inserts or replaces text in the active editor. Returns true if the edit was successfully applied, false if there was no active editor. */
  async insert(text: string): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('SunYapper: No active editor to insert text into.');
      return false;
    }

    const config = getConfig();

    return editor.edit(editBuilder => {
      if (config.insertMode === 'replace' && !editor.selection.isEmpty) {
        editBuilder.replace(editor.selection, text);
      } else {
        editBuilder.insert(editor.selection.active, text);
      }
    });
  }
}
