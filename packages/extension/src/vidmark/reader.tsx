import { formatVidMarkTimestamp, type VidMarkTranscriptCue, type VidMarkVideoMetadata } from "@twyr/shared";
import { createRoot, type Root } from "react-dom/client";
import { useMemo, useState } from "react";
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
  onClose: () => void;
  onSeek?: (timeMs: number) => void;
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
      onClose={() => {
        root.unmount();
        roots.delete(host);
        options.onClose();
      }}
      onSeek={options.onSeek}
    />,
  );
}

function VidMarkReader(props: Required<Pick<MountVidMarkReaderOptions, "video" | "cues" | "onClose">> & Pick<MountVidMarkReaderOptions, "onSeek">) {
  const [state, setState] = useState(() => createVidMarkReaderState({ video: props.video, cues: props.cues }));
  const [noteDraft, setNoteDraft] = useState("");
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

  return (
    <div className="vidmark-reader">
      <header className="vidmark-reader-header">
        <div className="vidmark-reader-heading">
          <span className="vidmark-reader-brand">VidMark</span>
          <h2>{state.video.title}</h2>
          <a href={state.video.canonicalUrl} target="_blank" rel="noreferrer">
            {state.video.canonicalUrl}
          </a>
        </div>
        <button className="vidmark-icon-button" type="button" onClick={props.onClose} aria-label="关闭 VidMark">
          ×
        </button>
      </header>

      <nav className="vidmark-tabs" aria-label="VidMark 视图">
        <TabButton active={state.activeTab === "transcript"} onClick={() => openTab("transcript")}>
          字幕
        </TabButton>
        <TabButton active={state.activeTab === "clips"} onClick={() => openTab("clips")}>
          高能
        </TabButton>
        <TabButton active={state.activeTab === "notes"} onClick={() => openTab("notes")}>
          笔记
        </TabButton>
      </nav>

      <main className="vidmark-reader-body">
        {state.activeTab === "transcript" ? (
          <TranscriptView cues={state.cues} selectedCueId={state.selectedCueId} onSelect={selectCue} />
        ) : null}
        {state.activeTab === "clips" ? <EmptyState text="高能片段会在翻译后生成。" /> : null}
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

function TabButton(props: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button className={props.active ? "vidmark-tab vidmark-tab-active" : "vidmark-tab"} type="button" onClick={props.onClick}>
      {props.children}
    </button>
  );
}

function TranscriptView(props: {
  cues: VidMarkTranscriptCue[];
  selectedCueId?: string;
  onSelect: (cueId: string) => void;
}) {
  if (!props.cues.length) return <EmptyState text="已识别视频，字幕将在下一步接入。" />;
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
            <strong>{cue.text}</strong>
            {cue.translatedText ? <em>{cue.translatedText}</em> : null}
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
      <textarea
        value={props.noteDraft}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        placeholder="写下这段为什么重要"
      />
      <button className="vidmark-primary-button" type="button" onClick={props.onSave} disabled={!props.noteDraft.trim()}>
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
