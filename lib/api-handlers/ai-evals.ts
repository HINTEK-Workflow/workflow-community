import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  ApiError,
  body,
  checkOrigin,
  context,
  failure,
} from "@/lib/kfid/server";
import { openAiProviderStatus } from "@/lib/ai/openai-provider";
import {
  OPENAI_PROVIDER_EVAL_MODELS,
  runOpenAiProviderEvalSuite,
} from "@/lib/ai/provider-eval";
import { classifyProviderEvalFailure } from "@/lib/ai/provider-eval-errors";

export const dynamic = "force-dynamic";

function requireSuperadmin(role: string) {
  if (role !== "SUPERADMIN")
    throw new ApiError(403, "Endast superadmin får verifiera AI-providern.");
}

export async function GET() {
  try {
    const ctx = await context({ skipLegal: true });
    requireSuperadmin(ctx.user.role);
    const provider = await openAiProviderStatus();
    return NextResponse.json({
      enabled: provider.evalEnabled,
      configured: provider.configured,
      euDataControlsApproved: provider.euDataControlsApproved,
      providerEvalApproved: provider.providerEvalApproved,
      normalProviderDisabled: !provider.requested,
      processingRegion: provider.processingRegion,
      baseUrl: provider.baseUrl,
      models: OPENAI_PROVIDER_EVAL_MODELS,
      ready:
        provider.evalEnabled &&
        provider.configured &&
        (provider.processingRegion !== "EU" || provider.euDataControlsApproved) &&
        !provider.requested,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireSuperadmin(ctx.user.role);
    z.object({ action: z.literal("run_suite") }).strict().parse(await body(request));
    if (!env.OPENAI_EVAL_ENABLED)
      throw new ApiError(503, "OpenAI provider-eval är avstängd.");
    const results = await runOpenAiProviderEvalSuite();
    return NextResponse.json({
      passed: results.length === OPENAI_PROVIDER_EVAL_MODELS.length,
      region: (await openAiProviderStatus()).processingRegion,
      providerStateStored: false,
      results,
    });
  } catch (error) {
    const providerFailure = classifyProviderEvalFailure(error);
    if (providerFailure)
      return NextResponse.json(
        { error: providerFailure.message, code: providerFailure.code },
        { status: providerFailure.status },
      );
    return failure(error);
  }
}
