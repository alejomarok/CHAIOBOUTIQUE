"use server";

import { after } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { requestIp } from "@/lib/request-ip";
import {
  createConsumerRequest,
  consumerRequestSchema,
} from "@/modules/consumer-requests/service-core";
import { processEmailOutbox } from "@/modules/email/outbox-core";

const limiter = createRateLimiter(10, 60 * 60 * 1000);
export interface ConsumerRequestState {
  code?: string;
  error?: string;
}

export async function submitConsumerRequestAction(
  _previous: ConsumerRequestState,
  form: FormData,
): Promise<ConsumerRequestState> {
  try {
    if (form.get("website"))
      return { error: "No pudimos registrar la solicitud. Intentá de nuevo." };
    const limit = await limiter.check(`consumer-request:${await requestIp()}`);
    if (!limit.success)
      return {
        error:
          "Recibimos varias solicitudes desde esta conexión. Esperá un momento o contactanos por WhatsApp.",
      };
    const parsed = consumerRequestSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success)
      return { error: parsed.error.issues[0]?.message ?? "Revisá los datos ingresados." };
    const result = await createConsumerRequest(parsed.data);
    after(async () => {
      await processEmailOutbox(2);
    });
    return { code: result.code };
  } catch {
    return {
      error:
        "No pudimos registrar la solicitud. Intentá nuevamente o escribinos por WhatsApp al +54 9 3571 31-9469.",
    };
  }
}
