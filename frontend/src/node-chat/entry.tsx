import { createRoot } from "react-dom/client";
import { NodeChatView } from "./view";
import type { NodeChatStore } from "./types";
import "./styles.css";

const mounts = new WeakMap<HTMLElement, () => void>();

/** Mounted only in the pinned renderer's normal chat slot. */
export function mountNodeChat(element: HTMLElement, store: NodeChatStore): () => void {
  mounts.get(element)?.();
  if (element.id !== "beebot-node-chat") throw new Error("Unexpected remote conversation mount.");
  const root = createRoot(element);
  let mounted = true;
  const cleanup = () => {
    if (!mounted) return;
    mounted = false;
    mounts.delete(element);
    // The pinned React root may be committing its own unmount. Do not nest a sync commit.
    queueMicrotask(() => root.unmount());
  };
  mounts.set(element, cleanup);
  root.render(<NodeChatView store={store} />);
  return cleanup;
}

export type { NodeChatStore, NodeChatSnapshot } from "./types";
