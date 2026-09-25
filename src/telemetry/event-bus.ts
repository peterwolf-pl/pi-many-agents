import { EventEmitter } from "node:events";
import type { ProtocolMessage } from "../types.ts";

export class EventBus {
  private readonly emitter = new EventEmitter();

  publish(message: ProtocolMessage): void {
    this.emitter.emit("event", message);
    this.emitter.emit(message.type, message);
  }

  onEvent(listener: (message: ProtocolMessage) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
