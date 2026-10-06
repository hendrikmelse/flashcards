import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import {
  FEEDBACK_NOTE_MAX,
  FEEDBACK_TITLE_MAX,
  REPORT_KIND_LABELS,
  REPORT_REASON_LABELS,
  type FeedbackKind,
  type MyReport,
  type ReportKind,
} from "@flashcards/shared";
import { useAddComment, useMyReports, useSendFeedback } from "../api/hooks";
import { useLanguages } from "../api/packs";
import { displayLemma, langAttrs, languageName } from "../components/entries";
import { BusyLabel } from "../components/BusyLabel";
import { CommentBox } from "../components/CommentBox";
import { FlagIcon } from "../components/icons";
import { usePageTitle } from "../hooks/usePageTitle";

const STATUS_LABEL: Record<MyReport["status"], string> = {
  open: "Open",
  resolved: "Resolved",
};

type StatusFilter = "all" | MyReport["status"];
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: STATUS_LABEL.open },
  { value: "resolved", label: STATUS_LABEL.resolved },
];

type Sort = "sent" | "word" | "status";
const SORTS: { value: Sort; label: string }[] = [
  { value: "sent", label: "Date sent" },
  { value: "word", label: "Word" },
  { value: "status", label: "Status" },
];
// What "ascending" means for each sort, for the button that reverses it.
const ORDER_LABEL: Record<Sort, Record<"asc" | "desc", string>> = {
  sent: { asc: "Oldest first", desc: "Newest first" },
  word: { asc: "A to Z", desc: "Z to A" },
  status: { asc: "Open first", desc: "Resolved first" },
};
// Newest first, A to Z, and open first are what each sort is usually wanted as.
const DEFAULT_ORDER: Record<Sort, "asc" | "desc"> = { sent: "desc", word: "asc", status: "asc" };

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

// What a report is about, for sorting: the word, or the title of a bug or suggestion.
const wordOf = (r: MyReport) => (r.kind === "card" ? r.front.map(displayLemma).join(", ") : r.title);

type KindFilter = "all" | ReportKind;
const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "card", label: "Word problems" },
  { value: "bug", label: "Bugs" },
  { value: "suggestion", label: "Suggestions" },
  { value: "pack_request", label: "Pack requests" },
];

// The forms on this page. (A pack request is sent from the pack search, where it is needed.)
type FormKind = Exclude<FeedbackKind, "pack_request">;

const FEEDBACK_COPY: Record<
  FormKind,
  { button: string; heading: string; titleLabel: string; titleHint: string; noteLabel: string; noteHint: string; thanks: string }
> = {
  bug: {
    button: "Report a bug",
    heading: "Report a bug",
    titleLabel: "What went wrong?",
    titleHint: "A short summary",
    noteLabel: "Details",
    noteHint: "What did you do, what did you expect, and what happened instead?",
    thanks: "Thanks for the bug report! You can follow it below.",
  },
  suggestion: {
    button: "Suggest a feature",
    heading: "Suggest a feature",
    titleLabel: "What would you like?",
    titleHint: "A short summary",
    noteLabel: "Details",
    noteHint: "What should it do, and how would it help?",
    thanks: "Thanks for the suggestion! You can follow it below.",
  },
};

