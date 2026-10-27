import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env-core";

export function isInternalTaskAuthorized(request: Request): boolean {
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  return [env.CRON_SECRET, env.INTERNAL_TASK_SECRET].some((secret) => {
    if (!secret) return false;
    const expected = Buffer.from(`Bearer ${secret}`);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}
