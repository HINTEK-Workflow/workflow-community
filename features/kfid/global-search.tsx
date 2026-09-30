/* eslint-disable react-hooks/set-state-in-effect -- Synchronize debounced remote search state with the query and dialog. */
"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, ArrowRight, ClipboardCheck, FolderKanban, ListTodo, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "./ui";
import { api } from "./api";
import { useLocalWorkspaceSearch, type WorkspaceSearchResult } from "@/components/workspace-actions";

// Totalkontrollen F6 (2026-09-29): a task without a responsible person shows its status in Swedish, never the raw code.
const taskStatusLabel = (status: string) => ({ PLANNED: "Planerad", IN_PROGRESS: "Pågår", PAUSED: "Pausad", NEEDS_ACTION: "Behöver åtgärdas", COMPLETED: "Slutförd", DRAFT: "Utkast" } as Record<string, string>)[status] ?? "";
const commands = [
  { label: "Nytt projekt", href: "/?view=new_project" },
  { label: "Ny uppgift", href: "/?view=new_task" },
  { label: "Mina projekt", href: "/?view=projects" },
  { label: "Mina uppgifter", href: "/?view=tasks" },
  { label: "Ny arbetsorder", href: "/?view=workflow_task&taskType=WORK_ORDER" },
  { label: "Mina arbetsordrar", href: "/?view=work_orders" },
  { label: "Tidrapport", href: "/?view=time" },
  { label: "Platser", href: "/?view=facilities" },
  { label: "Kundregister", href: "/?view=customers" },
  { label: "Statistik och översikt", href: "/?view=stats" },
  { label: "Krediter och rapporthistorik", href: "/?view=credits" },
  { label: "Företag och användare", href: "/?view=administration" },
  { label: "Inställningar och autoförslag", href: "/?view=settings" },
  { label: "Kalkylator och hjälp", href: "/?view=help" },
];
export function GlobalSearch({ localMode = false }: { localMode?: boolean } = {}) {
  const localSearch = useLocalWorkspaceSearch();
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(""),
    [controls, setControls] = useState<WorkspaceSearchResult["controls"]>([]),
    [customers, setCustomers] = useState<WorkspaceSearchResult["customers"]>([]),
    [projects, setProjects] = useState<WorkspaceSearchResult["projects"]>([]),
    [tasks, setTasks] = useState<WorkspaceSearchResult["tasks"]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const openRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Never on top of another open dialog (e.g. Kontrollera arbetsytefil); F11, 2026-09-29.
        if (!openRef.current && document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setControls([]);
      setCustomers([]);
      setProjects([]);
      setTasks([]);
      setError("");
      return;
    }
    // A Local company's data lives only in its open file: without it there is nothing to search and no server call.
    if (localMode && !localSearch) {
      setControls([]);
      setCustomers([]);
      setProjects([]);
      setTasks([]);
      setError("Öppna din lokala arbetsyta för att söka.");
      return;
    }
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      const result = localSearch
        ? Promise.resolve(localSearch(q))
        : api<WorkspaceSearchResult>(`/api/workflow-search?q=${encodeURIComponent(q)}`, { signal: abort.signal });
      void result
        .then((found) => {
          setControls(found.controls);
          setCustomers(found.customers);
          setProjects(found.projects);
          setTasks(found.tasks);
          setError("");
        })
        .catch((e) => {
          if (!abort.signal.aborted) {
            setControls([]);
            setCustomers([]);
            setProjects([]);
            setTasks([]);
            setError(e.message);
          }
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [q, open, localSearch, localMode]);

  return (
    <>
      <Button
        variant="outline"
        aria-label="Sök"
        onClick={() => setOpen(true)}
        className="ml-auto"
      >
        <Search className="size-4" />
        <span className="hidden lg:inline">Sök</span>
        <kbd className="hidden text-xs text-muted-foreground xl:inline">
          Ctrl K
        </kbd>
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Sök">
        <Input
          aria-label="Sök i Workflow"
          placeholder="Sök projekt, uppgifter, kontroller eller kunder…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <div className="mt-4 space-y-5" aria-live="polite">
          <section>
            <h3 className="mb-2 text-xs text-muted-foreground">Gå till</h3>
            {commands
              .filter((c) =>
                c.label
                  .toLocaleLowerCase("sv")
                  .includes(q.toLocaleLowerCase("sv")),
              )
              .map((c) => (
                <Button
                  key={c.href}
                  variant="ghost"
                  className="w-full justify-start"
                  asChild
                >
                  <Link href={c.href} onClick={() => setOpen(false)}>
                    <ArrowRight />
                    {c.label}
                  </Link>
                </Button>
              ))}
          </section>
          {projects.length > 0 && <section><h3 className="mb-2 text-xs text-muted-foreground">Projekt</h3>{projects.map((project) => <Button key={project.id} variant="ghost" className="h-auto w-full justify-start whitespace-normal py-3 text-left" asChild><Link href={`/?view=project&projectId=${project.id}`} onClick={() => setOpen(false)}><FolderKanban className="shrink-0" /><span>{project.name}<span className="block text-xs font-normal text-muted-foreground">{project.archivedAt ? "Arkiverat" : project.responsibleName || project.description || "Aktivt projekt"}</span></span></Link></Button>)}</section>}
          {tasks.length > 0 && <section><h3 className="mb-2 text-xs text-muted-foreground">Arbetsorder och riskbedömningar</h3>{tasks.map((task) => <Button key={task.id} variant="ghost" className="h-auto w-full justify-start whitespace-normal py-3 text-left" asChild><Link href={`/?view=workflow_task&taskId=${task.id}&taskType=${task.kind}`} onClick={() => setOpen(false)}><ListTodo className="shrink-0" /><span>{task.title}<span className="block text-xs font-normal text-muted-foreground">{task.kind === "WORK_ORDER" ? "Arbetsorder" : task.kind === "FORM" ? "Formulär" : "Riskbedömning"} · {task.assignedToName || taskStatusLabel(task.status)}</span></span></Link></Button>)}</section>}
          {controls.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs text-muted-foreground">Kontroller</h3>
              {controls.map((c) => (
                <Button
                  key={c.id}
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal py-3 text-left"
                  asChild
                >
                  <Link
                    href={`/?view=new&id=${c.id}`}
                    onClick={() => setOpen(false)}
                  >
                    <ClipboardCheck className="shrink-0" />
                    <span>
                      #{c.number} {c.title}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {c.date} · {c.performer}
                      </span>
                    </span>
                  </Link>
                </Button>
              ))}
            </section>
          )}
          {customers.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs text-muted-foreground">Kunder</h3>
              {customers.map((c) => (
                <Button
                  key={c.id}
                  variant="ghost"
                  className="w-full justify-start"
                  asChild
                >
                  <Link
                    href={`/?view=customers&customerId=${encodeURIComponent(c.id)}`}
                    onClick={() => setOpen(false)}
                  >
                    <Users />
                    {c.name}
                    <span className="truncate text-xs text-muted-foreground">
                      {c.company}
                    </span>
                  </Link>
                </Button>
              ))}
            </section>
          )}
          {q.length < 2 ? (
            <p className="text-sm text-muted-foreground">
              Skriv minst två tecken för att söka i projekt, uppgifter, kunder och kontrollinnehåll.
            </p>
          ) : loading ? (
            <p className="text-sm">Söker…</p>
          ) : error ? (
            <p role="alert" className="text-sm text-muted-foreground">
              {error}
            </p>
          ) : !customers.length && !controls.length && !projects.length && !tasks.length ? (
            <p className="text-sm text-muted-foreground">
              Inga projekt, uppgifter, kunder eller kontroller matchar.
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
