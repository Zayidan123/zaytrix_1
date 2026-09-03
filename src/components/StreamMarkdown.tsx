/**
 * StreamMarkdown — QA8-C progressive markdown renderer
 * ----------------------------------------------------
 * Renders a markdown document that is still being streamed token-by-token.
 *
 * Algorithm:
 *   1. Split the text on /\n\n+/ into paragraphs.
 *   2. Every paragraph EXCEPT the last is rendered through react-markdown
 *      inside a memoized subcomponent (React.memo on the `text` prop) — a
 *      finished paragraph never re-parses when new tokens arrive, so streaming
 *      cost stays O(new tokens) instead of O(full document).
 *   3. The LAST paragraph (the growing tail) is rendered as raw text inside
 *      <span className="whitespace-pre-wrap"> while streaming — parsing a
 *      half-finished code fence / table / list would flash "broken" markdown,
 *      so the tail stays plain until it is complete. A terminal-style
 *      caret (.zx-stream-cursor) is appended behind it.
 *   4. When isStreaming is false the tail is rendered as markdown too, so the
 *      final document is fully formatted.
 *
 * The caret CSS ships with this component (hoisted + de-duplicated by React
 * 19 via href/precedence; identical rules to the old definition that lived
 * only inside MarketSentimentChat) so any host can stream-render without
 * depending on another component's styles.
 *
 * Accessibility note: this component deliberately does NOT use aria-live.
 * A live region would announce every single SSE token frame (dozens per
 * second), flooding screen readers. The streaming state is conveyed
 * visually by the blinking caret + "streaming" chips in the host components.
 */

import React, { memo } from "react";
import Markdown from "react-markdown";

interface StreamMarkdownProps {
  /** Full text so far (completed paragraphs + partial tail). */
  text: string;
  /** True while SSE tokens are still arriving. */
  isStreaming?: boolean;
  /** Optional wrapper class (e.g. "markdown-body ..."). */
  className?: string;
}

/** One finished markdown paragraph — memoized so re-renders triggered by
 *  streaming tokens skip every paragraph whose text did not change. */
const StreamParagraph = memo(function StreamParagraph({ text }: { text: string }) {
  return <Markdown>{text}</Markdown>;
});

/** Terminal caret shown while tokens stream. */
function StreamCursor() {
  return (
    <span
      className="zx-stream-cursor"
      aria-label="AI sedang menulis"
      title="AI sedang menulis…"
    />
  );
}

/** Caret CSS (global, hoisted + de-duplicated by React 19 via href/precedence). */
const STREAM_CURSOR_CSS = `
.zx-stream-cursor {
  display: inline-block;
  width: 7px;
  height: 13px;
  margin-left: 2px;
  vertical-align: text-bottom;
  border-radius: 1.5px;
  background: linear-gradient(180deg, #a78bfa, #7c3aed);
  box-shadow: 0 0 8px rgba(139, 92, 246, 0.65);
  animation: zx-caret-blink 0.85s steps(1) infinite;
}
@keyframes zx-caret-blink {
  0%, 55% { opacity: 1; }
  56%, 100% { opacity: 0; }
}`;

/** Rendered once per document (deduped by href) — plain <style> is global
 *  CSS anyway, so even without hoisting the rules apply wherever this tree
 *  is mounted. */
function StreamCursorStyle() {
  return <style href="zx-stream-cursor" precedence="base">{STREAM_CURSOR_CSS}</style>;
}

export default function StreamMarkdown({ text, isStreaming = false, className }: StreamMarkdownProps) {
  const parts = text.split(/\n\n+/);
  // A trailing empty split artifact (text ending in "\n\n") is dropped so the
  // caret attaches to real content instead of an empty tail.
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }

  if (parts.length === 0) {
    // No content yet: show only the caret while streaming (the bubble exists,
    // the first token just has not arrived yet).
    return isStreaming ? (
      <div className={className}>
        <StreamCursorStyle />
        <StreamCursor />
      </div>
    ) : null;
  }

  const lastIndex = parts.length - 1;

  return (
    <div className={className}>
      <StreamCursorStyle />
      {parts.slice(0, lastIndex).map((paragraph, i) => (
        <StreamParagraph key={i} text={paragraph} />
      ))}
      {isStreaming ? (
        // Growing tail: raw text (no markdown parsing of partial blocks) + caret.
        <>
          <span className="whitespace-pre-wrap">{parts[lastIndex]}</span>
          <StreamCursor />
        </>
      ) : (
        // Final tail: clean markdown render, identical to the non-streaming path.
        <StreamParagraph text={parts[lastIndex]} />
      )}
    </div>
  );
}