// Shown in place of the list. Before anything has been sent it says what the page is for; when the
// filters hide everything it just says so, and offers to show it all.
function EmptyState({ title, children, action }: { title: string; children?: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="empty empty-state">
      <FlagIcon />
      <p className="empty-title">{title}</p>
      {children && <p>{children}</p>}
      {action && (
        <button type="button" className="secondary" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}

// The conversation about the report: what its sender added, and the replies sent back, in order.
// While the report is open there is a box to add more.
function Comments({ report }: { report: MyReport }) {
  const add = useAddComment(report.id);
  return (
    <>
      {report.comments.map((c) => (
        <div key={c.id} className={c.fromAdmin ? "my-report-comment from-admin" : "my-report-comment"}>
          <p className="my-report-comment-label">
            {c.fromAdmin ? "Reply" : "You added"} · {dateFormat.format(new Date(c.createdAt))}
          </p>
          <p>{c.body}</p>
        </div>
      ))}
      {report.status === "open" && (
        <CommentBox
          send={add}
          ariaLabel="Add a comment"
          label="Your comment"
          placeholder="Add more details, or answer a question"
          buttonLabel="Add comment"
        />
      )}
    </>
  );
}

// The form for a bug report or a feature suggestion. Moves focus into itself when it opens, and
// calls onClose when cancelled and onSent when sent.
function FeedbackForm({
  kind,
  initial,
  onClose,
  onSent,
}: {
  kind: FormKind;
  /** What the form starts with, when it is opened by a link (see the page not found page). */
  initial?: { title: string; note: string } | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const copy = FEEDBACK_COPY[kind];
  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const send = useSendFeedback();
  const id = useId();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const missing = title.trim() === "" || note.trim() === "";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (missing || send.isPending) return;
    send.mutate({ kind, title: title.trim(), note: note.trim() }, { onSuccess: onSent });
  }

  return (
    <form className="report-form feedback-form" aria-label={copy.heading} onSubmit={submit}>
      <label htmlFor={`${id}-title`}>{copy.titleLabel}</label>
      <input
        ref={first}
        id={`${id}-title`}
        type="text"
        maxLength={FEEDBACK_TITLE_MAX}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={copy.titleHint}
      />
      <label htmlFor={`${id}-note`}>{copy.noteLabel}</label>
      <textarea
        id={`${id}-note`}
        rows={5}
        maxLength={FEEDBACK_NOTE_MAX}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={copy.noteHint}
      />
      {send.isError && (
        <p role="alert" className="form-error">
          Could not send that. Please try again.
        </p>
      )}
      <div className="report-actions feedback-actions">
        <button type="button" className="secondary" onClick={onClose} disabled={send.isPending}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={missing} aria-busy={send.isPending}>
          <BusyLabel busy={send.isPending}>Send</BusyLabel>
        </button>
      </div>
    </form>
  );
}

function compare(sort: Sort, a: MyReport, b: MyReport): number {
  const bySent = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (sort === "word") return wordOf(a).localeCompare(wordOf(b), undefined, { sensitivity: "base" }) || bySent;
  if (sort === "status") return Number(a.status === "resolved") - Number(b.status === "resolved") || bySent;
  return bySent;
}

// The problems this user reported with words, each with where it stands and what the owner wrote
// back. The owner answers with the reports script (deploy/README.md).
export function ReportsPage() {
  usePageTitle("Your reports");
  const reports = useMyReports();
  const languages = useLanguages();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [kind, setKind] = useState<KindFilter>("all");
  // A link such as /reports?report=bug opens that form at once; the page not found page adds `at`,
  // the address that was not found, which the form starts with. The link is used up once read, so
  // a reload does not open the form again.
  const [params, setParams] = useSearchParams();
  const linked = params.get("report");
  const [writing, setWriting] = useState<FormKind | null>(
    linked === "bug" || linked === "suggestion" ? linked : null,
  );
  const [prefill, setPrefill] = useState(() => {
    const at = params.get("at");
    return linked === "bug" && at
      ? { title: "Page not found", note: `I ended up on a page that does not exist: ${at}` }
      : null;
  });
  useEffect(() => {
    if (linked !== null) setParams({}, { replace: true });
  }, [linked, setParams]);
  const [thanks, setThanks] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("sent");
  const [order, setOrder] = useState<"asc" | "desc">(DEFAULT_ORDER.sent);

  const all = reports.data?.reports ?? [];
  const countStatus = (s: StatusFilter) => (s === "all" ? all.length : all.filter((r) => r.status === s).length);
  const countKind = (k: KindFilter) => (k === "all" ? all.length : all.filter((r) => r.kind === k).length);
  const shown = all
    .filter((r) => (status === "all" || r.status === status) && (kind === "all" || r.kind === kind))
    .sort((a, b) => (order === "asc" ? 1 : -1) * compare(sort, a, b));

  return (
    <article className="prose">
      <div className="page-head reports-head">
        <h1>Your reports</h1>
        <div className="feedback-buttons">
          {(Object.keys(FEEDBACK_COPY) as FormKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className="secondary"
              aria-expanded={writing === k}
              onClick={() => {
                setThanks(null);
                setPrefill(null);
                setWriting(writing === k ? null : k);
              }}
            >
              {FEEDBACK_COPY[k].button}
            </button>
          ))}
        </div>
      </div>
      {writing && (
        <FeedbackForm
          key={writing}
          kind={writing}
          initial={prefill}
          onClose={() => setWriting(null)}
          onSent={() => {
            setThanks(FEEDBACK_COPY[writing].thanks);
            setWriting(null);
          }}
        />
      )}
      {thanks && (
        <p className="report-done" role="status">
          {thanks}
        </p>
      )}

      {reports.isPending && <p className="status">Loading…</p>}
      {reports.isError && <p className="status error">Could not load your reports. Please refresh.</p>}
      {reports.data && all.length === 0 && (
        <EmptyState title="Nothing sent yet">
          Found a wrong translation, hit a bug, or have an idea? Use the buttons above, or “Report a problem” under any card while you study. Everything you send, and any reply, shows up here.
        </EmptyState>
      )}

      {all.length > 0 && (
        <>
          <div className="search-options">
            <div className="toggle" role="group" aria-label="Status">
              {STATUS_FILTERS.map(({ value, label }) => (
                <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}>
                  {label}
                  <span className="count">{countStatus(value)}</span>
                </button>
              ))}
            </div>
            <div className="toggle" role="group" aria-label="Type">
              {KIND_FILTERS.map(({ value, label }) => (
                <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>
                  {label}
                  <span className="count">{countKind(value)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="sort-row">
            <label className="sort-by">
              Sort by
              <select
                className="dropdown"
                value={sort}
                onChange={(e) => {
                  const next = e.target.value as Sort;
                  setSort(next);
                  setOrder(DEFAULT_ORDER[next]);
                }}
              >
                {SORTS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="toggle">
              <button
                type="button"
                aria-pressed={false}
                aria-label={`Reverse order, currently ${ORDER_LABEL[sort][order]}`}
                onClick={() => setOrder(order === "asc" ? "desc" : "asc")}
              >
                {order === "asc" ? "↑" : "↓"} {ORDER_LABEL[sort][order]}
              </button>
            </div>
          </div>

          {shown.length === 0 ? (
            <EmptyState
              title="Nothing matches these filters"
              action={{
                label: "Show everything",
                run: () => {
                  setStatus("all");
                  setKind("all");
                },
              }}
            />
          ) : (
            <ul className="my-reports">
              {shown.map((r) => (
                <li key={r.id} className="my-report">
                  <p className="my-report-head">
                    <span className="my-report-word">
                      {r.kind === "card" ? (
                        <>
                          <span {...langAttrs(r.fromLanguage ?? "en")}>{wordOf(r)}</span>
                          {" → "}
                          <span {...langAttrs(r.toLanguage ?? "en")}>{r.back.map(displayLemma).join(", ")}</span>
                        </>
                      ) : (
                        r.title
                      )}
                    </span>
                    <span className={r.status === "open" ? "badge" : "badge muted"}>{STATUS_LABEL[r.status]}</span>
                  </p>
                  <p className="muted my-report-meta">
                    {r.kind === "card" ? (
                      <>
                        {languageName(languages.data ?? [], r.fromLanguage ?? "")} →{" "}
                        {languageName(languages.data ?? [], r.toLanguage ?? "")}
                        {" · "}
                        {r.reason ? REPORT_REASON_LABELS[r.reason] : REPORT_KIND_LABELS.card}
                      </>
                    ) : (
                      REPORT_KIND_LABELS[r.kind]
                    )}
                    {" · "}
                    Sent {dateFormat.format(new Date(r.createdAt))}
                    {r.resolvedAt && <>, resolved {dateFormat.format(new Date(r.resolvedAt))}</>}
                  </p>
                  {r.note && <p className="my-report-note">{r.note}</p>}
                  <Comments report={r} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}
