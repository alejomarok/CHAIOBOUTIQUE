export function PublicFooter() {
  return (
    <footer className="border-border bg-muted/40 border-t">
      <div className="text-muted-foreground mx-auto max-w-6xl px-4 py-8 text-sm sm:px-6">
        <p>&copy; {new Date().getFullYear()} CHAIOBOUTIQUE. Todos los derechos reservados.</p>
      </div>
    </footer>
  );
}
