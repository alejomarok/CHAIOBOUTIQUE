import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { minorUnitsToDisplay } from "@/lib/money";
import { requirePermission } from "@/modules/auth";
import { getSystemDefaultCustomer, listCustomers } from "@/modules/customers/customer";
import { getCustomerDisplayName } from "@/modules/customers/normalize";
import { getArcaDataReadiness } from "@/modules/fiscal-documents/arca";
import { FISCAL_TAX_CATEGORY_LABELS_ES } from "@/modules/fiscal-documents/arca/fiscal-tax-category-core";
import { getSaleInvoicingSummary, listFiscalDocumentsForSale } from "@/modules/fiscal-documents/fiscal-document";
import {
  FISCAL_DOCUMENT_STATUS_BADGE_VARIANT,
  FISCAL_DOCUMENT_STATUS_LABELS_ES,
  formatFiscalDocumentIdentifier,
  INVOICE_MODE_LABELS_ES,
  SALE_INVOICING_STATUS_BADGE_VARIANT,
  SALE_INVOICING_STATUS_LABELS_ES,
} from "@/modules/fiscal-documents/labels";
import {
  PAYMENT_METHOD_LABELS_ES,
  PAYMENT_STATUS_BADGE_VARIANT,
  PAYMENT_STATUS_LABELS_ES,
} from "@/modules/sales/payment-labels";
import { deriveSaleOrigin, type SaleOrigin } from "@/modules/sales/report";
import { getSaleById } from "@/modules/sales/sale";
import { getSalePaymentSummary } from "@/modules/sales/totals";
import { getStoreConfiguration } from "@/modules/store-settings/service";
import { listWarehouses } from "@/modules/warehouses/service";
import type { SaleStatus } from "@/generated/prisma/client";

import { SaleForm } from "../sale-form";
import { CancelSaleButton } from "./cancel-sale-button";
import { IssueArcaInvoiceDialog } from "./issue-arca-invoice-dialog";
import { RegisterInvoiceDialog } from "./register-invoice-dialog";
import { RegisterPaymentDialog } from "./register-payment-dialog";
import { VoidFiscalDocumentButton } from "./void-fiscal-document-button";
import { VoidPaymentButton } from "./void-payment-button";

export const metadata = { title: "Detalle de venta" };

const STATUS_LABELS_ES: Record<SaleStatus, string> = {
  DRAFT: "Borrador",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
};

const STATUS_BADGE_VARIANT: Record<SaleStatus, "default" | "outline" | "secondary"> = {
  DRAFT: "outline",
  CONFIRMED: "default",
  CANCELLED: "secondary",
};

// Phase — Sales Consultation & Commercial Reporting.
const ORIGIN_LABELS_ES: Record<SaleOrigin, string> = { POS: "Venta en local", ONLINE: "Venta online" };

