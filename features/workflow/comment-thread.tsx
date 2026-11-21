"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { BellOff, BellPlus, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RemoveButton } from "@/components/ui/remove-button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { Field, Panel } from "@/features/kfid/ui";
import { COMMENT_BODY_MAX, type CommentParentType } from "@/lib/comments/model";
import { formatSwedish } from "@/lib/swedish-time";
import { announce } from "@/lib/workflow/toast";
import { indicatorBadge } from "./indicator-tone";
import { cn } from "@/lib/utils";

type Comment = { id: string; authorName: string; body: string; inCustomerReport: boolean; createdAt: string; mine: boolean; canRemove: boolean };
type Person = { id: string; name: string };
type Thread = { comments: Comment[]; hasOlder: boolean; following: boolean; canChooseCustomer: boolean; people: Person[] };

const CUSTOMER_LABEL = "Med i kundrapporten";
const when = (value: string) => formatSwedish(value, { dateStyle: "short", timeStyle: "short" });

/** The @namn being written at the end of the text, for the list of names under the field. */
function mentionQuery(text: string) {
  const match = /(?:^|\s)@([^\s@]*(?: [^\s@]*)?)$/u.exec(text);
  return match ? match[1].toLocaleLowerCase("sv") : null;
}

/**
 * Kommentarer (beslut 14, 2026-11-01): one thread per work order, project and deviation, in the page's ordinary card. Internal
 * unless "Med i kundrapporten" is chosen. @namn tells that person; Följ tells the person about new comments. What the
 * person may do here only decides what is shown: the server checks the company, the membership and the right to read the
 * parent every time. Local has one user, so the caller leaves the thread out there.
 */
