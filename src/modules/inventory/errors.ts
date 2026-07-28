export class InventoryError extends Error {}

export class InvalidQuantityError extends InventoryError {
  constructor(delta: number) {
    super(`Cantidad inválida: ${delta}.`);
    this.name = "InvalidQuantityError";
  }
}

export class InactiveVariantError extends InventoryError {
  constructor(public readonly variantId: string) {
    super("La variante no está activa.");
    this.name = "InactiveVariantError";
  }
}

export class InactiveWarehouseError extends InventoryError {
  constructor(public readonly warehouseId: string) {
    super("El depósito no está activo.");
    this.name = "InactiveWarehouseError";
  }
}

export class InsufficientStockError extends InventoryError {
  constructor(
    public readonly variantId: string,
    public readonly warehouseId: string,
    public readonly delta: number,
  ) {
    super("Stock insuficiente para realizar el movimiento.");
    this.name = "InsufficientStockError";
  }
}

// Thrown when InventoryOperation.idempotencyKey collides with an existing
// operation — see modules/inventory/idempotency.ts for how keys are
// generated per source (manual adjustment, transfer, import row).
export class DuplicateOperationError extends InventoryError {
  constructor(public readonly idempotencyKey: string) {
    super("Esta operación ya fue aplicada anteriormente.");
    this.name = "DuplicateOperationError";
  }
}

export class SameWarehouseTransferError extends InventoryError {
  constructor() {
    super("El depósito de origen y destino no pueden ser el mismo.");
    this.name = "SameWarehouseTransferError";
  }
}

// Defense-in-depth only — primary enforcement is requirePermission() at the
// route/Server Action layer. This exists for service calls made outside an
// HTTP/action context (e.g. a future import job or webhook handler).
export class InsufficientPermissionError extends InventoryError {
  constructor() {
    super("Permiso insuficiente.");
    this.name = "InsufficientPermissionError";
  }
}
