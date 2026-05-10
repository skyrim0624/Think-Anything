import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BookMarked, Brain, Check, Database, Link2, Save, Settings, ShieldQuestion } from "lucide-react";
import type {
  ApiStatus,
  AskResponse,
  ReadingContext,
  RetrievedNote,
  TwyrActionMode,
} from "@twyr/shared";
import { askTwyr, captureTwyr, getStatus, loadSettings, promoteSource, retrieveTwyr, saveSettings, type ExtensionSettings } from "./api.js";
import type { PageContextResponse, PendingAction } from "./messages.js";
import { PENDING_ACTION_KEY } from "./messages.js";

type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; response?: AskResponse };

function App(): React.ReactElement {
  const [settings, setSettings] = useState<ExtensionSettings>({ bridgeUrl: "", token: "" });
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [context, setContext] = useState<ReadingContext | null>(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const sourceTabIdRef = useRef<number | undefined>(undefined);
  const autoQuestionRef = useRef<string | undefined>(undefined);

  const contextSummary = useMemo(() => {
    if (!context) return "当前页面不可读取";
    const selection = context.selectionText ? `已选中 ${context.selectionText.length} 字` : "未选中文本";
    return `${context.source.site || "网页"} · ${selection}`;
  }, [context]);

  const refreshContext = useCallback(async (sourceTabId?: number) => {
    const targetTabId = sourceTabId ?? sourceTabIdRef.current ?? (await getCurrentWindowTabId());
    if (!targetTabId) return;
    try {
      const response = (await chrome.tabs.sendMessage(targetTabId, { type: "TWYR_GET_CONTEXT" })) as PageContextResponse;
      setContext(response.context);
    } catch {
      setContext(null);
    }
  }, []);

  const refreshStatus = useCallback(async (nextSettings: ExtensionSettings) => {
    try {
      setStatus(await getStatus(nextSettings));
    } catch (error) {
      setStatus({
        ok: false,
        authenticated: false,
        bridgeUrl: nextSettings.bridgeUrl,
        vaultPath: "",
        vaultExists: false,
        indexReady: false,
        codexSdkAvailable: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const loaded = await loadSettings();
      setSettings(loaded);
      const pending = await chrome.storage.local.get(PENDING_ACTION_KEY);
      const action = pending[PENDING_ACTION_KEY] as PendingAction | undefined;
      await chrome.storage.local.remove(PENDING_ACTION_KEY);
      if (action?.sourceTabId) {
        sourceTabIdRef.current = action.sourceTabId;
      }
      await refreshStatus(loaded);
      await refreshContext(action?.sourceTabId);
      if (action) {
        const nextQuestion = action.question ?? defaultQuestion(action.mode);
        autoQuestionRef.current = nextQuestion;
        setQuestion(nextQuestion);
        if (action.kind === "capture") {
          setMessages([{ role: "system", content: "已准备快速保存当前选区或页面。" }]);
        }
        if (action.kind === "promote") {
          setMessages([{ role: "system", content: "全文入库需要确认。请先检查当前页面内容。" }]);
        }
      }
    })();
  }, [refreshContext, refreshStatus]);

  async function persistSettings(): Promise<void> {
    const normalized = {
      bridgeUrl: settings.bridgeUrl.trim(),
      token: settings.token.trim(),
    };
    setSettings(normalized);
    await saveSettings(normalized);
    await refreshStatus(normalized);
    setShowSettings(false);
  }

  async function runAsk(mode: TwyrActionMode, forceRetrieval = false): Promise<void> {
    const effectiveQuestion = question.trim() || (mode === "freeform" ? "" : defaultQuestion(mode));
    if (!context || !effectiveQuestion || isBusy) return;
    setIsBusy(true);
    setMessages((current) => [...current, { role: "user", content: effectiveQuestion }]);
    try {
      const response = await askTwyr(settings, {
        context,
        question: effectiveQuestion,
        mode,
        forceRetrieval,
      });
      setMessages((current) => [...current, { role: "assistant", content: response.answer, response }]);
      setQuestion("");
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "system", content: error instanceof Error ? error.message : String(error) },
      ]);
    } finally {
      setIsBusy(false);
    }
  }

  async function runCapture(): Promise<void> {
    if (!context || isBusy) return;
    const note = getUserWrittenNote(question, autoQuestionRef.current);
    setIsBusy(true);
    try {
      const response = await captureTwyr(settings, {
        context,
        cardType: context.selectionText ? "quote" : "insight",
        level: "card",
        note,
        reason: "用户在浏览器阅读现场手动保存。",
      });
      setMessages((current) => [
        ...current,
        { role: "system", content: `已保存到 ${response.path}` },
      ]);
      setQuestion("");
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "system", content: error instanceof Error ? error.message : String(error) },
      ]);
    } finally {
      setIsBusy(false);
    }
  }

  async function runRetrieve(): Promise<void> {
    if (!context || isBusy) return;
    setIsBusy(true);
    try {
      const response = await retrieveTwyr(settings, {
        context,
        query: question || context.selectionText || context.source.title,
        force: true,
      });
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: formatRetrievedNotes(response.retrieval.notes),
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "system", content: error instanceof Error ? error.message : String(error) },
      ]);
    } finally {
      setIsBusy(false);
    }
  }

  async function runPromote(): Promise<void> {
    if (!context || isBusy) return;
    const confirmed = window.confirm("确认把当前网页全文保存到 Think 的 10-SOURCES 吗？");
    if (!confirmed) return;
    setIsBusy(true);
    try {
      const response = await promoteSource(settings, {
        context,
        confirmed: true,
        reason: question || "用户确认这篇文章值得全文入库。",
      });
      setMessages((current) => [
        ...current,
        { role: "system", content: `全文已入库：${response.sourcePath}` },
      ]);
      setQuestion("");
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "system", content: error instanceof Error ? error.message : String(error) },
      ]);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="header">
        <div>
          <div className="brand">Think</div>
          <div className="subtitle">thinking anytime</div>
        </div>
        <button
          className="icon-button"
          type="button"
          title="设置"
          aria-label="打开 Think 设置"
          onClick={() => setShowSettings((value) => !value)}
        >
          <Settings size={18} />
        </button>
      </header>

      {showSettings ? (
        <section className="panel settings-panel">
          <label>
            Bridge URL
            <input
              value={settings.bridgeUrl}
              onChange={(event) => setSettings({ ...settings, bridgeUrl: event.target.value })}
            />
          </label>
          <label>
            Token
            <input
              value={settings.token}
              onChange={(event) => setSettings({ ...settings, token: event.target.value })}
              placeholder="从 ~/.twyr/config.json 复制 token"
            />
          </label>
          <button className="primary-button" type="button" onClick={() => void persistSettings()}>
            保存设置
          </button>
        </section>
      ) : null}

      <section
        className={`status ${status?.ok && status.authenticated ? "status-ok" : "status-warn"}`}
        role="status"
        aria-live="polite"
      >
        <Database size={15} />
        <span>{status?.authenticated ? "Bridge 已连接" : status?.message || "Bridge 未连接"}</span>
      </section>

      <section className="panel context-panel">
        <div className="context-title">{context?.source.title || "当前页面"}</div>
        <div className="context-meta">{contextSummary}</div>
        {context?.selectionText ? <blockquote>{context.selectionText.slice(0, 260)}</blockquote> : null}
        <button className="ghost-button" type="button" onClick={() => void refreshContext()}>
          刷新页面上下文
        </button>
      </section>

      <section className="quick-actions">
        <button type="button" onClick={() => void runAsk("explain")} disabled={isBusy || !context}>
          <Brain size={16} />
          解释
        </button>
        <button type="button" onClick={() => void runAsk("challenge")} disabled={isBusy || !context}>
          <ShieldQuestion size={16} />
          反驳
        </button>
        <button type="button" onClick={() => void runAsk("connect", true)} disabled={isBusy || !context}>
          <Link2 size={16} />
          旧笔记
        </button>
        <button type="button" onClick={() => void runCapture()} disabled={isBusy || !context}>
          <Save size={16} />
          保存
        </button>
        <button type="button" onClick={() => void runPromote()} disabled={isBusy || !context}>
          <BookMarked size={16} />
          全文
        </button>
      </section>

      <section className="messages">
        {messages.length === 0 ? (
          <div className="empty">选中文字后提问，或者直接保存当前页面。</div>
        ) : (
          messages.map((message, index) => <MessageView key={index} message={message} />)
        )}
      </section>

      <footer className="composer">
        <textarea
          value={question}
          onChange={(event) => {
            const nextQuestion = event.target.value;
            if (autoQuestionRef.current && nextQuestion !== autoQuestionRef.current) {
              autoQuestionRef.current = undefined;
            }
            setQuestion(nextQuestion);
          }}
          placeholder="问一个问题，或写下保存理由"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !isBusy) {
              event.preventDefault();
              void runAsk("freeform");
            }
          }}
        />
        <div className="composer-actions">
          <button className="ghost-button" type="button" onClick={() => void runRetrieve()} disabled={isBusy || !context}>
            查库
          </button>
          <button className="primary-button" type="button" onClick={() => void runAsk("freeform")} disabled={isBusy || !context}>
            {isBusy ? "处理中" : "发送"}
          </button>
        </div>
      </footer>
    </main>
  );
}

