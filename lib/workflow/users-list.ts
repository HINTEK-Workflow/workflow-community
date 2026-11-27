/**
 * Användare som lista (2026-10-31): the members and the invitations of a company as one list, with the chips, search
 * and sort of the shared filter bar. Pure, so the page and the tests read the same rules. Display only: the server decides
 * who may see and change what (app/api/administration/route.ts).
 */
export const USERS_HREF = "/?view=administration";
export const userPersonHref = (userId: string) => `${USERS_HREF}&person=${encodeURIComponent(userId)}`;
export const userInvitationHref = (invitationId: string) => `${USERS_HREF}&invitation=${encodeURIComponent(invitationId)}`;

export const USER_FILTERS = ["all", "active", "paused", "invited"] as const;
export type UserFilter = (typeof USER_FILTERS)[number];
export const USER_FILTER_LABEL: Record<UserFilter, string> = { all: "Alla", active: "Aktiva", paused: "Pausade", invited: "Inbjudna" };

export const USER_SORTS = ["name", "email", "role"] as const;
export type UserSort = (typeof USER_SORTS)[number];
export const USER_SORT_OPTIONS: readonly { value: UserSort; label: string }[] = [{ value: "name", label: "Namn" }, { value: "email", label: "E-post" }, { value: "role", label: "Roll" }];

export type UserStatus = "active" | "paused" | "inactive" | "prepared" | "sent";
export const USER_STATUS_LABEL: Record<UserStatus, string> = { active: "Aktiv", paused: "Pausad", inactive: "Konto inaktivt", prepared: "Förberedd", sent: "Inbjuden" };

export const userRoleLabel = (role: string) => ({ OWNER: "Företagsadmin", ADMIN: "Företagsadmin", MEMBER: "Medarbetare" } as Record<string, string>)[role] ?? role;

export type UserListItem = { kind: "member" | "invitation"; id: string; name: string; email: string; role: string; status: UserStatus; href: string };
type MemberInput = { role: string; isActive: boolean; user: { id: string; name: string | null; email: string; isActive: boolean } };
type InvitationInput = { id: string; name: string; email: string; role: string; status: "PREPARED" | "PENDING" };

export const memberStatus = (member: Pick<MemberInput, "isActive" | "user">): UserStatus => !member.user.isActive ? "inactive" : member.isActive ? "active" : "paused";
export const invitationStatus = (invitation: Pick<InvitationInput, "status">): UserStatus => invitation.status === "PENDING" ? "sent" : "prepared";

export function userListItems(members: readonly MemberInput[], invitations: readonly InvitationInput[]): UserListItem[] {
  return [
    ...members.map((member): UserListItem => ({ kind: "member", id: member.user.id, name: member.user.name || member.user.email, email: member.user.email, role: member.role, status: memberStatus(member), href: userPersonHref(member.user.id) })),
    ...invitations.map((invitation): UserListItem => ({ kind: "invitation", id: invitation.id, name: invitation.name || invitation.email, email: invitation.email, role: invitation.role, status: invitationStatus(invitation), href: userInvitationHref(invitation.id) })),
  ];
}

const inFilter = (item: UserListItem, filter: UserFilter) => {
  if (filter === "all") return true;
  if (filter === "invited") return item.kind === "invitation";
  if (filter === "active") return item.status === "active";
  return item.status === "paused" || item.status === "inactive";
};

/** How many each chip holds. */
export const userFilterCounts = (items: readonly UserListItem[]) =>
  Object.fromEntries(USER_FILTERS.map((filter) => [filter, items.filter((item) => inFilter(item, filter)).length])) as Record<UserFilter, number>;

/** The chip and the search (name, e-mail, role), then the sort; names in Swedish order, name as the second key. */
export function shownUsers(items: readonly UserListItem[], filter: UserFilter, query: string, sort: UserSort): UserListItem[] {
  const words = query.trim().toLocaleLowerCase("sv").split(/\s+/).filter(Boolean);
  const byName = (a: UserListItem, b: UserListItem) => a.name.localeCompare(b.name, "sv");
  const order = sort === "email" ? (a: UserListItem, b: UserListItem) => a.email.localeCompare(b.email, "sv")
    : sort === "role" ? (a: UserListItem, b: UserListItem) => userRoleLabel(a.role).localeCompare(userRoleLabel(b.role), "sv") || byName(a, b)
    : byName;
  return items.filter((item) => inFilter(item, filter))
    .filter((item) => { const text = `${item.name} ${item.email} ${userRoleLabel(item.role)}`.toLocaleLowerCase("sv"); return words.every((word) => text.includes(word)); })
    .sort(order);
}
