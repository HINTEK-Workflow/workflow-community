"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { TypeKey } from "@/lib/workflow/native-mode";
import { ListGroup, ListRow, NativePage, type ListRowProps } from "./list";
import { Tile, TileGrid } from "./tile";

/**
 * A menu page at level 1 (M2, 2026-10-12, "D2"): the two most common choices as big tiles on top, the rest as rows
 * under them, so the menu pages (Mer, Tid, Inställningar, a customer’s card, Hjälp) do not all look alike. Built from the
 * shared TileGrid/Tile and ListGroup/ListRow; a page that needs something between them (a search field, a facts group)
 * passes it as `children` and it is drawn after the tiles. Fewer than two tiles is fine (one tile fills the row);
 * more than two is not what the pattern is for: the rest are rows.
 */
export type NativeMenuTile = { title: ReactNode; subtitle?: ReactNode; type: TypeKey; icon?: LucideIcon; href?: string; onClick?: () => void; testId?: string };
export type NativeMenuGroup = { title?: ReactNode; footer?: ReactNode; rows: (ListRowProps & { key: string })[]; testId?: string };

export function NativeMenuPage({ tiles = [], groups = [], children, testId = "native-menu" }: {
  /** The two big choices (the first two are used). */
  tiles?: readonly NativeMenuTile[];
  groups?: readonly NativeMenuGroup[];
  children?: ReactNode;
  testId?: string;
}) {
  const shown = tiles.slice(0, 2);
  return <NativePage testId={testId}>
    {shown.length ? <div data-testid={`${testId}-tiles`} className={shown.length === 1 ? "[&>div]:grid-cols-1" : undefined}>
      <TileGrid>{shown.map((tile, index) => <Tile key={index} {...tile} />)}</TileGrid>
    </div> : null}
    {children}
    {groups.map((group, index) => <ListGroup key={index} title={group.title} footer={group.footer} testId={group.testId ?? `${testId}-group-${index}`}>
      {group.rows.map(({ key, ...row }) => <ListRow key={key} {...row} />)}
    </ListGroup>)}
  </NativePage>;
}
