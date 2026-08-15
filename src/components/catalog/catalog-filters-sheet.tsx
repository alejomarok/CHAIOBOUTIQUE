"use client";

import { SlidersHorizontal } from "lucide-react";

import { CatalogFilters } from "@/components/catalog/catalog-filters";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface CatalogFiltersSheetProps {
  categories: { id: string; name: string }[];
  defaultValues: { q?: string; category?: string; sort?: string };
}

// Mobile-only entry point for the same CatalogFilters form used in the
// desktop sidebar — a plain GET submit navigates the whole page, which
// closes this sheet naturally without any extra client state.
export function CatalogFiltersSheet({ categories, defaultValues }: CatalogFiltersSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="md:hidden">
          <SlidersHorizontal className="size-4" />
          Filtros
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Filtros</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          <CatalogFilters categories={categories} defaultValues={defaultValues} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
