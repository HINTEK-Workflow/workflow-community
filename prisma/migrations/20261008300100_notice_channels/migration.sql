-- Notiser per e-post och webbpush (2026-10-07): the person's own opt-in (nothing is on from the start), the devices
-- that said yes to web push, the mark that a notice has been sent (one per notice, channel and person) and the VAPID
-- key pair the installation pushes with (the private key sealed, like the SMTP password). Additive and safe to run again.

CREATE TABLE IF NOT EXISTS "NoticePreference" (
    "userId" TEXT NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "push" BOOLEAN NOT NULL DEFAULT false,
    "kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoticePreference_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSentAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId");

CREATE TABLE IF NOT EXISTS "NoticeDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "NoticeDelivery_userId_channel_key_key" ON "NoticeDelivery"("userId", "channel", "key");
CREATE INDEX IF NOT EXISTS "NoticeDelivery_organizationId_createdAt_idx" ON "NoticeDelivery"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "NoticeDelivery_createdAt_idx" ON "NoticeDelivery"("createdAt");

ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "push" JSONB NOT NULL DEFAULT '{}';
