import "server-only";
import { isIP } from "node:net";
import { headers } from "next/headers";

export async function requestIp() {
  const values = await headers();
  const header = process.env.VERCEL
    ? (values.get("x-vercel-forwarded-for") ?? values.get("x-forwarded-for"))
    : values.get("x-forwarded-for");
  const value = header?.split(",")[0]?.trim() ?? "";
  return isIP(value) ? value : "unknown";
}
