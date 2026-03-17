import * as vscode from 'vscode';

export interface ActionSpec {
  kind: 'terminal_run' | 'vscode_command' | 'search' | 'open_file' | 'git';
  command: string;
  description: string;
  risk: 'safe' | 'destructive';
}

const DENY_PATTERNS = ['rm -rf', 'sudo rm', 'format c:', 'del /s', 'shutdown', 'reboot'];

function checkDenyList(command: string): boolean {
  const lower = command.toLowerCase();
  return DENY_PATTERNS.some((pattern) => lower.includes(pattern));
}

let yapperTerminal: vscode.Terminal | undefined;

function getTerminal(): vscode.Terminal {
  // Reuse if still alive
  if (yapperTerminal && yapperTerminal.exitStatus === undefined) {
    return yapperTerminal;
  }
  // Check among open terminals
  const existing = vscode.window.terminals.find((t) => t.name === 'yapper');
  if (existing) {
    yapperTerminal = existing;
    return existing;
  }
  yapperTerminal = vscode.window.createTerminal('yapper');
  return yapperTerminal;
}

export class ActionExecutor {
  async execute(action: ActionSpec): Promise<{ success: boolean; message: string }> {
    // Enforce deny list — upgrade risk to destructive but still block execution
    if (checkDenyList(action.command)) {
      return {
        success: false,
        message: `Blocked: command matches a deny pattern (${action.command})`,
      };
    }

    try {
      switch (action.kind) {
        case 'terminal_run':
        case 'git': {
          const terminal = getTerminal();
          terminal.show();
          terminal.sendText(action.command);
          return { success: true, message: `Ran in terminal: ${action.command}` };
        }

        case 'vscode_command': {
          // Validate the command exists before executing
          const allCommands = await vscode.commands.getCommands(true);
          if (!allCommands.includes(action.command)) {
            // Command doesn't exist — try opening in terminal as fallback
            const terminal = getTerminal();
            terminal.show();
            terminal.sendText(action.command);
            return { success: true, message: `Command ID not found in VS Code. Ran in terminal: ${action.command}` };
          }
          await vscode.commands.executeCommand(action.command);
          return { success: true, message: `Executed: ${action.description}` };
        }

        case 'search': {
          await vscode.commands.executeCommand('workbench.action.findInFiles', {
            query: action.command,
          });
          return { success: true, message: `Searching for: ${action.command}` };
        }

        case 'open_file': {
          const matches = await vscode.workspace.findFiles(action.command, undefined, 1);
          if (matches.length === 0) {
            return { success: false, message: `No file found matching: ${action.command}` };
          }
          const doc = await vscode.workspace.openTextDocument(matches[0]);
          await vscode.window.showTextDocument(doc);
          return { success: true, message: `Opened: ${matches[0].fsPath}` };
        }

        default:
          return { success: false, message: `Unknown action kind: ${(action as ActionSpec).kind}` };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  }
}