export function CommentThread({ parentType, parentId, disabled = false }: { parentType: CommentParentType; parentId: string; disabled?: boolean }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [customer, setCustomer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmCard] = useConfirm();
  const fieldId = useId();
  const seenFor = useRef("");
  const query = `parentType=${encodeURIComponent(parentType)}&parentId=${encodeURIComponent(parentId)}`;
  const post = useCallback(<T,>(input: Record<string, unknown>) => api<T>("/api/comments", { method: "POST", body: JSON.stringify(input) }), []);
  const parent = useMemo(() => ({ parentType, parentId }), [parentType, parentId]);

  useEffect(() => {
    const controller = new AbortController();
    void api<Thread>(`/api/comments?${query}`, { signal: controller.signal, cache: "no-store" })
      .then((data) => { if (controller.signal.aborted) return; setThread(data); setError(""); })
      .catch((cause) => { if (!controller.signal.aborted) setError((cause as Error).message); });
    return () => controller.abort();
  }, [query]);

  // The thread is on the screen: the person's notices of it are read. Once per thread; a failure only leaves them unread.
  useEffect(() => {
    if (!thread?.comments.length || seenFor.current === query) return;
    seenFor.current = query;
    void post({ action: "seen", ...parent }).catch(() => undefined);
  }, [thread, query, parent, post]);

  const asking = mentionQuery(text);
  const suggestions = asking === null || !thread ? [] : thread.people.filter((person) => person.name.toLocaleLowerCase("sv").includes(asking)).slice(0, 6);
  const choosePerson = (person: Person) => setText((current) => `${current.replace(/@([^\s@]*(?: [^\s@]*)?)$/u, "")}@${person.name} `);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); setError(""); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const send = () => act(async () => {
    const answer = await post<{ comment: Comment; told: number }>({ action: "add", ...parent, body: text, inCustomerReport: customer });
    setThread((current) => current ? { ...current, comments: [...current.comments, answer.comment] } : current);
    setText(""); setCustomer(false);
    if (answer.told) announce(answer.told === 1 ? "En person har fått en notis." : `${answer.told} personer har fått en notis.`);
  });
  const follow = () => act(async () => {
    if (!thread) return;
    const answer = await post<{ following: boolean }>({ action: "follow", ...parent, follow: !thread.following });
    setThread((current) => current ? { ...current, following: answer.following } : current);
    announce(answer.following ? "Du får en notis om nya kommentarer." : "Du följer inte längre.");
  });
  const setForCustomer = (comment: Comment, inCustomerReport: boolean) => act(async () => {
    const answer = await post<{ comment: Comment }>({ action: "set_customer", id: comment.id, inCustomerReport });
    setThread((current) => current ? { ...current, comments: current.comments.map((item) => item.id === comment.id ? answer.comment : item) } : current);
  });
  const remove = async (comment: Comment) => {
    if (!(await confirm({ title: "Ta bort kommentaren?", message: comment.inCustomerReport ? "Den tas också bort ur kundrapporten." : "Kommentaren tas bort från tråden.", confirmLabel: "Ta bort", tone: "danger" }))) return;
    await act(async () => {
      await post({ action: "remove", id: comment.id });
      setThread((current) => current ? { ...current, comments: current.comments.filter((item) => item.id !== comment.id) } : current);
    });
  };

  return <Panel icon={MessageSquare} title="Kommentarer" description="Kommentarer är interna om du inte väljer annat. Skriv @namn för att ge någon en notis."
    actions={thread ? <Button type="button" variant="outline" size="sm" disabled={busy} aria-pressed={thread.following} onClick={() => void follow()} data-testid="comments-follow">
      {thread.following ? <BellOff aria-hidden="true" /> : <BellPlus aria-hidden="true" />}{thread.following ? "Sluta följa" : "Följ"}</Button> : undefined}>
    {confirmCard}
    <div className="space-y-4" data-testid="comment-thread">
      {error ? <p role="alert" className="notice text-destructive">{error}</p> : null}
      {!thread && !error ? <p role="status" className="text-sm text-muted-foreground">Hämtar kommentarer…</p> : null}
      {thread?.hasOlder ? <p className="text-xs text-muted-foreground">Visar de senaste kommentarerna.</p> : null}
      {thread?.comments.length ? <ul className="space-y-3" aria-label="Kommentarer">
        {thread.comments.map((comment) => <li key={comment.id} className="min-w-0 rounded-lg border bg-background p-3" data-testid="comment-row">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words text-sm font-medium">{comment.authorName}</span>
            <time className="text-xs text-muted-foreground" dateTime={comment.createdAt}>{when(comment.createdAt)}</time>
            {comment.inCustomerReport ? <span className={cn("rounded-full border px-2 py-0.5 text-xs", indicatorBadge("info"))} data-testid="comment-customer">{CUSTOMER_LABEL}</span> : null}
            {comment.canRemove && !disabled ? <RemoveButton label="Ta bort kommentaren" className="ml-auto" disabled={busy} onClick={() => void remove(comment)} /> : null}
          </div>
          <p className="mt-1 whitespace-pre-line break-words text-sm">{comment.body}</p>
          {thread.canChooseCustomer && !disabled ? <Button type="button" variant="ghost" size="sm" className="mt-1 -ml-2" disabled={busy} onClick={() => void setForCustomer(comment, !comment.inCustomerReport)} data-testid="comment-customer-toggle">
            {comment.inCustomerReport ? "Ta bort ur kundrapporten" : "Lägg i kundrapporten"}</Button> : null}
        </li>)}
      </ul> : thread ? <p className="text-sm text-muted-foreground">Inga kommentarer ännu.</p> : null}
      {thread && !disabled ? <div className="space-y-2">
        <Field id={`${fieldId}-comment`} multiline label="Ny kommentar" value={text} onChange={setText} disabled={busy} />
        {suggestions.length ? <ul className="flex flex-wrap gap-1.5" aria-label="Personer" data-testid="comment-mentions">
          {suggestions.map((person) => <li key={person.id}><Button type="button" variant="outline" size="sm" onClick={() => choosePerson(person)}>@{person.name}</Button></li>)}
        </ul> : null}
        {text.length > COMMENT_BODY_MAX ? <p role="alert" className="text-xs text-destructive">Högst {COMMENT_BODY_MAX} tecken.</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {thread.canChooseCustomer ? <label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={customer} disabled={busy} onCheckedChange={(value) => setCustomer(value === true)} data-testid="comment-for-customer" />{CUSTOMER_LABEL}</label> : <span />}
          <Button type="button" disabled={busy || !text.trim() || text.length > COMMENT_BODY_MAX} onClick={() => void send()} data-testid="comment-send">Skicka</Button>
        </div>
      </div> : null}
    </div>
  </Panel>;
}
