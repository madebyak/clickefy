"use client";

/**
 * The prompt textarea, reference-aware.
 *
 * Attachments are named in the prompt as `@Image1`, `@Video2`, `@Audio1`
 * (see `@clickfy/types` reference-tokens). This component keeps a plain
 * `<textarea>` — so typing, IME composition, right-to-left text, undo and
 * paste all behave natively — and adds three things around it:
 *
 *   1. Chips. A mirror layer BEHIND the transparent textarea paints each
 *      token as a pill: green when it names an attachment, red when it
 *      names one that isn't there. The mirror uses the textarea's exact
 *      font, wrapping and scroll position, so the pills sit under the
 *      real characters. Both hide their scrollbars — a scrollbar on one
 *      and not the other would wrap lines differently.
 *   2. `@` suggestions. Typing `@` at the start of a word lists the
 *      attachments (thumbnail + token); arrows/Enter/Tab pick, Escape
 *      closes. Filters by token, localised kind word, or file name.
 *   3. `insertToken()` through a ref, for the tray's number badges.
 */

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from "react";
import { SpeakerHigh } from "@phosphor-icons/react";
import { findReferenceTokens, type ReferenceKind } from "@clickfy/types";
import { cn } from "@/lib/utils";

export type PromptReference = {
  id: string;
  kind: ReferenceKind;
  /** Canonical token, e.g. `@Image2`. */
  token: string;
  previewUrl: string;
  name?: string;
};

export type ReferencePromptInputHandle = {
  /** Insert a token at the caret (or the end), with spacing handled. */
  insertToken: (token: string) => void;
  focus: () => void;
};

type Props = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "onKeyDown" | "onScroll" | "className"
> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Enter without Shift (and not mid-IME-composition). */
  onSubmit: () => void;
  /** Attachments the prompt can name, in tray order. Empty → no suggestions. */
  references: PromptReference[];
  /** How many attachments of each kind exist — tokens beyond are marked missing. */
  counts: Record<ReferenceKind, number>;
  /** Localised kind words ("Image", "صورة") for filtering and the menu. */
  kindLabels: Record<ReferenceKind, string>;
  menuLabel: string;
  /** Shared font/size/line classes — applied to BOTH the textarea and its mirror. */
  textClassName: string;
  /** Box classes for the textarea (sizing, max-height). */
  className?: string;
  wrapperClassName?: string;
  /** Called on focus so a parent can route badge inserts to this input. */
  onActivate?: (handle: ReferencePromptInputHandle) => void;
};

