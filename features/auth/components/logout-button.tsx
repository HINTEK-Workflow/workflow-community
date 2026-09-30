"use client";

import { startTransition, useState } from "react";
import { LogOut, LoaderCircle } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LogoutButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="outline"
      className={cn(className)}
      onClick={() => {
        setPending(true);
        startTransition(async () => {
          localStorage.removeItem("kfid.offline.owner");
          await signOut({
            callbackUrl: "/login",
          });
        });
      }}
      disabled={pending}
    >
      {pending ? (
        <>
          <LoaderCircle className="size-4 animate-spin" />
          Loggar ut...
        </>
      ) : (
        <>
          <LogOut className="size-4" />
          Logga ut
        </>
      )}
    </Button>
  );
}
