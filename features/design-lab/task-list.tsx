"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ClipboardCheck, ClipboardList, Gauge, HardHat, RefreshCw, Search, ShieldAlert, Wrench, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MAX_TASK_HOURS, TASK_CATEGORIES, TASK_TYPES, type TaskCategory } from "./data";
import { Bar, LabSelect, PhoneGroup, PhoneRow, PhoneTopBar, Pill, Segmented, useLab, useLookOnly } from "./parts";
import s from "./design-lab.module.css";

const ICONS: Record<string, LucideIcon> = { t1: ClipboardList, t2: Gauge, t3: ClipboardCheck, t4: Zap, t5: RefreshCw, t6: Wrench, t7: ShieldAlert, t8: HardHat };
type Filter = "Alla" | TaskCategory;
const FILTERS: readonly Filter[] = ["Alla", ...TASK_CATEGORIES];

/**
 * En lista (Lovable "Ny uppgift", 2026-10-16): search and a segmented filter above a table card with a light
 * header row; each row an icon square, the title with a line under it, the category, the required level as a grey pill,
 * the estimated time as a thin bar and the action as a blue link at the right. Example data only.
 */
export function TaskListDemo() {
  const { view } = useLab();
  const lookOnly = useLookOnly();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("Alla");
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return TASK_TYPES.filter((task) => (filter === "Alla" || task.category === filter) && (!words || `${task.title} ${task.description}`.toLowerCase().includes(words)));
  }, [query, filter]);

  const search = <label className={s.search}>
    <Search aria-hidden="true" />
    <span className={s.srOnly}>Sök uppgiftstyp</span>
    <Input type="search" className={s.input} value={query} placeholder="Sök uppgiftstyp" onChange={(event) => setQuery(event.target.value)} data-testid="lab-task-search" />
  </label>;

  if (view === 1) {
    return <div className={s.phoneScreen} data-testid="lab-task-list">
      <PhoneTopBar title="Ny uppgift" back="Hem" onBack={lookOnly("Tillbaka")} />
      <div className={s.phoneBody}>
        <div className={s.phoneInset}>
          {search}
          <div className={s.phoneFilter}><LabSelect label="Kategori" value={filter} options={FILTERS} onChange={(value) => setFilter(value as Filter)} /></div>
        </div>
        <PhoneGroup title={filter === "Alla" ? "Alla uppgiftstyper" : filter}>
          {shown.map((task) => <PhoneRow key={task.id} icon={ICONS[task.id]} title={task.title} subtitle={`${task.category} · nivå ${task.level} · ${task.hours} h`} onClick={lookOnly(task.action)} testId="lab-task-row" />)}
          {shown.length === 0 ? <p className={s.empty}>Ingen uppgiftstyp matchar sökningen.</p> : null}
        </PhoneGroup>
      </div>
    </div>;
  }

  return <div className={s.page} data-testid="lab-task-list">
    <header className={s.pageHeader} data-testid="lab-page-header">
      <div className={s.minw0}>
        <h1 className={s.pageTitle}>Ny uppgift</h1>
        <p className={s.pageSub}>Välj vilken sorts uppgift du vill skapa. {TASK_TYPES.length} uppgiftstyper.</p>
      </div>
    </header>
    <div className={s.listTools}>
      {search}
      <Segmented label="Kategori" value={filter} options={FILTERS} onChange={setFilter} strong testId="lab-task-filter" />
    </div>
    <section className={s.card} aria-label="Uppgiftstyper">
      <div className={s.tableBox}>
        <div role="table" aria-label="Uppgiftstyper" className={s.table} data-kind="tasks">
          <div role="row" className={s.tableHead}>
            <span role="columnheader">Uppgiftstyp</span>
            <span role="columnheader">Kategori</span>
            <span role="columnheader">Behörighet</span>
            <span role="columnheader">Uppskattad tid</span>
            <span role="columnheader" className={s.srOnly}>Åtgärd</span>
          </div>
          {shown.map((task) => {
            const Icon = ICONS[task.id];
            return <div role="row" key={task.id} className={s.tableRow} data-testid="lab-task-row">
              <span role="cell" className={s.taskCell}>
                <span className={s.softIcon}><Icon aria-hidden="true" /></span>
                <span className={s.minw0}>
                  <span className={s.taskTitle}>{task.title}</span>
                  <span className={s.taskDesc}>{task.description}</span>
                  <span className={s.taskMeta}>HINTEK Original · v{task.version}</span>
                </span>
              </span>
              <span role="cell" className={s.cell}><span className={s.cellLabel}>Kategori</span>{task.category}</span>
              <span role="cell" className={s.cell}><span className={s.cellLabel}>Behörighet</span><Pill>Nivå {task.level}</Pill></span>
              <span role="cell" className={s.cell}><span className={s.cellLabel}>Uppskattad tid</span><span className={s.timeCell}><Bar value={(task.hours / MAX_TASK_HOURS) * 100} label={`Uppskattad tid ${task.hours} timmar`} /><span className={s.num}>{task.hours} h</span></span></span>
              <span role="cell" className={`${s.cell} ${s.cellEnd}`}><button type="button" className={s.link} onClick={lookOnly(task.action)}>{task.action}<ArrowRight aria-hidden="true" /></button></span>
            </div>;
          })}
          {shown.length === 0 ? <p className={s.empty}>Ingen uppgiftstyp matchar sökningen.</p> : null}
        </div>
      </div>
    </section>
  </div>;
}
