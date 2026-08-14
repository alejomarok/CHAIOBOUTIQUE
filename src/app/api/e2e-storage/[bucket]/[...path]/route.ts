import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { readE2EStorageObject, writeE2EStorageObject } from "@/modules/storage/e2e-provider";

// Serves (GET) and accepts (PUT) objects for E2EStorageProvider (see
// modules/storage/e2e-provider.ts and modules/storage/index.ts) — the
// locally-served counterpart to real Supabase Storage's public-URL GET and
// signed-upload-URL PUT, used only when the e2e suite runs. PUT exists so
// tests/e2e specs can exercise the exact same "browser PUTs directly to a
// signed URL" code path ProductImagesManager uses against real Supabase in
// dev/production — see modules/products/product-images.ts's
// prepareProductImageUpload. 404s unconditionally when E2E_TEST_MODE isn't
// set, so this route has zero surface area in real dev/production.
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

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ bucket: string; path: string[] }> },
) {
  if (!env.E2E_TEST_MODE) {
    return new NextResponse(null, { status: 404 });
  }

  const { bucket, path } = await params;
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return new NextResponse(null, { status: 401 });
  }

  const contentType = request.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await request.arrayBuffer());

  const accepted = writeE2EStorageObject(bucket, path.join("/"), token, buffer, contentType);
  if (!accepted) {
    return new NextResponse(null, { status: 403 });
  }

  return NextResponse.json({ Key: `${bucket}/${path.join("/")}` }, { status: 200 });
}
