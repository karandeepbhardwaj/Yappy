import * as vscode from 'vscode';

export interface SunYapperConfig {
  whisperModel: 'tiny' | 'base' | 'small';
  language: string;
  refinementEnabled: boolean;
  copilotModelFamily: string;
  insertMode: 'cursor' | 'replace';
}

export function getConfig(): SunYapperConfig {
  const config = vscode.workspace.getConfiguration('sunyapper');
  return {
    whisperModel: config.get<'tiny' | 'base' | 'small'>('whisperModel', 'base'),
    language: config.get<string>('language', 'en'),
    refinementEnabled: config.get<boolean>('refinementEnabled', true),
    copilotModelFamily: config.get<string>('copilotModelFamily', 'gpt-4o'),
    insertMode: config.get<'cursor' | 'replace'>('insertMode', 'cursor'),
  };
}
