import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ConversationAgentHeader } from "../recovered/features/conversation/workspace/chat-header";
import { ConversationComposer } from "../recovered/features/conversation/workspace/composer";
import { ConversationTranscript } from "../recovered/features/conversation/workspace/transcript";
import type { TranscriptMessage } from "../recovered/features/conversation/workspace/model";
import type { NodeChatSnapshot, NodeChatStore } from "./types";

const noOp = () => undefined;
const voiceUnavailable = async (): Promise<{ text: string }> => { throw new Error("Voice input is unavailable on this server."); };

function timestamp(value: number | string): number {
  const result = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(result) && Math.abs(result) <= 8.64e15 ? result : 0;
}

function useLanguage() {
  const read = () => (window as Window & { __sandUiLanguage?: string }).__sandUiLanguage === "zh";
  const [chinese, setChinese] = useState(read);
  useEffect(() => {
    const update = () => setChinese(read());
    window.addEventListener("sand-ui-language-changed", update);
    return () => window.removeEventListener("sand-ui-language-changed", update);
  }, []);
  return (en: string, zh: string) => chinese ? zh : en;
}

function NodeChatConversation({ store, snapshot }: { store: NodeChatStore; snapshot: NodeChatSnapshot }) {
  const t = useLanguage();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [clearGeneration, setClearGeneration] = useState(0);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryNote, setRecoveryNote] = useState("");
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const nearEnd = useRef(true);
  const working = snapshot.runningGoal?.status === "running";
  const online = snapshot.server.status === "online";
  const busy = snapshot.busy || actionBusy;
  const blocked = busy || snapshot.loading || !online || snapshot.runningGoal?.status === "cancelling" || snapshot.uncertainGoal != null;
  const entries = useMemo<TranscriptMessage[]>(() => snapshot.messages.filter((message) => !(message.role === "assistant" && !message.text.trim() && ["queued", "running", "cancelling"].includes(message.status ?? ""))).map((message) => ({
    kind: "message",
    id: message.id,
    role: message.role,
    author: message.role === "user" ? "You" : snapshot.bot.name,
    text: message.text,
    timestampMs: timestamp(message.createdAt),
  })), [snapshot.messages, snapshot.bot.name]);
  const messages = useMemo(() => new Map(snapshot.messages.map((message) => [message.id, message])), [snapshot.messages]);

  // Preserve a reader's position; new messages only follow the bottom when already there.
  useEffect(() => {
    const transcript = container.current?.querySelector<HTMLElement>(".sand-virtual-transcript");
    if (!transcript) return;
    const remember = () => { nearEnd.current = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 100; };
    transcript.addEventListener("scroll", remember, { passive: true });
    return () => transcript.removeEventListener("scroll", remember);
  }, []);
  useLayoutEffect(() => {
    if (!nearEnd.current) return;
    const transcript = container.current?.querySelector<HTMLElement>(".sand-virtual-transcript");
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [entries, snapshot.runningGoal?.status]);

  const run = useCallback(async (action: () => void | Promise<unknown>) => {
    setActionError(null);
    setActionBusy(true);
    try { await action(); return true; }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)); return false; }
    finally { setActionBusy(false); }
  }, []);

  const submit = async () => {
    if (blocked || !snapshot.draft.trim()) return;
    const text = snapshot.draft;
    if (await run(() => store.send(text))) {
      // The controller clears its draft only after the server acknowledges the request.
      if (store.getSnapshot().draft === "") setClearGeneration((value) => value + 1);
    }
  };

  const messageFooter = (entry: TranscriptMessage) => {
    const message = messages.get(entry.id);
    if (message?.role === "user" && ["queued", "running"].includes(message.status || "")) return <div className="beebot-message-footer"><span>{message.status === "queued" ? t("Received — waiting for this Bot", "已接收，等待此 Bot 处理") : t("Being handled", "正在处理")}</span></div>;
    if (message?.role !== "assistant") return null;
    const canAccept = message.status === "review" && message.goalId != null && Number.isInteger(message.version);
    const complete = message.status === "succeeded";
    const failed = message.status === "failed";
    const cancelled = message.status === "cancelled";
    if (!canAccept && !complete && !failed && !cancelled && !message.error) return null;
    return <div className="beebot-message-footer">
      {canAccept ? <button type="button" disabled={busy || !online} onClick={() => void run(() => store.accept(message.goalId!, message.version!))}>{t("Mark complete", "标记完成")}</button> : null}
      {complete ? <span>{t("Completed", "已完成")}</span> : null}
      {failed ? <span>{t("Could not finish", "未能完成")}</span> : null}
      {cancelled ? <span>{t("Stopped", "已停止")}</span> : null}
      {message.error ? <span>{message.error}</span> : null}
    </div>;
  };

  return <div className="beebot-node-conversation" ref={container}>
    <ConversationAgentHeader
      agent={{ ...snapshot.bot, isRunning: working, memberIds: [], awaitingUserResponse: null, connectionState: online ? "online" : "offline", workPhase: snapshot.uncertainGoal ? "uncertain" : snapshot.runningGoal?.status === "queued" ? "queued" : undefined }}
      isComputerActive={false}
      isInfoOpen={false}
      onToggleInfo={noOp}
      showComputerControl={false}
      trailing={<span className="beebot-node-server-label" title={snapshot.server.baseUrl}>{snapshot.server.name}</span>}
    />
    <main className="sand-chat-stage">
      <ConversationTranscript entries={entries} isAgentRunning={false} renderMessageFooter={messageFooter} />
      {snapshot.loading && entries.length === 0 ? <p className="beebot-chat-loading" role="status">{t("Loading conversation…", "正在加载对话…")}</p> : null}
    </main>
    <div className="sand-chat-input-dock">
      {snapshot.runningGoal ? <div className="beebot-chat-status" role="status">
        <span>{snapshot.runningGoal.status === "cancelling" ? t("Stop requested. Waiting for the server…", "已请求停止，正在等待服务器确认…") : working ? t("Working…", "正在处理…") : t("Waiting to start…", "等待开始…")}</span>
        {["queued", "running"].includes(snapshot.runningGoal.status) ? <button type="button" disabled={busy || !online} onClick={() => void run(() => store.stop(snapshot.runningGoal!.id))}>{t("Stop", "停止")}</button> : null}
      </div> : null}
      {!online ? <div className="beebot-chat-status" role="status"><span>{t("Server disconnected", "服务器已断开")}</span><button type="button" disabled={busy} onClick={() => void run(() => store.reconnect())}>{t("Reconnect", "重新连接")}</button></div> : null}
      {snapshot.uncertainGoal ? <div className="beebot-chat-recovery">
        <div className="beebot-chat-status" role="status"><span>{t("The previous execution could not be confirmed. Check this Bot's work before continuing.", "上次执行的结果无法确认，请核查此 Bot 的工作后继续。")}</span><button type="button" onClick={() => setRecoveryOpen((value) => !value)}>{t("Review interruption", "核查中断")}</button></div>
        {recoveryOpen ? <form onSubmit={(event) => {
          event.preventDefault();
          const goal = snapshot.uncertainGoal;
          if (goal && recoveryChecked && recoveryNote.trim().length >= 8 && !busy && online) void run(() => store.reconcile(goal.id, goal.version, recoveryNote.trim()));
        }}>
          <label><input type="checkbox" checked={recoveryChecked} onChange={(event) => setRecoveryChecked(event.currentTarget.checked)} />{t("I checked this Bot's files and any external actions.", "我已检查此 Bot 的工作文件及外部操作。")}</label>
          <label>{t("What did you verify?", "核查说明")}
            <textarea value={recoveryNote} minLength={8} required onChange={(event) => setRecoveryNote(event.currentTarget.value)} />
          </label>
          <small>{t("The interrupted work stays marked as failed. It will not run again automatically.", "中断的工作将标记为未完成，不会自动重新执行。")}</small>
          <button type="submit" disabled={!online || busy || !recoveryChecked || recoveryNote.trim().length < 8}>{t("Resume this Bot", "恢复此 Bot")}</button>
        </form> : null}
      </div> : null}
      {actionError || snapshot.error ? <p className="beebot-chat-error" role="alert">{actionError || snapshot.error}</p> : null}
      <ConversationComposer
        acceptedSendGeneration={clearGeneration}
        disabled={false}
        submitDisabled={blocked}
        notice={blocked ? t("Draft only — not sent and never sent automatically.", "草稿尚未发送，恢复后也不会自动发送。") : snapshot.runningGoal ? t(
          "You can keep messaging. New requests wait their turn; they do not change an action already running. Use Stop for an urgent boundary change.",
          "可以继续发消息，新请求按顺序处理，不会改写正在发生的操作；紧急变更边界请先停止。",
        ) : null}
        draft={{ prompt: snapshot.draft, attachments: [] }}
        enableAttachments={false}
        enableVoice={false}
        onChange={(draft) => store.setDraft(draft.prompt)}
        onStageFiles={noOp}
        onSubmit={submit}
        placeholder={t(`Message ${snapshot.bot.name}`, `给 ${snapshot.bot.name} 发消息`)}
        scopeKey={`${snapshot.connectionId}:${snapshot.bot.id}`}
        transcribeAudio={voiceUnavailable}
      />
    </div>
  </div>;
}

export function NodeChatView({ store }: { store: NodeChatStore }) {
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.getSnapshot(), [store]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!snapshot.active) return null;
  return <NodeChatConversation key={`${snapshot.connectionId}:${snapshot.bot.id}`} snapshot={snapshot} store={store} />;
}
