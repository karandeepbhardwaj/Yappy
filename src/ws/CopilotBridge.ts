import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';
import { CopilotRefiner } from '../llm/CopilotRefiner';
import { IntentClassifier } from '../llm/IntentClassifier';
import { ActionExecutor } from '../actions/ActionExecutor';

const PORT = 19542;

export class CopilotBridge {
  private server: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private copilotRefiner: CopilotRefiner;
  private intentClassifier: IntentClassifier;
  private actionExecutor: ActionExecutor;
  private statusBarItem: vscode.StatusBarItem;

  constructor(copilotRefiner: CopilotRefiner) {
    this.copilotRefiner = copilotRefiner;
    this.intentClassifier = new IntentClassifier();
    this.actionExecutor = new ActionExecutor();
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.statusBarItem.text = '$(radio-tower) SunYapper Bridge';
    this.statusBarItem.tooltip = 'SunYapper desktop bridge (no connections)';
    this.statusBarItem.show();
  }

  start(): vscode.Disposable {
    this.server = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

    this.server.on('listening', () => {
      console.log(`SunYapper Bridge: listening on ws://127.0.0.1:${PORT}`);
    });

    this.server.on('connection', (ws) => {
      this.clients.add(ws);
      this.updateStatus();

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          await this.handleMessage(ws, msg);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        this.updateStatus();
      });
    });

    this.server.on('error', (err) => {
      vscode.window.showWarningMessage(`SunYapper Bridge: Failed to start on port ${PORT} — ${err.message}`);
    });

    return new vscode.Disposable(() => this.stop());
  }

  private async handleMessage(ws: WebSocket, msg: { type: string; id?: string; text?: string; language?: string; model?: string; action?: { kind: string; command: string; description: string; risk: string } }) {
    switch (msg.type) {
      case 'refine': {
        if (!msg.text || !msg.id) {
          ws.send(JSON.stringify({ type: 'error', id: msg.id, message: 'Missing text or id' }));
          return;
        }
        try {
          const refined = await this.copilotRefiner.refine(msg.text, msg.language, undefined, msg.model);
          ws.send(JSON.stringify({ type: 'refined', id: msg.id, text: refined }));
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ws.send(JSON.stringify({ type: 'error', id: msg.id, message: errMsg }));
        }
        break;
      }
      case 'classify': {
        if (!msg.text || !msg.id) {
          ws.send(JSON.stringify({ type: 'error', id: msg.id, message: 'Missing text or id' }));
          return;
        }
        try {
          const result = await this.intentClassifier.classify(msg.text, msg.language, undefined, msg.model);
          ws.send(JSON.stringify({ type: 'classified', id: msg.id, result }));
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ws.send(JSON.stringify({ type: 'error', id: msg.id, message: errMsg }));
        }
        break;
      }
      case 'execute_action': {
        if (!msg.action || !msg.id) {
          ws.send(JSON.stringify({ type: 'error', id: msg.id, message: 'Missing action or id' }));
          return;
        }
        try {
          const actionSpec = msg.action as import('../actions/ActionExecutor').ActionSpec;
          const { success, message } = await this.actionExecutor.execute(actionSpec);
          ws.send(JSON.stringify({ type: 'action_result', id: msg.id, success, message }));
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ws.send(JSON.stringify({ type: 'error', id: msg.id, message: errMsg }));
        }
        break;
      }
      case 'execute_app_action': {
        ws.send(JSON.stringify({ type: 'error', id: msg.id, message: 'App actions should be executed locally, not via VS Code' }));
        break;
      }
      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong', capabilities: ['refine', 'classify', 'execute'] }));
        break;
      }
    }
  }

  private updateStatus() {
    const count = this.clients.size;
    this.statusBarItem.text = count > 0
      ? `$(radio-tower) SunYapper Bridge (${count})`
      : '$(radio-tower) SunYapper Bridge';
    this.statusBarItem.tooltip = count > 0
      ? `SunYapper desktop: ${count} connection(s)`
      : 'SunYapper desktop bridge (no connections)';
  }

  stop() {
    if (this.server) {
      for (const client of this.clients) {
        client.close();
      }
      this.server.close();
      this.server = null;
    }
    this.statusBarItem.dispose();
  }
}
