import { Fragment, useState } from "react";
import {
  REPORT_KIND_LABELS,
  REPORT_REASON_LABELS,
  USER_ROLE_LABELS,
  type AdminReport,
  type ReportKind,
} from "@flashcards/shared";
import { useAdminReply, useAdminReports, useUpdateReport } from "../api/hooks";
import { useLanguages } from "../api/packs";
import { CommentBox } from "../components/CommentBox";
import { displayLemma, languageName } from "../components/entries";
import { FlagIcon } from "../components/icons";

// Everyone's reports, for an admin: a table to scan, with each row opening into the whole report
// and a place to reply, resolve, or reopen it.

type StatusFilter = "all" | AdminReport["status"];
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
];

type KindFilter = "all" | ReportKind;
const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "card", label: "Word problems" },
  { value: "bug", label: "Bugs" },
  { value: "suggestion", label: "Suggestions" },
  { value: "pack_request", label: "Pack requests" },
];

type SortKey = "sent" | "from" | "account" | "type" | "about" | "status";
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "sent", label: "Sent" },
  { key: "from", label: "From" },
  { key: "account", label: "Account type" },
  { key: "type", label: "Type" },
  { key: "about", label: "About" },
  { key: "status", label: "Status" },
];

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

// What a report is about: the word on both sides for a word problem, the title otherwise.
const aboutOf = (r: AdminReport) =>
  r.kind === "card" ? `${r.front.map(displayLemma).join(", ")} → ${r.back.map(displayLemma).join(", ")}` : r.title;
const fromOf = (r: AdminReport) => r.reporter?.email ?? "";
const accountOf = (r: AdminReport) => (r.reporter ? USER_ROLE_LABELS[r.reporter.role] : "");

function compare(key: SortKey, a: AdminReport, b: AdminReport): number {
  const text = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: "base" });
  const bySent = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  switch (key) {
    case "from":
      return text(fromOf(a), fromOf(b)) || bySent;
    case "account":
      return text(accountOf(a), accountOf(b)) || bySent;
    case "type":
      return text(REPORT_KIND_LABELS[a.kind], REPORT_KIND_LABELS[b.kind]) || bySent;
    case "about":
      return text(aboutOf(a), aboutOf(b)) || bySent;
    case "status":
      return Number(a.status === "resolved") - Number(b.status === "resolved") || bySent;
    default:
      return bySent;
  }
}

