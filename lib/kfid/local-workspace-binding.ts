import { ApiError } from "@/lib/kfid/errors";

type BindingLookup = {
  localWorkspaceBinding: {
    findFirst: (input: { where: { organizationId: string; userId: string; localIdentityId: string; revokedAt: null } }) => Promise<{ id: string } | null>;
  };
};

// Future Local → Cloud mutations must call this before trusting any Local owner
// field. A UUID in a .hwf file is an identifier, never authorization by itself.
export async function requireActiveLocalWorkspaceBinding(
  db: BindingLookup,
  input: { organizationId: string; userId: string; localIdentityId: string },
) {
  const binding = await db.localWorkspaceBinding.findFirst({
    where: { ...input, revokedAt: null },
  });
  if (!binding) throw new ApiError(403, "Den lokala arbetsytan är inte kopplad till din Cloud-användare eller har återkallats.");
  return binding;
}
