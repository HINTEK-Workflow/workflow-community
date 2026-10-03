import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiError,
  body,
  checkOrigin,
  context,
  failure,
} from "@/lib/kfid/server";

export const dynamic = "force-dynamic";

const idSchema = z.string().min(1).max(100);
const saveMessageSchema = z.object({
  action: z.literal("save_message"),
  conversationId: idSchema.optional(),
  content: z.string().trim().min(1).max(8_000),
});
const archiveSchema = z.object({
  action: z.literal("archive"),
  conversationId: idSchema,
});
const renameSchema = z.object({
  action: z.literal("rename"),
  conversationId: idSchema,
  title: z.string().trim().min(1).max(100),
});
const mutationSchema = z.discriminatedUnion("action", [
  saveMessageSchema,
  archiveSchema,
  renameSchema,
]);

function titleFromMessage(content: string) {
  const firstLine = content.split(/\r?\n/, 1)[0].replace(/\s+/g, " ").trim();
  return firstLine.length > 64 ? `${firstLine.slice(0, 61)}…` : firstLine;
}

export async function GET(request: Request) {
  try {
    const ctx = await context();
    const conversationId = new URL(request.url).searchParams.get("conversationId");
    if (conversationId) {
      const id = idSchema.parse(conversationId);
      const conversation = await prisma.aiConversation.findFirst({
        where: {
          id,
          organizationId: ctx.organizationId,
          createdById: ctx.user.id,
        },
        select: {
          id: true,
          title: true,
          status: true,
          moduleId: true,
          resourceType: true,
          resourceId: true,
          lastMessageAt: true,
          createdAt: true,
          updatedAt: true,
          messages: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              role: true,
              content: true,
              citations: true,
              model: true,
              createdAt: true,
            },
          },
          proposals: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              moduleId: true,
              resourceType: true,
              resourceId: true,
              kind: true,
              status: true,
              baseVersion: true,
              createdAt: true,
            },
          },
        },
      });
      if (!conversation) throw new ApiError(404, "AI-konversationen finns inte.");
      return NextResponse.json({ conversation });
    }

    const conversations = await prisma.aiConversation.findMany({
      where: {
        organizationId: ctx.organizationId,
        createdById: ctx.user.id,
        status: "ACTIVE",
      },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        moduleId: true,
        resourceType: true,
        resourceId: true,
        lastMessageAt: true,
        createdAt: true,
        _count: { select: { messages: true, proposals: true } },
      },
    });
    return NextResponse.json({ conversations });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const input = mutationSchema.parse(await body(request));

    if (input.action === "archive" || input.action === "rename") {
      const updated = await prisma.aiConversation.updateMany({
        where: {
          id: input.conversationId,
          organizationId: ctx.organizationId,
          createdById: ctx.user.id,
          status: "ACTIVE",
        },
        data: input.action === "archive"
          ? { status: "ARCHIVED" }
          : { title: input.title },
      });
      if (updated.count !== 1)
        throw new ApiError(404, "AI-konversationen finns inte.");
      return NextResponse.json(input.action === "archive"
        ? { archived: true }
        : { renamed: true, title: input.title });
    }

    const saved = await prisma.$transaction(async (tx) => {
      let conversation = input.conversationId
        ? await tx.aiConversation.findFirst({
            where: {
              id: input.conversationId,
              organizationId: ctx.organizationId,
              createdById: ctx.user.id,
              status: "ACTIVE",
            },
          })
        : null;
      if (input.conversationId && !conversation)
        throw new ApiError(404, "AI-konversationen finns inte.");
      if (!conversation) {
        conversation = await tx.aiConversation.create({
          data: {
            organizationId: ctx.organizationId,
            createdById: ctx.user.id,
            title: titleFromMessage(input.content),
          },
        });
      }
      const message = await tx.aiMessage.create({
        data: {
          conversationId: conversation.id,
          organizationId: ctx.organizationId,
          authorId: ctx.user.id,
          role: "USER",
          content: input.content,
        },
      });
      await tx.aiConversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: message.createdAt },
      });
      return { conversation, message };
    });

    return NextResponse.json({
      conversation: {
        id: saved.conversation.id,
        title: saved.conversation.title,
      },
      message: {
        id: saved.message.id,
        role: saved.message.role,
        content: saved.message.content,
        createdAt: saved.message.createdAt,
      },
      providerCalled: false,
    });
  } catch (error) {
    return failure(error);
  }
}