export function AdminReports() {
  const reports = useAdminReports();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [kind, setKind] = useState<KindFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; order: "asc" | "desc" }>({ key: "sent", order: "desc" });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  if (reports.isPending) return <p className="status">Loading…</p>;
  if (reports.isError) {
    return <p className="status error">Could not load the reports. Are you still signed in as an admin?</p>;
  }

  const all = reports.data.reports;
  const countStatus = (s: StatusFilter) => (s === "all" ? all.length : all.filter((r) => r.status === s).length);
  const countKind = (k: KindFilter) => (k === "all" ? all.length : all.filter((r) => r.kind === k).length);
  const shown = all
    .filter((r) => (status === "all" || r.status === status) && (kind === "all" || r.kind === kind))
    .sort((a, b) => (sort.order === "asc" ? 1 : -1) * compare(sort.key, a, b));

  // A column's first click sorts by it in its natural direction: newest first for dates, A to Z for
  // the rest. Clicking the sorted column again reverses it.
  function sortBy(key: SortKey) {
    setSort((s) => (s.key === key ? { key, order: s.order === "asc" ? "desc" : "asc" } : { key, order: key === "sent" ? "desc" : "asc" }));
  }
  function toggle(id: string) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
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

      {shown.length === 0 ? (
        <div className="empty empty-state">
          <FlagIcon />
          <p className="empty-title">Nothing matches these filters</p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setStatus("all");
              setKind("all");
            }}
          >
            Show everything
          </button>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                {COLUMNS.map(({ key, label }) => (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={sort.key === key ? (sort.order === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button type="button" className="link" onClick={() => sortBy(key)}>
                      {label}
                      {sort.key === key && <span aria-hidden="true"> {sort.order === "asc" ? "↑" : "↓"}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Row key={r.id} report={r} open={expanded.has(r.id)} onToggle={() => toggle(r.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// A report's row. Clicking anywhere on it opens the report under it; the title is also a button, so
// the keyboard and screen readers can do the same.
function Row({ report: r, open, onToggle }: { report: AdminReport; open: boolean; onToggle: () => void }) {
  const about = aboutOf(r);
  return (
    <Fragment>
      <tr className={open ? "admin-row open" : "admin-row"} onClick={onToggle}>
        <td>{dateFormat.format(new Date(r.createdAt))}</td>
        <td className="admin-from">{r.reporter ? r.reporter.email : <span className="muted">Deleted account</span>}</td>
        <td>{r.reporter ? USER_ROLE_LABELS[r.reporter.role] : <span className="muted">—</span>}</td>
        <td>{REPORT_KIND_LABELS[r.kind]}</td>
        <td className="admin-about">
          <button
            type="button"
            className="admin-row-button"
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation(); // the row's own click would toggle it a second time
              onToggle();
            }}
          >
            {about}
          </button>
        </td>
        <td>
          <span className={r.status === "open" ? "badge" : "badge muted"}>{r.status === "open" ? "Open" : "Resolved"}</span>
        </td>
      </tr>
      {open && (
        <tr className="admin-detail">
          <td colSpan={COLUMNS.length}>
            <Detail report={r} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// One report in full: what was sent, the conversation so far, and, while it is open, a box to reply
// with the button to resolve the report beside it. Resolving needs the report to have been replied to:
// until then the button is greyed out, unless a reply is typed in the box, in which case it is sent
// first and then the report is resolved. A resolved report has a Reopen button at the bottom right.
function Detail({ report: r }: { report: AdminReport }) {
  const languages = useLanguages();
  const reply = useAdminReply(r.id);
  const update = useUpdateReport(r.id);
  const replied = r.comments.some((c) => c.fromAdmin);
  const [resolveFailed, setResolveFailed] = useState(false);

  async function resolve(draft: { text: string; clear: () => void }) {
    setResolveFailed(false);
    try {
      if (draft.text) {
        await reply.mutateAsync({ body: draft.text });
        draft.clear(); // sent, so a retry of the resolving does not send it twice
      }
      await update.mutateAsync({ resolved: true });
    } catch {
      setResolveFailed(true);
    }
  }

  return (
    <>
      <div className="admin-detail-body">
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
          {r.reporter?.name && <> · {r.reporter.name}</>}
        </p>
        {r.note ? <p className="my-report-note">{r.note}</p> : <p className="muted">No details were given.</p>}

        {r.comments.map((c) => (
          <div key={c.id} className={c.fromAdmin ? "my-report-comment from-admin" : "my-report-comment"}>
            <p className="my-report-comment-label">
              {c.fromAdmin ? "Admin" : (r.reporter?.email ?? "Sender")} · {dateFormat.format(new Date(c.createdAt))}
            </p>
            <p>{c.body}</p>
          </div>
        ))}

        {r.status === "open" && (
          <CommentBox
            send={reply}
            ariaLabel="Reply"
            label="Your reply"
            placeholder="Write a reply (the sender sees it)"
            buttonLabel="Reply"
            extra={(draft) => {
              const ready = replied || draft.text !== "";
              return (
                <button
                  type="button"
                  className="primary"
                  disabled={!ready || reply.isPending || update.isPending}
                  aria-busy={reply.isPending || update.isPending}
                  title={ready ? undefined : "Reply to the report before resolving it"}
                  onClick={() => void resolve(draft)}
                >
                  Resolve
                </button>
              );
            }}
          />
        )}
        {resolveFailed && (
          <p role="alert" className="form-error">
            Could not resolve it. Please try again.
          </p>
        )}
      </div>
      {r.status === "resolved" && (
        <div className="admin-detail-actions">
          {update.isError && (
            <p role="alert" className="form-error">
              Could not reopen it. Please try again.
            </p>
          )}
          <button
            type="button"
            className="secondary"
            disabled={update.isPending}
            onClick={() => update.mutate({ resolved: false })}
          >
            Reopen
          </button>
        </div>
      )}
    </>
  );
}
