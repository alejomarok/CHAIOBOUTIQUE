import { describe, expect, it, vi } from "vitest";

import { ensureUniqueSlug, slugify } from "@/lib/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Remera Básica")).toBe("remera-basica");
  });

  it("strips accents", () => {
    expect(slugify("Pantalón Café")).toBe("pantalon-cafe");
  });

  it("collapses non-alphanumeric runs into a single hyphen", () => {
    expect(slugify("Talle  Único / Especial!!")).toBe("talle-unico-especial");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  -Vestido-  ")).toBe("vestido");
  });
});

describe("ensureUniqueSlug", () => {
  it("returns the base slug when it's free", async () => {
    const checkExists = vi.fn().mockResolvedValue(false);
    expect(await ensureUniqueSlug("Remera Básica", checkExists)).toBe("remera-basica");
  });

  it("appends -2, -3, ... until a free slug is found", async () => {
    const taken = new Set(["remera-basica", "remera-basica-2"]);
    const checkExists = vi.fn(async (slug: string) => taken.has(slug));
    expect(await ensureUniqueSlug("Remera Básica", checkExists)).toBe("remera-basica-3");
  });
});
