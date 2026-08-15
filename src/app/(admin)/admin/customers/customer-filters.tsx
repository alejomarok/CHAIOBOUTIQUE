import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CustomerFiltersProps {
  defaultValues: { q?: string; type?: string; status?: string };
}

// Plain GET form — same no-client-JS pattern as components/catalog/
// catalog-filters.tsx. Submitting navigates to
// /admin/customers?q=...&type=...&status=..., which the page reads
// server-side.
export function CustomerFilters({ defaultValues }: CustomerFiltersProps) {
  return (
    <form method="GET" className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="q">Buscar</Label>
        <Input
          id="q"
          name="q"
          defaultValue={defaultValues.q}
          placeholder="Nombre, documento, CUIT, email o teléfono"
          className="w-72"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="type">Tipo</Label>
        <select
          id="type"
          name="type"
          defaultValue={defaultValues.type ?? ""}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="">Todos</option>
          <option value="PERSON">Persona</option>
          <option value="COMPANY">Empresa</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="status">Estado</Label>
        <select
          id="status"
          name="status"
          defaultValue={defaultValues.status ?? ""}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="">Todos</option>
          <option value="active">Activos</option>
          <option value="inactive">Inactivos</option>
        </select>
      </div>
      <Button type="submit" size="sm" variant="outline">
        Buscar
      </Button>
    </form>
  );
}