// Same "$ 1.500,50" -> "1.500,50" strip used by sale-form.tsx and the
// existing product edit page — no separate "minor units to bare editable
// string" export exists in lib/money.ts.
function toEditableAmount(amount: bigint): string {
  return minorUnitsToDisplay(amount).replace(/[^\d,.-]/g, "");
}

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const canManage = user.permissions.has("sales.create");
  const canCancel = user.permissions.has("sales.cancel");
  const canSelectWarehouse = user.permissions.has("warehouses.view");
  const canViewMovements = user.permissions.has("stock.view_movements");
  const canRecordPayment = user.permissions.has("sales.record_payment");
  const canVoidPayment = user.permissions.has("sales.void_payment");
  const canViewInvoicing = user.permissions.has("invoices.view");
  const canIssueInvoice = user.permissions.has("invoices.issue");
  const canVoidInvoice = user.permissions.has("invoices.cancel");
  const { id } = await params;

  const sale = await getSaleById(id);
  if (!sale) notFound();

  // A draft is edited in-place with the exact same form used to create a
  // sale — the whole point of a DRAFT status is that it's still a working
  // document, not a read-only record yet.
  if (sale.status === "DRAFT" && canManage) {
    const [{ customers }, consumidorFinal, allWarehouses] = await Promise.all([
      listCustomers({ status: "active", take: 200 }),
      getSystemDefaultCustomer(),
      canSelectWarehouse ? listWarehouses() : Promise.resolve([]),
    ]);
    const activeWarehouses = allWarehouses.filter((w) => w.isActive);

    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold">{sale.code}</h1>
            <Badge variant={STATUS_BADGE_VARIANT[sale.status]}>{STATUS_LABELS_ES[sale.status]}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Esta venta todavía es un borrador — podés seguir editándola.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <SaleForm
              saleId={sale.id}
              customers={customers.map((c) => ({
                id: c.id,
                displayName: getCustomerDisplayName(c),
                isSystemDefault: c.isSystemDefault,
              }))}
              defaultCustomerId={consumidorFinal?.id ?? sale.customerId}
              canApplyDiscount={user.permissions.has("sales.apply_discount")}
              warehouses={activeWarehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
              defaultWarehouseId={sale.warehouseId}
              canSelectWarehouse={canSelectWarehouse}
              defaultValues={{
                customerId: sale.customerId,
                warehouseId: sale.warehouseId,
                notes: sale.notes ?? "",
                items: sale.items.map((item) => ({
                  productVariantId: item.productVariantId,
                  displayName: item.productNameSnapshot,
                  sku: item.skuSnapshot,
                  quantity: String(item.quantity),
                  unitPriceAmount: toEditableAmount(item.unitPriceAmount),
                  discountAmount: item.discountAmount > 0n ? toEditableAmount(item.discountAmount) : "",
                })),
              }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Only CONFIRMED/CANCELLED sales reach here — a DRAFT sale can never have
  // a fiscal document (see fiscal-document-core.ts's assertSaleInvoiceable).
  const [invoicingSummary, fiscalDocumentHistory, storeConfig, arcaDataReadiness] = canViewInvoicing
    ? await Promise.all([
        getSaleInvoicingSummary(sale.id),
        listFiscalDocumentsForSale(sale.id),
        getStoreConfiguration(),
        getArcaDataReadiness(),
      ])
    : [null, [], null, null];

  // CONFIRMED or CANCELLED (or DRAFT without manage permission): read-only.
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold">{sale.code}</h1>
            <Badge variant={STATUS_BADGE_VARIANT[sale.status]}>{STATUS_LABELS_ES[sale.status]}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {new Date(sale.saleDate).toLocaleString("es-AR")}
          </p>
          <p className="mt-1 text-sm">
            <span className="font-medium">Origen:</span> {ORIGIN_LABELS_ES[deriveSaleOrigin(sale)]}
            {sale.order && (
              <>
                {" · "}
                <Link href={`/admin/orders/${sale.order.id}`} className="underline">
                  Pedido de origen {sale.order.code}
                </Link>
              </>
            )}
          </p>
          <p className="text-sm">
            <span className="font-medium">Vendedor:</span> {sale.createdBy.name}
          </p>
          <p className="mt-1 text-sm font-medium">Depósito: {sale.warehouse.name}</p>
          {sale.status === "CONFIRMED" && <p className="text-sm">Stock descontado: Sí</p>}
          {(sale.status === "CONFIRMED" || sale.status === "CANCELLED") && canViewMovements && (
            <p className="text-sm">
              <Link
                href={`/admin/inventory/movements?relatedEntityType=Sale&relatedEntityId=${sale.id}`}
                className="underline"
              >
                Ver movimientos de stock
              </Link>
            </p>
          )}
        </div>
        {canCancel && sale.status !== "CANCELLED" && <CancelSaleButton saleId={sale.id} />}
      </div>

      {sale.order?.requiresPaymentReview && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6 text-sm">
            <p className="font-medium">⚠ Este pedido requiere revisión de pago.</p>
            {sale.order.paymentReviewReason && <p className="text-muted-foreground mt-1">{sale.order.paymentReviewReason}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Cliente</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground text-xs">Nombre (al momento de la venta)</p>
              <p>
                {sale.customerNameSnapshot}
                {sale.customer.isSystemDefault && (
                  <Badge variant="outline" className="ml-2">
                    Consumidor Final
                  </Badge>
                )}
              </p>
            </div>
            {sale.customerDocumentSnapshot && (
              <div>
                <p className="text-muted-foreground text-xs">Documento (al momento de la venta)</p>
                <p>{sale.customerDocumentSnapshot}</p>
              </div>
            )}
          </div>
          {(sale.customer.email || sale.customer.phone) && (
            <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
              {sale.customer.email && (
                <div>
                  <p className="text-muted-foreground text-xs">Email (actual del cliente)</p>
                  <p>{sale.customer.email}</p>
                </div>
              )}
              {sale.customer.phone && (
                <div>
                  <p className="text-muted-foreground text-xs">Teléfono (actual del cliente)</p>
                  <p>{sale.customer.phone}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Productos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead>Talle</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Precio unitario</TableHead>
                  <TableHead>Descuento</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sale.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.productNameSnapshot}</TableCell>
                    <TableCell className="font-mono text-xs">{item.skuSnapshot}</TableCell>
                    <TableCell>{item.productVariant.color?.displayName ?? "—"}</TableCell>
                    <TableCell>{item.productVariant.sizeOption?.label ?? "—"}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>{minorUnitsToDisplay(item.unitPriceAmount)}</TableCell>
                    <TableCell>{minorUnitsToDisplay(item.discountAmount)}</TableCell>
                    <TableCell>{minorUnitsToDisplay(item.totalAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {sale.items.some((item) => item.taxCategory) && (
            <details className="text-muted-foreground text-xs">
              <summary className="cursor-pointer select-none">Detalle fiscal por producto</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {sale.items.map((item) => (
                  <li key={item.id}>
                    {item.skuSnapshot}:{" "}
                    {item.taxCategory
                      ? FISCAL_TAX_CATEGORY_LABELS_ES[item.taxCategory]
                      : "Sin categoría fiscal configurada"}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Totales</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{minorUnitsToDisplay(sale.subtotalAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Descuentos</span>
            <span>-{minorUnitsToDisplay(sale.discountTotalAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Impuestos</span>
            <span>{minorUnitsToDisplay(sale.taxTotalAmount)}</span>
          </div>
          <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
            <span>Total</span>
            <span>{minorUnitsToDisplay(sale.totalAmount)}</span>
          </div>
        </CardContent>
      </Card>

      {sale.status !== "DRAFT" && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <CardTitle>Pagos</CardTitle>
            {sale.status === "CONFIRMED" && canRecordPayment && (
              <RegisterPaymentDialog
                saleId={sale.id}
                remainingAmount={getSalePaymentSummary(sale).remainingAmount}
              />
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {(() => {
              const summary = getSalePaymentSummary(sale);
              return (
                <div className="flex flex-col gap-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total de la venta</span>
                    <span>{minorUnitsToDisplay(summary.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pagado</span>
                    <span>{minorUnitsToDisplay(summary.paidAmount)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1 font-medium">
                    <span>Saldo pendiente</span>
                    <span>{minorUnitsToDisplay(summary.remainingAmount)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-muted-foreground">Estado del pago</span>
                    <Badge variant={PAYMENT_STATUS_BADGE_VARIANT[summary.paymentStatus]}>
                      {PAYMENT_STATUS_LABELS_ES[summary.paymentStatus]}
                    </Badge>
                  </div>
                </div>
              );
            })()}

            {sale.payments.length === 0 ? (
              <p className="text-muted-foreground text-sm">Todavía no se registraron pagos.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sale.payments.map((payment) => (
                  <div
                    key={payment.id}
                    className={`border-border flex flex-col gap-1 rounded-lg border p-3 text-sm ${
                      payment.status === "VOIDED" ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{PAYMENT_METHOD_LABELS_ES[payment.method]}</span>
                        <span>{minorUnitsToDisplay(payment.amount)}</span>
                        {payment.status === "VOIDED" && <Badge variant="outline">Anulado</Badge>}
                      </div>
                      {payment.status === "ACTIVE" && canVoidPayment && (
                        <VoidPaymentButton paymentId={payment.id} />
                      )}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {new Date(payment.paidAt).toLocaleString("es-AR")}
                      {payment.reference &&
                        (payment.method === "MERCADO_PAGO"
                          ? ` · ID de pago Mercado Pago: ${payment.reference}`
                          : ` · Ref: ${payment.reference}`)}
                      {payment.createdBy && ` · Registrado por ${payment.createdBy.name}`}
                    </p>
                    {payment.notes && <p className="text-xs">{payment.notes}</p>}
                    {payment.status === "VOIDED" && (
                      <p className="text-muted-foreground text-xs">
                        Anulado {payment.voidedAt && new Date(payment.voidedAt).toLocaleString("es-AR")}
                        {payment.voidedBy && ` por ${payment.voidedBy.name}`}
                        {payment.voidReason && ` · Motivo: ${payment.voidReason}`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canViewInvoicing && invoicingSummary && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <CardTitle className="flex items-center gap-2">
              Facturación
              {invoicingSummary.activeDocument?.arcaEnvironment === "HOMOLOGATION" && (
                <Badge variant="destructive">HOMOLOGACIÓN</Badge>
              )}
            </CardTitle>
            {invoicingSummary.status === "NOT_INVOICED" && sale.status === "CONFIRMED" && canIssueInvoice && (
              <RegisterInvoiceDialog
                saleId={sale.id}
                saleTotalAmountDisplay={toEditableAmount(sale.totalAmount)}
                defaultPointOfSale={storeConfig?.fiscalDefaultPointOfSale}
                arcaDataReady={arcaDataReadiness?.ready ?? false}
              />
            )}
            {invoicingSummary.activeDocument?.mode === "ELECTRONICA_ARCA" && canIssueInvoice && (
              // Rendered unconditionally on STATUS (not just when PENDING/
              // ERROR) — the Server Action inside this dialog revalidates
              // this very page on success, which recomputes activeDocument.
              // status to ISSUED. If this component were only mounted for
              // PENDING/ERROR, that revalidation would unmount it mid-
              // interaction (destroying its own "show the CAE result"
              // state) the instant issuance succeeds. The component itself
              // decides whether to offer the trigger, based on the status
              // prop AND its own local result state — see its own comment.
              <IssueArcaInvoiceDialog
                saleId={sale.id}
                fiscalDocumentId={invoicingSummary.activeDocument.id}
                currentStatus={invoicingSummary.activeDocument.status}
              />
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-muted-foreground text-xs">Estado</p>
                <Badge variant={SALE_INVOICING_STATUS_BADGE_VARIANT[invoicingSummary.status]}>
                  {invoicingSummary.status === "PENDING" && invoicingSummary.activeDocument?.mode === "ELECTRONICA_ARCA"
                    ? "Pendiente de emisión ARCA"
                    : SALE_INVOICING_STATUS_LABELS_ES[invoicingSummary.status]}
                </Badge>
              </div>
              {invoicingSummary.activeDocument && (
                <>
                  <div>
                    <p className="text-muted-foreground text-xs">Modalidad</p>
                    <p>{INVOICE_MODE_LABELS_ES[invoicingSummary.activeDocument.mode]}</p>
                  </div>
                  {invoicingSummary.activeDocument.documentType && (
                    <div>
                      <p className="text-muted-foreground text-xs">Tipo de comprobante</p>
                      <p>{invoicingSummary.activeDocument.documentType}</p>
                    </div>
                  )}
                  {invoicingSummary.activeDocument.pointOfSale && (
                    <div>
                      <p className="text-muted-foreground text-xs">Punto de venta</p>
                      <p>{invoicingSummary.activeDocument.pointOfSale}</p>
                    </div>
                  )}
                  {invoicingSummary.activeDocument.documentNumber && (
                    <div>
                      <p className="text-muted-foreground text-xs">Número</p>
                      <p>{invoicingSummary.activeDocument.documentNumber}</p>
                    </div>
                  )}
                  {invoicingSummary.activeDocument.issueDate && (
                    <div>
                      <p className="text-muted-foreground text-xs">Fecha</p>
                      <p>{new Date(invoicingSummary.activeDocument.issueDate).toLocaleDateString("es-AR")}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-muted-foreground text-xs">Total</p>
                    <p>
                      {minorUnitsToDisplay(invoicingSummary.activeDocument.totalAmount, {
                        currency: invoicingSummary.activeDocument.currency,
                      })}
                    </p>
                  </div>
                  {invoicingSummary.activeDocument.cae && (
                    <>
                      <div>
                        <p className="text-muted-foreground text-xs">CAE</p>
                        <p className="font-mono">{invoicingSummary.activeDocument.cae}</p>
                      </div>
                      {invoicingSummary.activeDocument.caeExpiresAt && (
                        <div>
                          <p className="text-muted-foreground text-xs">Vencimiento CAE</p>
                          <p>{new Date(invoicingSummary.activeDocument.caeExpiresAt).toLocaleDateString("es-AR")}</p>
                        </div>
                      )}
                    </>
                  )}
                  {invoicingSummary.activeDocument.sourceSystem && (
                    <div>
                      <p className="text-muted-foreground text-xs">Sistema de origen</p>
                      <p>{invoicingSummary.activeDocument.sourceSystem}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {invoicingSummary.activeDocument?.notes && (
              <p className="text-muted-foreground text-sm">{invoicingSummary.activeDocument.notes}</p>
            )}

            {invoicingSummary.activeDocument && canVoidInvoice && (
              <div>
                <VoidFiscalDocumentButton fiscalDocumentId={invoicingSummary.activeDocument.id} />
              </div>
            )}

            {fiscalDocumentHistory.filter((doc) => doc.status === "VOIDED").length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-xs">Historial</p>
                {fiscalDocumentHistory
                  .filter((doc) => doc.status === "VOIDED")
                  .map((doc) => (
                    <div key={doc.id} className="border-border rounded-lg border p-3 text-sm opacity-70">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={FISCAL_DOCUMENT_STATUS_BADGE_VARIANT[doc.status]}>
                          {FISCAL_DOCUMENT_STATUS_LABELS_ES[doc.status]}
                        </Badge>
                        <span>{INVOICE_MODE_LABELS_ES[doc.mode]}</span>
                        {formatFiscalDocumentIdentifier(doc) && <span>{formatFiscalDocumentIdentifier(doc)}</span>}
                      </div>
                      <p className="text-muted-foreground mt-1 text-xs">
                        Anulado {doc.voidedAt && new Date(doc.voidedAt).toLocaleString("es-AR")}
                        {doc.voidedBy && ` por ${doc.voidedBy.name}`}
                        {doc.voidReason && ` · Motivo: ${doc.voidReason}`}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sale.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{sale.notes}</p>
          </CardContent>
        </Card>
      )}

      {sale.status === "CANCELLED" && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle>Cancelación</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>Cancelada {sale.cancelledAt && new Date(sale.cancelledAt).toLocaleString("es-AR")}</p>
            {sale.cancelledBy && <p>Por {sale.cancelledBy.name}</p>}
            {sale.cancelReason && <p>Motivo: {sale.cancelReason}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