async function getCurrentWindowTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function MessageView({ message }: { message: Message }): React.ReactElement {
  return (
    <article className={`message message-${message.role}`}>
      <div className="message-role">{message.role === "assistant" ? "Think" : message.role === "user" ? "你" : "系统"}</div>
      <div className="message-body">{message.content}</div>
      {message.role === "assistant" && message.response ? (
        <div className="recommendation">
          <Check size={14} />
          <span>
            建议：{message.response.saveRecommendation.level} / {message.response.saveRecommendation.cardType}；
            {message.response.saveRecommendation.reason}
          </span>
        </div>
      ) : null}
      {message.role === "assistant" && message.response?.retrieval.notes.length ? (
        <div className="note-hits">
          {message.response.retrieval.notes.map((note) => (
            <div key={`${note.root}-${note.path}`} className="note-hit">
              {note.root}:{note.path}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function defaultQuestion(mode: TwyrActionMode | undefined): string {
  if (mode === "challenge") return "请拆解并挑战这段话的论证。";
  if (mode === "connect") return "结合我的旧笔记，帮我理解这段内容。";
  if (mode === "promote") return "这篇文章为什么值得全文入库？";
  return "解释这段内容，并指出它是否值得保存。";
}

function getUserWrittenNote(question: string, autoQuestion: string | undefined): string | undefined {
  const note = question.trim();
  if (!note || note === autoQuestion) return undefined;
  return note;
}

function formatRetrievedNotes(notes: RetrievedNote[]): string {
  if (!notes.length) return "没有找到明显相关的旧笔记。";
  return notes
    .map((note) => `- ${note.root}:${note.path}\n  ${note.reason}\n  ${note.excerpt}`)
    .join("\n\n");
}

createRoot(document.getElementById("root")!).render(<App />);
