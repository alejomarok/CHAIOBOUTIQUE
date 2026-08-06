// Thrown by cart mutations to reject an invalid request outright — distinct
// from CartItemIssue (modules/cart/service.ts), which represents a problem
// with an item ALREADY in the cart that the customer must see and resolve,
// never silently dropped. These errors are the "don't even accept this
// mutation" half of validation; CartItemIssue is the "this got added
// validly but has since gone stale" half.

export class InvalidQuantityError extends Error {
  constructor(quantity: number) {
    super(`La cantidad debe ser un número entero positivo (se recibió ${quantity}).`);
    this.name = "InvalidQuantityError";
  }
}

export class QuantityLimitExceededError extends Error {
  constructor(
    public readonly requested: number,
    public readonly limit: number,
  ) {
    super(`No se pueden agregar más de ${limit} unidades por artículo.`);
    this.name = "QuantityLimitExceededError";
  }
}

export class VariantNotFoundError extends Error {
  constructor(variantId: string) {
    super(`La variante "${variantId}" no existe.`);
    this.name = "VariantNotFoundError";
  }
}

export class VariantProductMismatchError extends Error {
  constructor() {
    super("La variante indicada no pertenece al producto indicado.");
    this.name = "VariantProductMismatchError";
  }
}

export class VariantInactiveError extends Error {
  constructor(variantId: string) {
    super(`La variante "${variantId}" ya no está activa.`);
    this.name = "VariantInactiveError";
  }
}

export class ProductNotPurchasableError extends Error {
  constructor(productId: string) {
    super(`El producto "${productId}" no está disponible para la venta.`);
    this.name = "ProductNotPurchasableError";
  }
}

export class InsufficientStockError extends Error {
  constructor(
    public readonly variantId: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(`Stock insuficiente: se pidieron ${requested}, hay ${available} disponibles.`);
    this.name = "InsufficientStockError";
  }
}

export class CartItemNotFoundError extends Error {
  constructor() {
    super("El artículo no existe en tu carrito.");
    this.name = "CartItemNotFoundError";
  }
}
