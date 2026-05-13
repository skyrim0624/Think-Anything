import {
  formatVidMarkTimestamp,
  type VidMarkClip,
  type VidMarkSaveCardRequest,
  type VidMarkStudyGuide,
  type VidMarkTranscriptCue,
  type VidMarkVideoMetadata,
} from "@twyr/shared";
import { ExternalLink, FileText, Lightbulb, MessageCircleQuestion, PenLine, Quote, Save, Sparkles, Star, X } from "lucide-react";
import { createRoot, type Root } from "react-dom/client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  addVidMarkNote,
  createVidMarkReaderState,
  selectVidMarkCue,
  setVidMarkTab,
  type VidMarkReaderTab,
} from "./reader-state.js";

const roots = new WeakMap<Element, Root>();

export interface MountVidMarkReaderOptions {
  video: VidMarkVideoMetadata;
  cues?: VidMarkTranscriptCue[];
  clips?: VidMarkClip[];
  guide?: VidMarkStudyGuide;
  onClose: () => void;
  onSeek?: (timeMs: number) => void;
  onSave?: (request: VidMarkSaveCardRequest) => Promise<void> | void;
}

export function mountVidMarkReader(host: HTMLElement, options: MountVidMarkReaderOptions): void {
  let root = roots.get(host);
  if (!root) {
    root = createRoot(host);
    roots.set(host, root);
  }
  root.render(
    <VidMarkReader
      video={options.video}
      cues={options.cues ?? []}
      clips={options.clips ?? []}
      guide={options.guide}
      onClose={() => {
        root.unmount();
        roots.delete(host);
        options.onClose();
      }}
      onSeek={options.onSeek}
      onSave={options.onSave}
    />,
  );
}

