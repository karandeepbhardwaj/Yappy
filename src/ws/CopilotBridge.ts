import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';
import { CopilotRefiner } from '../llm/CopilotRefiner';

const PORT = 19542;

export class CopilotBridge {
  private server: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private copilotRefiner: CopilotRefiner;
  private statusBarItem: vscode.StatusBarItem;

  constructor(copilotRefiner: CopilotRefiner) {
    this.copilotRefiner = copilotRefiner;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.statusBarItem.text = '$(radio-tower) SunYapper Bridge';
    this.statusBarItem.tooltip = 'SunYapper desktop bridge (no connections)';
    this.statusBarItem.show();
  }

  start(): vscode.Disposable {
    this.server = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

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

  private async handleMessage(ws: WebSocket, msg: { type: string; id?: string; text?: string; language?: string }) {
    switch (msg.type) {
      case 'refine': {
        if (!msg.text || !msg.id) {
          ws.send(JSON.stringify({ type: 'error', id: msg.id, message: 'Missing text or id' }));
          return;
        }
        try {
          const refined = await this.copilotRefiner.refine(msg.text, msg.language);
          ws.send(JSON.stringify({ type: 'refined', id: msg.id, text: refined }));
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          ws.send(JSON.stringify({ type: 'error', id: msg.id, message: errMsg }));
        }
        break;
      }
      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' }));
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
