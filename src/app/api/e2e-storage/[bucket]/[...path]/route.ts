import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { readE2EStorageObject } from "@/modules/storage/e2e-provider";

// Serves objects uploaded through E2EStorageProvider (see modules/storage/
// e2e-provider.ts and modules/storage/index.ts) — the locally-served
// counterpart to a real Supabase Storage public URL, used only when the e2e
// suite runs. 404s unconditionally when E2E_TEST_MODE isn't set, so this
// route has zero surface area in real dev/production.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bucket: string; path: string[] }> },
) {
  if (!env.E2E_TEST_MODE) {
    return new NextResponse(null, { status: 404 });
  }

  const { bucket, path } = await params;
  const object = readE2EStorageObject(bucket, path.join("/"));
  if (!object) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(object.buffer), {
    status: 200,
    headers: {
      "Content-Type": object.contentType,
      "Cache-Control": "no-store",
    },
  });
}
