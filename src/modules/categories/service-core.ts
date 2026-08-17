import { prisma } from "@/lib/db-core";
import { ensureUniqueSlug } from "@/lib/slug";
import { recordAuditLog } from "@/modules/audit/index-core";

// Node-safe core: no "server-only" import, and imports db-core.ts/
// audit/index-core.ts (not the "server-only"-guarded wrappers) so this stays
// importable from a plain Node context (Playwright's test-runner process) —
// see src/modules/categories/service.ts and ARCHITECTURE.md.

export class CategoryCycleError extends Error {
  constructor() {
    super("Esa categoría no puede ser su propia ancestra.");
    this.name = "CategoryCycleError";
  }
}

export async function listCategories() {
  return prisma.category.findMany({
    where: { archivedAt: null },
    include: {
      parent: { select: { id: true, name: true } },
      _count: { select: { products: true } },
    },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
}

export async function getCategoryById(id: string) {
  return prisma.category.findUnique({ where: { id } });
}

// The single source of truth for "which categories may a customer see" —
// the public header's nav and the homepage's "Explorá por categoría" tiles
// both call this, never listCategories() directly. Requires the explicit
// showInStorefrontNav opt-in (never just isActive + has products) — see
// that field's schema comment for why: an active category with real
// products is not automatically fit for the customer-facing nav (test/QA/
// internal data satisfies that loose criteria all the time).
export async function listStorefrontNavCategories() {
  return prisma.category.findMany({
    where: { parentId: null, isActive: true, archivedAt: null, showInStorefrontNav: true },
    include: { _count: { select: { products: true } } },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
}

// Walks the ancestor chain of candidateParentId; true if categoryId appears
// in it (or candidateParentId === categoryId) — i.e. setting this parent
// would create a cycle. App-level check: Postgres has no declarative
// arbitrary-depth-cycle constraint (see schema.prisma comment on Category).
async function wouldCreateCycle(categoryId: string, candidateParentId: string): Promise<boolean> {
  let currentId: string | null = candidateParentId;
  const visited = new Set<string>();

  while (currentId) {
    if (currentId === categoryId) return true;
    if (visited.has(currentId)) return true; // pre-existing cycle, fail safe
    visited.add(currentId);

    const current: { parentId: string | null } | null = await prisma.category.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    currentId = current?.parentId ?? null;
  }

  return false;
}

export interface CreateCategoryInput {
  name: string;
  parentId?: string | null;
  description?: string | null;
  displayOrder?: number;
  // The size group products created under this category propose by
  // default — see modules/products/service.ts's createProduct.
  defaultSizeGroupId?: string | null;
  // Opt-in to the public nav/home tiles — defaults to false (schema
  // default), so a newly-created category never appears to customers
  // until an admin deliberately curates it in.
  showInStorefrontNav?: boolean;
}

export async function createCategory(input: CreateCategoryInput, actorId: string) {
  const slug = await ensureUniqueSlug(
    input.name,
    async (candidate) => (await prisma.category.count({ where: { slug: candidate } })) > 0,
  );

  const category = await prisma.category.create({
    data: {
      name: input.name,
      slug,
      parentId: input.parentId ?? null,
      description: input.description ?? null,
      displayOrder: input.displayOrder ?? 0,
      defaultSizeGroupId: input.defaultSizeGroupId ?? null,
      showInStorefrontNav: input.showInStorefrontNav ?? false,
    },
  });

  await recordAuditLog({
    userId: actorId,
    action: "category.created",
    entityType: "Category",
    entityId: category.id,
    newValue: { name: category.name, slug: category.slug, parentId: category.parentId },
  });

  return category;
}

export interface UpdateCategoryInput {
  name?: string;
  parentId?: string | null;
  description?: string | null;
  displayOrder?: number;
  isActive?: boolean;
  defaultSizeGroupId?: string | null;
  showInStorefrontNav?: boolean;
}

export async function updateCategory(id: string, input: UpdateCategoryInput, actorId: string) {
  const before = await prisma.category.findUniqueOrThrow({ where: { id } });

  if (input.parentId) {
    if (input.parentId === id || (await wouldCreateCycle(id, input.parentId))) {
      throw new CategoryCycleError();
    }
  }

  const category = await prisma.category.update({ where: { id }, data: input });

  await recordAuditLog({
    userId: actorId,
    action: "category.updated",
    entityType: "Category",
    entityId: id,
    previousValue: { name: before.name, parentId: before.parentId, isActive: before.isActive },
    newValue: { name: category.name, parentId: category.parentId, isActive: category.isActive },
  });

  return category;
}

// Never a hard delete — a category referenced by a product is protected at
// the DB level too (Product.category has onDelete: Restrict). Archiving
// keeps the row selectable for existing products while excluding it from
// new-assignment pickers (that filter lives in the categories query used by
// the product form, not here).
export async function archiveCategory(id: string, actorId: string) {
  const category = await prisma.category.update({
    where: { id },
    data: { isActive: false, archivedAt: new Date() },
  });

  await recordAuditLog({
    userId: actorId,
    action: "category.archived",
    entityType: "Category",
    entityId: id,
  });

  return category;
}