function VidMarkReader(
  props: Required<Pick<MountVidMarkReaderOptions, "video" | "cues" | "clips" | "onClose">> &
    Pick<MountVidMarkReaderOptions, "guide" | "onSeek" | "onSave">,
) {
  const [state, setState] = useState(() =>
    createVidMarkReaderState({ video: props.video, cues: props.cues, clips: props.clips, guide: props.guide }),
  );
  const [noteDraft, setNoteDraft] = useState("");
  const [saveStatus, setSaveStatus] = useState<{ tone: "saving" | "success" | "error"; text: string }>();
  const isSaving = saveStatus?.tone === "saving";
  useEffect(() => {
    setState((current) => ({
      ...current,
      video: props.video,
      cues: props.cues,
      clips: props.clips,
      guide: props.guide,
    }));
  }, [props.video, props.cues, props.clips, props.guide]);
  const selectedCue = useMemo(
    () => state.cues.find((cue) => cue.id === state.selectedCueId),
    [state.cues, state.selectedCueId],
  );

  function openTab(tab: VidMarkReaderTab): void {
    setState((current) => setVidMarkTab(current, tab));
  }

  function selectCue(cueId: string): void {
    setState((current) => {
      const next = selectVidMarkCue(current, cueId);
      props.onSeek?.(next.currentTimeMs);
      return next;
    });
  }

  function saveNote(): void {
    setState((current) => addVidMarkNote(current, noteDraft));
    setNoteDraft("");
  }

  async function saveCard(): Promise<void> {
    if (!props.onSave) return;
    setSaveStatus({ tone: "saving", text: "保存中" });
    try {
      await props.onSave({
        video: state.video,
        cues: state.cues,
        clips: state.clips,
        notes: state.notes,
        guide: state.guide,
      });
      setSaveStatus({ tone: "success", text: "已保存" });
    } catch {
      setSaveStatus({ tone: "error", text: "保存失败" });
    }
  }

  return (
    <div className="vidmark-reader">
      <header className="vidmark-reader-header">
        <div className="vidmark-reader-heading">
          <span className="vidmark-reader-brand">VidMark</span>
          <h2>{state.video.title}</h2>
          <a className="vidmark-source-link" href={state.video.canonicalUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={13} aria-hidden="true" />
            {formatSourceLabel(state.video.canonicalUrl)}
          </a>
        </div>
        <div className="vidmark-header-actions">
          <button className="vidmark-save-button" type="button" onClick={() => void saveCard()} disabled={!props.onSave || isSaving}>
            <Save size={15} aria-hidden="true" />
            保存
          </button>
          <button className="vidmark-icon-button" type="button" onClick={props.onClose} aria-label="关闭 VidMark">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </header>
      {saveStatus ? (
        <div className="vidmark-save-status" data-tone={saveStatus.tone} role="status" aria-live="polite">
          {saveStatus.text}
        </div>
      ) : null}

      <nav className="vidmark-tabs" aria-label="VidMark 视图">
        <TabButton active={state.activeTab === "study"} icon={<Sparkles size={15} aria-hidden="true" />} onClick={() => openTab("study")}>
          学习
        </TabButton>
        <TabButton active={state.activeTab === "clips"} icon={<Star size={15} aria-hidden="true" />} onClick={() => openTab("clips")}>
          片段
        </TabButton>
        <TabButton active={state.activeTab === "transcript"} icon={<FileText size={15} aria-hidden="true" />} onClick={() => openTab("transcript")}>
          字幕
        </TabButton>
        <TabButton active={state.activeTab === "notes"} icon={<PenLine size={15} aria-hidden="true" />} onClick={() => openTab("notes")}>
          笔记
        </TabButton>
      </nav>

      <main className="vidmark-reader-body">
        {state.activeTab === "study" ? (
          <StudyView
            guide={state.guide}
            clips={state.clips}
            cues={state.cues}
            onSelectClip={(clip) => props.onSeek?.(clip.startMs)}
            onSelectCue={selectCue}
          />
        ) : null}
        {state.activeTab === "transcript" ? (
          <TranscriptView cues={state.cues} selectedCueId={state.selectedCueId} onSelect={selectCue} />
        ) : null}
        {state.activeTab === "clips" ? <ClipsView clips={state.clips} onSelect={(clip) => props.onSeek?.(clip.startMs)} /> : null}
        {state.activeTab === "notes" ? (
          <NotesView
            noteDraft={noteDraft}
            notes={state.notes}
            selectedCue={selectedCue}
            onChange={setNoteDraft}
            onSave={saveNote}
          />
        ) : null}
      </main>
    </div>
  );
}

function TabButton(props: { active: boolean; children: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button className={props.active ? "vidmark-tab vidmark-tab-active" : "vidmark-tab"} type="button" onClick={props.onClick}>
      {props.icon}
      {props.children}
    </button>
  );
}

function StudyView(props: {
  guide?: VidMarkStudyGuide;
  clips: VidMarkClip[];
  cues: VidMarkTranscriptCue[];
  onSelectClip: (clip: VidMarkClip) => void;
  onSelectCue: (cueId: string) => void;
}) {
  const guide = props.guide ?? buildFallbackStudyGuide(props.clips, props.cues);
  const clipMap = new Map(props.clips.map((clip) => [clip.id, clip]));
  const cueMap = new Map(props.cues.map((cue) => [cue.id, cue]));
  if (!props.cues.length) return <EmptyState text="正在读取字幕；读取完成后会先生成学习导览，再进入精读。" />;
  return (
    <section className="vidmark-study">
      <section className="vidmark-study-hero">
        <span>快速预览</span>
        <p>{guide.quickPreview}</p>
      </section>

      <section className="vidmark-study-section">
        <h3>
          <Lightbulb size={15} aria-hidden="true" />
          先看这几段
        </h3>
        <div className="vidmark-study-list">
          {guide.learningPath.length ? (
            guide.learningPath.map((item) => {
              const clip = clipMap.get(item.clipId);
              return (
                <button
                  className="vidmark-study-item"
                  key={item.clipId}
                  type="button"
                  onClick={() => (clip ? props.onSelectClip(clip) : undefined)}
                  disabled={!clip}
                >
                  <span>{clip ? `${formatVidMarkTimestamp(clip.startMs)}-${formatVidMarkTimestamp(clip.endMs)}` : item.clipId}</span>
                  <strong>{clip?.title ?? item.clipId}</strong>
                  <p>{item.why}</p>
                  <em>{item.question}</em>
                </button>
              );
            })
          ) : (
            <EmptyState text="高能片段生成后，这里会变成学习路径。" />
          )}
        </div>
      </section>

      {guide.keyTakeaways.length ? (
        <section className="vidmark-study-section">
          <h3>
            <Star size={15} aria-hidden="true" />
            关键收获
          </h3>
          <ul className="vidmark-study-bullets">
            {guide.keyTakeaways.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {guide.suggestedQuestions.length ? (
        <section className="vidmark-study-section">
          <h3>
            <MessageCircleQuestion size={15} aria-hidden="true" />
            带着问题看
          </h3>
          <div className="vidmark-question-list">
            {guide.suggestedQuestions.map((question) => {
              const cueId = question.cueIds?.find((id) => cueMap.has(id));
              return (
                <button
                  className="vidmark-question"
                  key={question.id}
                  type="button"
                  onClick={() => (cueId ? props.onSelectCue(cueId) : undefined)}
                  disabled={!cueId}
                >
                  {question.question}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {guide.memorableQuotes.length ? (
        <section className="vidmark-study-section">
          <h3>
            <Quote size={15} aria-hidden="true" />
            值得记住
          </h3>
          <div className="vidmark-quote-list">
            {guide.memorableQuotes.map((quote) => (
              <button
                className="vidmark-quote"
                key={quote.id}
                type="button"
                onClick={() => (quote.cueId ? props.onSelectCue(quote.cueId) : undefined)}
                disabled={!quote.cueId}
              >
                <strong>{quote.translatedText ?? quote.text}</strong>
                {quote.translatedText ? <em>{quote.text}</em> : null}
                <p>{quote.reason}</p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {guide.glossary.length ? (
        <section className="vidmark-study-section">
          <h3>术语</h3>
          <dl className="vidmark-glossary">
            {guide.glossary.map((item) => (
              <div key={item.term}>
                <dt>{item.term}</dt>
                <dd>{item.explanation}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </section>
  );
}

function TranscriptView(props: {
  cues: VidMarkTranscriptCue[];
  selectedCueId?: string;
  onSelect: (cueId: string) => void;
}) {
  if (!props.cues.length) return <EmptyState text="正在读取字幕；如果视频没有公开字幕，会停留在这里。" />;
  return (
    <ol className="vidmark-transcript">
      {props.cues.map((cue) => (
        <li key={cue.id}>
          <button
            className={props.selectedCueId === cue.id ? "vidmark-cue vidmark-cue-active" : "vidmark-cue"}
            type="button"
            onClick={() => props.onSelect(cue.id)}
          >
            <span>{formatVidMarkTimestamp(cue.startMs)}</span>
            <strong>{cue.translatedText ?? cue.text}</strong>
            {cue.translatedText ? <em>{cue.text}</em> : null}
          </button>
        </li>
      ))}
    </ol>
  );
}

function ClipsView(props: { clips: VidMarkClip[]; onSelect: (clip: VidMarkClip) => void }) {
  if (!props.clips.length) return <EmptyState text="高能片段会在翻译后生成。" />;
  return (
    <ol className="vidmark-clips">
      {props.clips.map((clip) => (
        <li key={clip.id}>
          <button className="vidmark-clip" type="button" onClick={() => props.onSelect(clip)}>
            <span>
              {formatVidMarkTimestamp(clip.startMs)}-{formatVidMarkTimestamp(clip.endMs)}
            </span>
            <strong>{clip.title}</strong>
            <em>{clip.type}</em>
            <p>{clip.summary}</p>
          </button>
        </li>
      ))}
    </ol>
  );
}

function NotesView(props: {
  noteDraft: string;
  notes: ReturnType<typeof createVidMarkReaderState>["notes"];
  selectedCue?: VidMarkTranscriptCue;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <section className="vidmark-notes">
      <div className="vidmark-note-context">
        {props.selectedCue ? (
          <>
            <span>{formatVidMarkTimestamp(props.selectedCue.startMs)}</span>
            <strong>{props.selectedCue.translatedText ?? props.selectedCue.text}</strong>
          </>
        ) : (
          <span>未选择字幕句</span>
        )}
      </div>
      <label className="vidmark-note-field" htmlFor="vidmark-note-draft">
        <span className="vidmark-field-label">笔记</span>
        <textarea
          id="vidmark-note-draft"
          value={props.noteDraft}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          placeholder="写下这段为什么重要"
          aria-label="VidMark 笔记内容"
        />
      </label>
      <button className="vidmark-primary-button" type="button" onClick={props.onSave} disabled={!props.noteDraft.trim()}>
        <PenLine size={15} aria-hidden="true" />
        保存笔记
      </button>
      <div className="vidmark-note-list">
        {props.notes.map((note) => (
          <article key={note.id}>
            <span>{formatVidMarkTimestamp(note.videoTimeMs)}</span>
            <p>{note.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function EmptyState(props: { text: string }) {
  return <div className="vidmark-empty">{props.text}</div>;
}

function buildFallbackStudyGuide(clips: VidMarkClip[], cues: VidMarkTranscriptCue[]): VidMarkStudyGuide {
  return {
    quickPreview: clips.length
      ? "先从高能片段建立主线，再回到字幕里补细节。"
      : "字幕已载入，正在生成学习导览。你也可以先从字幕里选择一句开始做笔记。",
    learningPath: clips.slice(0, 3).map((clip) => ({
      clipId: clip.id,
      why: clip.summary,
      question: "这一段可以迁移到我的哪个真实问题里？",
    })),
    keyTakeaways: clips.slice(0, 4).map((clip) => clip.title),
    suggestedQuestions: cues.length
      ? [
          {
            id: "q1",
            question: "这段视频最核心的判断是什么？",
            cueIds: [cues[0]!.id],
          },
        ]
      : [],
    memorableQuotes: [],
    glossary: [],
  };
}

function formatSourceLabel(value: string): string {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^www\./, "");
    return `${hostname}${url.pathname}`;
  } catch {
    return value;
  }
}
