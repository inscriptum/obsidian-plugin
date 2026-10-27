import { litView } from "@web-companions/lit";
import { p } from "@web-companions/gfc";
import { elTag } from "../../tags";
import {
  filterThreads,
  type CommentsFilter,
  type ThreadViewModel,
} from "./commentsPanelState";

const cls = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const formatTime = (ms: number) => dateFormat.format(new Date(ms));

const icon = (name: "check" | "trash" | "x") => (
  <svg viewBox="0 0 24 24">
    <use href={`#inscriptum-bb-${name}`} xlinkHref={`#inscriptum-bb-${name}`} />
  </svg>
);

/**
 * The "Comments" side panel (ОВ-2): segment filter Open/Resolved, thread
 * cards (first comment + replies, Edit/Delete, Reply), resolve banner,
 * orphan badge. Editor-free: the view feeds view models and receives
 * actions; the composer for a brand-new thread (bubble-menu flow) arrives
 * via the `composer` prop and is discarded empty on cancel.
 */
export const CommentsPanelElement = litView.element({
  props: {
    threads: p.req<ThreadViewModel[]>(),
    composer: p.req<{ threadId: string; noteId: string } | null>(),
    activeThreadId: p.req<string | null>(),
    onSubmitComposer: p.req<(threadId: string, text: string) => void>(),
    onCancelComposer: p.req<() => void>(),
    onReply: p.req<(threadId: string, text: string) => void>(),
    onEditComment: p.req<
      (threadId: string, commentId: string, text: string) => void
    >(),
    onDeleteComment: p.req<(threadId: string, commentId: string) => void>(),
    onResolveThread: p.req<(threadId: string, resolved: boolean) => void>(),
    onDeleteThread: p.req<(threadId: string) => void>(),
    onOpenThread: p.req<(threadId: string) => void>(),
    onClose: p.req<() => void>(),
  },
})(function* (props) {
  // `as CommentsFilter` — a plain initializer narrows `filter` to "open"
  // inside the loop (TS ignores the closure re-assignments).
  let filter = "open" as CommentsFilter;
  let composerDraft = "";
  let replyThreadId: string | null = null;
  let replyDraft = "";
  /** `${threadId}:${commentId}` while a comment is being edited. */
  let editingKey: string | null = null;
  let editDraft = "";
  /** Composer identity the draft belongs to (see the reset in the loop). */
  let lastComposerId: string | null = null;

  // eslint-disable-next-line @typescript-eslint/no-this-alias -- generator component: needs external this reference for the composer focus lookup
  const root: HTMLElement = this;

  const getComposerInput = () =>
    root.querySelector<HTMLInputElement>(".ins-comments-composer input");

  const refresh = () => {
    void this.next();
  };

  const submitComposer = () => {
    const composer = props.composer;
    if (!composer) return;
    const text = composerDraft.trim();
    if (!text) {
      props.onCancelComposer();
      return;
    }
    composerDraft = "";
    props.onSubmitComposer(composer.threadId, text);
  };

  const submitReply = (threadId: string) => {
    const text = replyDraft.trim();
    if (!text) return;
    replyThreadId = null;
    replyDraft = "";
    props.onReply(threadId, text);
    window.requestAnimationFrame(refresh);
  };

  const submitEdit = (threadId: string, commentId: string) => {
    const text = editDraft.trim();
    if (!text) return;
    editingKey = null;
    editDraft = "";
    props.onEditComment(threadId, commentId, text);
    window.requestAnimationFrame(refresh);
  };

  const openComposer = () => {
    window.requestAnimationFrame(() => {
      if (props.composer) getComposerInput()?.focus();
    });
  };

  const card = (item: ThreadViewModel) => {
    const { thread } = item;
    const isEditing = (commentId: string) =>
      editingKey === `${thread.id}:${commentId}`;
    return (
      <article
        class={cls(
          "ins-comments-card",
          props.activeThreadId === thread.id && "is-active",
          thread.resolved && "is-resolved",
        )}
      >
        <header class="ins-comments-card-head">
          <button
            type="button"
            class="ins-comments-card-title"
            title="Reveal in text"
            onclick={() => props.onOpenThread(thread.id)}
          >
            {item.noteTitle || "Page"}
          </button>
          <span class="ins-comments-card-tools">
            <button
              type="button"
              class="ins-comments-tool"
              title={thread.resolved ? "Unresolve" : "Resolve"}
              aria-label={thread.resolved ? "Unresolve" : "Resolve"}
              onclick={() => props.onResolveThread(thread.id, !thread.resolved)}
            >
              {icon("check")}
            </button>
            <button
              type="button"
              class="ins-comments-tool is-danger"
              title="Delete thread"
              aria-label="Delete thread"
              onclick={() => props.onDeleteThread(thread.id)}
            >
              {icon("trash")}
            </button>
          </span>
        </header>

        {thread.resolved ? (
          <div class="ins-comments-resolved-banner">
            Resolved{thread.resolvedAt ? ` · ${formatTime(thread.resolvedAt)}` : ""}
          </div>
        ) : null}

        {thread.comments.map((comment) => (
          <div class="ins-comments-entry" key={comment.id}>
            <div class="ins-comments-entry-head">
              <span class="ins-comments-entry-author">{comment.author}</span>
              <span class="ins-comments-entry-time">
                {formatTime(comment.createdAt)}
                {comment.updatedAt ? " (edited)" : ""}
              </span>
            </div>
            {isEditing(comment.id) ? (
              <div class="ins-comments-inline-editor ins-comments-edit-editor">
                <input
                  type="text"
                  value={editDraft}
                  oninput={(e: Event) => {
                    editDraft = (e.target as HTMLInputElement).value;
                  }}
                  onkeydown={(e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitEdit(thread.id, comment.id);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      editingKey = null;
                      editDraft = "";
                      refresh();
                    }
                  }}
                />
                <button
                  type="button"
                  class="ins-comments-tool"
                  title="Save"
                  onclick={() => submitEdit(thread.id, comment.id)}
                >
                  {icon("check")}
                </button>
              </div>
            ) : (
              <>
                <div class="ins-comments-entry-text">{comment.content}</div>
                <div class="ins-comments-entry-actions">
                  <button
                    type="button"
                    onclick={() => {
                      editingKey = `${thread.id}:${comment.id}`;
                      editDraft = comment.content;
                      refresh();
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onclick={() => props.onDeleteComment(thread.id, comment.id)}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        {!item.hasAnchor ? (
          <div class="ins-comments-orphan">Anchor removed</div>
        ) : null}

        {replyThreadId === thread.id ? (
          <div class="ins-comments-inline-editor ins-comments-reply-editor">
            <input
              type="text"
              placeholder="Reply to thread"
              value={replyDraft}
              oninput={(e: Event) => {
                replyDraft = (e.target as HTMLInputElement).value;
              }}
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitReply(thread.id);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  replyThreadId = null;
                  replyDraft = "";
                  refresh();
                }
              }}
            />
            <button
              type="button"
              class="ins-comments-tool"
              title="Send reply"
              onclick={() => submitReply(thread.id)}
            >
              {icon("check")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            class="ins-comments-reply"
            onclick={() => {
              replyThreadId = thread.id;
              replyDraft = "";
              refresh();
              window.requestAnimationFrame(() => {
                root
                  .querySelector<HTMLInputElement>(
                    ".ins-comments-reply-editor input",
                  )
                  ?.focus();
              });
            }}
          >
            Reply to thread
          </button>
        )}
      </article>
    );
  };

  while (true) {
    const composer = props.composer;
    // A new composer (a second Comment request while one was pending)
    // starts with a clean draft — the abandoned draft text must never land
    // in the new thread's first comment.
    if ((composer?.threadId ?? null) !== lastComposerId) {
      lastComposerId = composer?.threadId ?? null;
      composerDraft = "";
      if (composer) openComposer();
    }
    const items = props.threads;
    const openCount = items.filter((i) => !i.thread.resolved).length;
    const resolvedCount = items.length - openCount;
    const visible = filterThreads(items, filter);

    props = yield (
      <div class="ins-comments-panel" role="complementary" aria-label="Comments">
        <header class="ins-comments-head">
          <span class="ins-comments-title">Comments</span>
          <div class="ins-comments-filter" role="tablist">
            <button
              type="button"
              class={cls(filter === "open" && "is-active")}
              onclick={() => {
                filter = "open";
                refresh();
              }}
            >
              Open{openCount > 0 ? ` ${openCount}` : ""}
            </button>
            <button
              type="button"
              class={cls(filter === "resolved" && "is-active")}
              onclick={() => {
                filter = "resolved";
                refresh();
              }}
            >
              Resolved{resolvedCount > 0 ? ` ${resolvedCount}` : ""}
            </button>
          </div>
          <button
            type="button"
            class="ins-comments-tool"
            title="Close comments"
            aria-label="Close comments"
            onclick={() => props.onClose()}
          >
            {icon("x")}
          </button>
        </header>

        {composer ? (
          <div class="ins-comments-composer">
            <input
              type="text"
              placeholder="Add comment…"
              value={composerDraft}
              oninput={(e: Event) => {
                composerDraft = (e.target as HTMLInputElement).value;
              }}
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitComposer();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  composerDraft = "";
                  props.onCancelComposer();
                }
              }}
            />
            <button
              type="button"
              class="ins-comments-primary"
              onclick={submitComposer}
            >
              Comment
            </button>
            <button
              type="button"
              class="ins-comments-reply"
              onclick={() => {
                composerDraft = "";
                props.onCancelComposer();
              }}
            >
              Cancel
            </button>
          </div>
        ) : null}

        {visible.length === 0 && !composer ? (
          <div class="ins-comments-empty">
            {filter === "open" ? "No open threads" : "Nothing resolved"}
          </div>
        ) : null}

        {visible.map(card)}
      </div>
    );
  }
})(elTag("inscriptum-comments"));

/** The factory above is only a value (a custom element constructor); this
 *  alias gives consumers the instance type, with its typed `props`. */
export type CommentsPanelElement = InstanceType<typeof CommentsPanelElement>;
