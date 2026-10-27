import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";
import { env } from "@/lib/env-core";
import { isEmailDeliveryAvailable } from "@/modules/email/availability-core";

const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;
export async function POST(request: Request) {
  if (
    env.NODE_ENV === "production" &&
    new URL(request.url).pathname.endsWith("/request-password-reset") &&
    !(await isEmailDeliveryAvailable())
  )
    return Response.json(
      {
        code: "EMAIL_SERVICE_UNAVAILABLE",
        message: "No pudimos enviar las instrucciones. Intentá nuevamente en unos minutos.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  return handlers.POST(request);
}
