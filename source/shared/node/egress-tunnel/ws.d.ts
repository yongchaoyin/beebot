declare module "ws" {
  import { EventEmitter } from "node:events";
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";
  interface WebSocketOptions {
    readonly headers?: Record<string, string>;
    readonly handshakeTimeout?: number;
    readonly maxPayload?: number;
    readonly followRedirects?: boolean;
  }
  class WebSocket extends EventEmitter {
    constructor(url: string | URL, options?: WebSocketOptions);
    static readonly OPEN: number;
    readonly readyState: number;
    binaryType: string;
    readonly bufferedAmount: number;
    on(event: string, listener: (...args: any[]) => void): this;
    send(data: Buffer | string, callback?: (error?: Error) => void): void;
    ping(): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    removeAllListeners(): this;
  }

  class WebSocketServer extends EventEmitter {
    constructor(options: { noServer: boolean; maxPayload?: number; perMessageDeflate?: boolean });
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, callback: (socket: WebSocket) => void): void;
    close(callback?: (error?: Error) => void): void;
    readonly clients: Set<WebSocket>;
  }
  export { WebSocketServer };
  export default WebSocket;
}
