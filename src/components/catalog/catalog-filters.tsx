import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CatalogFiltersProps {
  categories: { id: string; name: string }[];
  defaultValues: { q?: string; category?: string; sort?: string };
}

const hasActiveFilters = (defaultValues: CatalogFiltersProps["defaultValues"]) =>
  Boolean(defaultValues.q || defaultValues.category);

// Plain GET form — no client JS needed. Submitting navigates to
// /catalog?q=...&category=...&sort=..., which the page reads server-side.
// Reused as-is inside the mobile filter sheet (catalog-filters-sheet.tsx) —
// a full-page navigation on submit closes that sheet naturally.
export function CatalogFilters({ categories, defaultValues }: CatalogFiltersProps) {
  return (
    <form method="GET" action="/catalog" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="q">Buscar</Label>
        <Input id="q" name="q" defaultValue={defaultValues.q} placeholder="Nombre del producto" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category">Categoría</Label>
        <select
          id="category"
          name="category"
          defaultValue={defaultValues.category ?? ""}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-lg border px-3 text-sm outline-none focus-visible:ring-3"
        >
          <option value="">Todas</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sort">Ordenar por</Label>
        <select
          id="sort"
          name="sort"
          defaultValue={defaultValues.sort ?? "newest"}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-lg border px-3 text-sm outline-none focus-visible:ring-3"
        >
          <option value="newest">Más nuevos</option>
          <option value="price_asc">Precio: menor a mayor</option>
          <option value="price_desc">Precio: mayor a menor</option>
        </select>
      </div>

      <Button type="submit" size="sm">
        Aplicar filtros
      </Button>
      {hasActiveFilters(defaultValues) && (
        <Button asChild type="button" variant="ghost" size="sm">
          <Link href="/catalog">Limpiar filtros</Link>
        </Button>
      )}
    </form>
  );
}