const MENU_LIMIT = 8;
/** `@` + up to 12 word characters right before the caret, at a word start. */
const MENTION_RE = /(^|[\s(\[{"'“«])@([\p{L}\p{N}_]{0,12})$/u;

export const ReferencePromptInput = forwardRef<ReferencePromptInputHandle, Props>(
  function ReferencePromptInput(
    {
      value,
      onValueChange,
      onSubmit,
      references,
      counts,
      kindLabels,
      menuLabel,
      textClassName,
      className,
      wrapperClassName,
      onActivate,
      onFocus,
      dir,
      ...textareaProps
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const mirrorRef = useRef<HTMLDivElement>(null);
    const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
    const [active, setActive] = useState(0);

    const options = useMemo(() => {
      if (!mention) return [];
      const q = mention.query.toLowerCase();
      return references
        .filter(
          (r) =>
            q === "" ||
            r.token.toLowerCase().startsWith(`@${q}`) ||
            kindLabels[r.kind].toLowerCase().startsWith(q) ||
            (r.name?.toLowerCase().includes(q) ?? false),
        )
        .slice(0, MENU_LIMIT);
    }, [mention, references, kindLabels]);
    const menuOpen = mention !== null && options.length > 0;
    const activeIndex = Math.min(active, Math.max(options.length - 1, 0));

    const setCaret = (pos: number) => {
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(pos, pos);
      });
    };

    /** Replace value[from, to) with `token`, spaced so it stays a separate word. */
    const replaceRange = useCallback(
      (from: number, to: number, token: string) => {
        const before = value.slice(0, from);
        const after = value.slice(to);
        const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
        const trail = after.startsWith(" ") ? "" : " ";
        const next = `${before}${lead}${token}${trail}${after}`;
        onValueChange(next);
        setMention(null);
        setCaret(before.length + lead.length + token.length + trail.length);
      },
      [value, onValueChange],
    );

    const handle = useMemo<ReferencePromptInputHandle>(
      () => ({
        insertToken: (token: string) => {
          const el = textareaRef.current;
          const focused = el !== null && document.activeElement === el;
          const from = focused ? el.selectionStart : value.length;
          const to = focused ? el.selectionEnd : value.length;
          replaceRange(from, to, token);
        },
        focus: () => textareaRef.current?.focus(),
      }),
      [value, replaceRange],
    );
    useImperativeHandle(ref, () => handle, [handle]);

    const detectMention = (el: HTMLTextAreaElement) => {
      if (references.length === 0 || el.selectionStart !== el.selectionEnd) {
        setMention(null);
        return;
      }
      const m = MENTION_RE.exec(el.value.slice(0, el.selectionStart));
      if (!m) {
        setMention(null);
        return;
      }
      const query = m[2] ?? "";
      const start = el.selectionStart - query.length - 1;
      // React's `onSelect` also fires on key presses that don't change the
      // query (e.g. the ArrowDown used to move through the list). Only a
      // NEW query resets the highlighted option — otherwise arrowing down
      // would snap straight back to the first item.
      if (mention?.start === start && mention.query === query) return;
      setMention({ start, query });
      setActive(0);
    };

    const pick = (option: PromptReference) => {
      const el = textareaRef.current;
      if (!el || !mention) return;
      replaceRange(mention.start, el.selectionStart, option.token);
    };

    // Mirror segments: plain text and tokens, in order. A trailing newline
    // needs a visible character after it or the mirror is one line short.
    const segments = useMemo(() => {
      const parts: Array<{ text: string; token?: "ok" | "missing" }> = [];
      let last = 0;
      for (const t of findReferenceTokens(value)) {
        if (t.start > last) parts.push({ text: value.slice(last, t.start) });
        parts.push({ text: t.text, token: t.n <= counts[t.kind] ? "ok" : "missing" });
        last = t.end;
      }
      parts.push({ text: value.slice(last) + (value.endsWith("\n") ? "​" : "") });
      return parts;
    }, [value, counts]);

    const listId = textareaProps.id ? `${textareaProps.id}-refs` : undefined;

    /*
     * `w-full` on the wrapper below is load-bearing, not decoration.
     *
     * The wrapper's only in-flow child is the textarea, and that textarea
     * is `w-full` — so without a width here the two define each other: a
     * shrink-to-fit box around a child asking for 100% of that box. CSS
     * resolves the circle using the textarea's INTRINSIC width, and
     * browsers disagree about what that is for a `field-sizing: content`
     * textarea. Chromium lands near max-content; Safari lands near
     * min-content, which with `break-words` is a few characters — on iOS
     * the composer wrapped "Creative" as "Creat / ive", a word fragment
     * per line.
     *
     * Before this mirror layer existed the textarea was a direct child of
     * the flex row, so its `w-full` resolved against something real. An
     * explicit width here restores that: the size comes from the layout
     * rather than from an intrinsic-size heuristic, and `field-sizing`
     * goes back to being a progressive enhancement for the HEIGHT only.
     *
     * `min-w-0` lets it shrink below its content inside a flex row; a
     * width alone would overflow the row instead.
     */
    return (
      <div className={cn("relative w-full min-w-0", wrapperClassName)}>
        <div
          ref={mirrorRef}
          aria-hidden
          dir={dir}
          className={cn(
            textClassName,
            className,
            "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-start text-transparent",
          )}
        >
          {segments.map((s, i) =>
            s.token ? (
              <span
                key={i}
                className={cn(
                  "rounded-[4px] box-decoration-clone",
                  s.token === "ok" ? "bg-primary/20 ring-1 ring-primary/40" : "bg-status-red/20 ring-1 ring-status-red/50",
                )}
              >
                {s.text}
              </span>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </div>

        <textarea
          {...textareaProps}
          ref={textareaRef}
          dir={dir}
          value={value}
          aria-autocomplete={references.length > 0 ? "list" : undefined}
          aria-expanded={references.length > 0 ? menuOpen : undefined}
          aria-controls={menuOpen ? listId : undefined}
          onChange={(e) => {
            onValueChange(e.target.value);
            detectMention(e.target);
          }}
          onSelect={(e) => detectMention(e.currentTarget)}
          onScroll={(e) => {
            if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onFocus={(e) => {
            onActivate?.(handle);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setMention(null);
            textareaProps.onBlur?.(e);
          }}
          onKeyDown={(e) => {
            if (menuOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setActive((activeIndex + delta + options.length) % options.length);
                return;
              }
              if ((e.key === "Enter" || e.key === "Tab") && !e.nativeEvent.isComposing) {
                e.preventDefault();
                const option = options[activeIndex];
                if (option) pick(option);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setMention(null);
                return;
              }
            }
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            onSubmit();
          }}
          className={cn(
            textClassName,
            className,
            "relative bg-transparent text-start text-foreground outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
        />

        {menuOpen && (
          <div
            id={listId}
            role="listbox"
            aria-label={menuLabel}
            className="absolute bottom-full start-0 z-30 mb-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-surface-3 py-1 shadow-lg ring-1 ring-white/10"
          >
            <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {menuLabel}
            </p>
            {options.map((option, i) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                // Keep focus (and the caret) in the textarea.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(option)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-1.5 text-start text-sm transition-colors",
                  i === activeIndex ? "bg-surface-2 text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-2">
                  {option.kind === "audio" ? (
                    <SpeakerHigh weight="fill" className="size-4 text-accent-turquoise" />
                  ) : option.kind === "video" ? (
                    <video src={option.previewUrl} muted playsInline preload="metadata" className="size-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={option.previewUrl} alt="" className="size-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span dir="ltr" className="block font-medium text-foreground">
                    {option.token}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.name ?? kindLabels[option.kind]}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  },
);
