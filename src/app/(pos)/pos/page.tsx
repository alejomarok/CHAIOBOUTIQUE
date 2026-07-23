export const metadata = { title: "Punto de venta" };

export default function PosPlaceholderPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="font-heading text-2xl font-semibold">Punto de venta</h1>
      <p className="text-muted-foreground max-w-md">
        El punto de venta se implementa en una próxima etapa. Esta pantalla confirma que la ruta, el
        layout y los permisos ya están funcionando.
      </p>
    </div>
  );
}
