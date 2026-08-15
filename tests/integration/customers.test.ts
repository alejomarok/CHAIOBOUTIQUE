// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import {
  activateCustomer,
  addCustomerAddress,
  createCustomer,
  CustomerAlreadyLinkedError,
  deactivateCustomer,
  deleteCustomerAddress,
  DuplicateCustomerDocumentError,
  DuplicateCustomerTaxIdError,
  findLinkableUserByEmail,
  findPossibleDuplicateCustomers,
  getCustomerById,
  linkCustomerToUser,
  listCustomers,
  setDefaultBillingAddress,
  setDefaultShippingAddress,
  SystemCustomerProtectedError,
  unlinkCustomerFromUser,
  updateCustomer,
  updateCustomerAddress,
  UserAlreadyLinkedError,
} from "@/modules/customers/customer";
import { seedConsumidorFinal } from "@/modules/customers/seed-core";

describe("customers — commercial entity (real DB)", () => {
  const createdUserIds: string[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  async function makeActor() {
    const actor = await createTestUser({
      name: "Customers Actor",
      email: `customers-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  it("creates a PERSON customer with no linked User at all", async () => {
    const actor = await makeActor();

    const result = await createCustomer(
      { type: "PERSON", firstName: "Juan", lastName: "Pérez", email: `juan-${Date.now()}@test.local` },
      actor.id,
    );
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: result.customer.id } }));

    expect(result.customer.linkedUserId).toBeNull();
    expect(result.customer.type).toBe("PERSON");
    expect(result.customer.code).toMatch(/^CLI-/);
  });

  it("creates a COMPANY customer with businessName, never firstName/lastName", async () => {
    const actor = await makeActor();

    const result = await createCustomer(
      { type: "COMPANY", businessName: "Acme SRL", taxId: String(Date.now()).slice(-11) },
      actor.id,
    );
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: result.customer.id } }));

    expect(result.customer.businessName).toBe("Acme SRL");
    expect(result.customer.firstName).toBeNull();
    expect(result.customer.lastName).toBeNull();
  });

  it("normalizes document numbers before comparison — '30.123.456' collides with '30123456'", async () => {
    const actor = await makeActor();
    const documentNumber = String(Date.now()).slice(-8);

    const first = await createCustomer(
      { type: "PERSON", firstName: "A", documentType: "DNI", documentNumber },
      actor.id,
    );
    expect(first.status).toBe("created");
    if (first.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: first.customer.id } }));

    const formatted = `${documentNumber.slice(0, 2)}.${documentNumber.slice(2, 5)}.${documentNumber.slice(5)}`;
    await expect(
      createCustomer(
        { type: "PERSON", firstName: "B", documentType: "DNI", documentNumber: formatted },
        actor.id,
        { confirmed: true },
      ),
    ).rejects.toThrow(DuplicateCustomerDocumentError);
  });

  it("an exact CUIT match is blocked outright, not just warned about", async () => {
    const actor = await makeActor();
    const taxId = String(Date.now()).slice(-11);

    const first = await createCustomer({ type: "COMPANY", businessName: "First SRL", taxId }, actor.id);
    expect(first.status).toBe("created");
    if (first.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: first.customer.id } }));

    await expect(
      createCustomer(
        { type: "COMPANY", businessName: "Second SRL", taxId },
        actor.id,
        { confirmed: true },
      ),
    ).rejects.toThrow(DuplicateCustomerTaxIdError);
  });

  it("a different document TYPE with the same number never collides (DNI 12345678 != PASSPORT 12345678)", async () => {
    const actor = await makeActor();
    const number = String(Date.now()).slice(-8);

    const dni = await createCustomer(
      { type: "PERSON", firstName: "A", documentType: "DNI", documentNumber: number },
      actor.id,
    );
    expect(dni.status).toBe("created");
    if (dni.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: dni.customer.id } }));

    const passport = await createCustomer(
      { type: "PERSON", firstName: "B", documentType: "PASSPORT", documentNumber: number },
      actor.id,
    );
    expect(passport.status).toBe("created");
    if (passport.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: passport.customer.id } }));
  });

  it("a matching email produces a soft possible-duplicate warning instead of creating anything", async () => {
    const actor = await makeActor();
    const email = `dup-${Date.now()}@test.local`;

    const first = await createCustomer({ type: "PERSON", firstName: "Original", email }, actor.id);
    expect(first.status).toBe("created");
    if (first.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: first.customer.id } }));

    const second = await createCustomer({ type: "PERSON", firstName: "Segundo", email }, actor.id);
    expect(second.status).toBe("possible_duplicates");
    if (second.status !== "possible_duplicates") throw new Error("unreachable");
    expect(second.matches).toHaveLength(1);
    expect(second.matches[0].matchedOn).toContain("email");

    const countAfter = await prisma.customer.count({ where: { email } });
    expect(countAfter).toBe(1); // never silently created a second row
  });

  it("'Continuar de todos modos' (confirmed: true) creates the record despite a soft email match", async () => {
    const actor = await makeActor();
    const email = `confirm-dup-${Date.now()}@test.local`;

    const first = await createCustomer({ type: "PERSON", firstName: "Original", email }, actor.id);
    if (first.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: first.customer.id } }));

    const second = await createCustomer(
      { type: "PERSON", firstName: "Segundo", email },
      actor.id,
      { confirmed: true },
    );
    expect(second.status).toBe("created");
    if (second.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: second.customer.id } }));

    const countAfter = await prisma.customer.count({ where: { email } });
    expect(countAfter).toBe(2);
  });

  it("findPossibleDuplicateCustomers excludes the customer being edited from its own results", async () => {
    const actor = await makeActor();
    const email = `self-exclude-${Date.now()}@test.local`;

    const created = await createCustomer({ type: "PERSON", firstName: "Self", email }, actor.id);
    if (created.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: created.customer.id } }));

    const matches = await findPossibleDuplicateCustomers({
      email,
      excludeCustomerId: created.customer.id,
    });
    expect(matches).toHaveLength(0);
  });

  it("updateCustomer records an audit entry with before/after values", async () => {
    const actor = await makeActor();
    const created = await createCustomer({ type: "PERSON", firstName: "Antes" }, actor.id);
    if (created.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: created.customer.id } }));

    const updated = await updateCustomer(
      created.customer.id,
      { firstName: "Después" },
      actor.id,
    );
    expect(updated.status).toBe("updated");
    if (updated.status !== "updated") throw new Error("unreachable");
    expect(updated.customer.firstName).toBe("Después");

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: "customer.updated", entityId: created.customer.id },
    });
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.userId).toBe(actor.id);
  });

  it("deactivate/activate toggles isActive and is fully reversible", async () => {
    const actor = await makeActor();
    const created = await createCustomer({ type: "PERSON", firstName: "Reversible" }, actor.id);
    if (created.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: created.customer.id } }));

    const deactivated = await deactivateCustomer(created.customer.id, actor.id);
    expect(deactivated.isActive).toBe(false);

    const reactivated = await activateCustomer(created.customer.id, actor.id);
    expect(reactivated.isActive).toBe(true);
  });

  it("links a Customer to a User, then unlinks it — both explicit, admin-driven actions", async () => {
    const actor = await makeActor();
    const accountToLink = await createTestUser({
      name: "Linkable Account",
      email: `linkable-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(accountToLink.id);

    const created = await createCustomer({ type: "PERSON", firstName: "SinCuenta" }, actor.id);
    if (created.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: created.customer.id } }));

    expect(created.customer.linkedUserId).toBeNull();

    const linked = await linkCustomerToUser(created.customer.id, accountToLink.id, actor.id);
    expect(linked.linkedUserId).toBe(accountToLink.id);

    const unlinked = await unlinkCustomerFromUser(created.customer.id, actor.id);
    expect(unlinked.linkedUserId).toBeNull();
  });

  it("refuses to link a User that's already linked to a different Customer", async () => {
    const actor = await makeActor();
    const account = await createTestUser({
      name: "Already Linked",
      email: `already-linked-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(account.id);

    const first = await createCustomer({ type: "PERSON", firstName: "Primero" }, actor.id);
    if (first.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: first.customer.id } }));
    await linkCustomerToUser(first.customer.id, account.id, actor.id);

    const second = await createCustomer({ type: "PERSON", firstName: "Segundo" }, actor.id);
    if (second.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: second.customer.id } }));

    await expect(linkCustomerToUser(second.customer.id, account.id, actor.id)).rejects.toThrow(
      UserAlreadyLinkedError,
    );
  });

  it("refuses to re-link a Customer that already has a linkedUser without an explicit unlink first", async () => {
    const actor = await makeActor();
    const accountA = await createTestUser({
      name: "Account A",
      email: `account-a-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(accountA.id);
    const accountB = await createTestUser({
      name: "Account B",
      email: `account-b-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(accountB.id);

    const created = await createCustomer({ type: "PERSON", firstName: "YaVinculado" }, actor.id);
    if (created.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: created.customer.id } }));
    await linkCustomerToUser(created.customer.id, accountA.id, actor.id);

    await expect(
      linkCustomerToUser(created.customer.id, accountB.id, actor.id),
    ).rejects.toThrow(CustomerAlreadyLinkedError);
  });

  it("findLinkableUserByEmail finds an existing account and returns null for a nonexistent one", async () => {
    const account = await createTestUser({
      name: "Findable",
      email: `findable-${Date.now()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(account.id);

    const found = await findLinkableUserByEmail(account.email);
    expect(found?.id).toBe(account.id);

    const notFound = await findLinkableUserByEmail(`nonexistent-${Date.now()}@test.local`);
    expect(notFound).toBeNull();
  });

  it("search matches name, document number (any formatting), and email", async () => {
    const actor = await makeActor();
    const uniqueTag = `Findme${Date.now()}`;
    const documentNumber = String(Date.now()).slice(-8);

    const created = await createCustomer(
      {
        type: "PERSON",
        firstName: uniqueTag,
        lastName: "Buscable",
        documentType: "DNI",
        documentNumber,
        email: `${uniqueTag.toLowerCase()}@test.local`,
      },
      actor.id,
    );
    if (created.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: created.customer.id } }));

    const byName = await listCustomers({ search: uniqueTag });
    expect(byName.customers.some((c) => c.id === created.customer.id)).toBe(true);

    const formattedDoc = `${documentNumber.slice(0, 2)}.${documentNumber.slice(2, 5)}.${documentNumber.slice(5)}`;
    const byDocument = await listCustomers({ search: formattedDoc });
    expect(byDocument.customers.some((c) => c.id === created.customer.id)).toBe(true);

    const byEmail = await listCustomers({ search: uniqueTag.toLowerCase() });
    expect(byEmail.customers.some((c) => c.id === created.customer.id)).toBe(true);
  });

  it("the first address a customer gets becomes both default shipping and default billing", async () => {
    const actor = await makeActor();
    const created = await createCustomer({ type: "PERSON", firstName: "ConDireccion" }, actor.id);
    if (created.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: created.customer.id } }));

    const address = await addCustomerAddress(
      created.customer.id,
      { street: "Av. Siempre Viva", number: "742", city: "Springfield" },
      actor.id,
    );
    expect(address.isDefaultShipping).toBe(true);
    expect(address.isDefaultBilling).toBe(true);
  });

  it("a second address does not automatically become default; setDefaultShippingAddress swaps it explicitly", async () => {
    const actor = await makeActor();
    const created = await createCustomer({ type: "PERSON", firstName: "DosDirecciones" }, actor.id);
    if (created.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: created.customer.id } }));

    const first = await addCustomerAddress(
      created.customer.id,
      { street: "Calle Uno", city: "Ciudad" },
      actor.id,
    );
    const second = await addCustomerAddress(
      created.customer.id,
      { street: "Calle Dos", city: "Ciudad" },
      actor.id,
    );
    expect(second.isDefaultShipping).toBe(false);

    const updated = await setDefaultShippingAddress(second.id, actor.id);
    expect(updated.isDefaultShipping).toBe(true);

    const refreshedFirst = await prisma.customerAddress.findUniqueOrThrow({ where: { id: first.id } });
    expect(refreshedFirst.isDefaultShipping).toBe(false);

    const shippingDefaults = await prisma.customerAddress.count({
      where: { customerId: created.customer.id, isDefaultShipping: true },
    });
    expect(shippingDefaults).toBe(1); // never more than one, DB-enforced too
  });

  it("default shipping and default billing can point at different addresses independently", async () => {
    const actor = await makeActor();
    const created = await createCustomer({ type: "PERSON", firstName: "EnvioYFacturacion" }, actor.id);
    if (created.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: created.customer.id } }));

    const home = await addCustomerAddress(created.customer.id, { street: "Casa", city: "Ciudad" }, actor.id);
    const office = await addCustomerAddress(
      created.customer.id,
      { street: "Oficina", city: "Ciudad" },
      actor.id,
    );

    await setDefaultBillingAddress(office.id, actor.id);

    const refreshedHome = await prisma.customerAddress.findUniqueOrThrow({ where: { id: home.id } });
    const refreshedOffice = await prisma.customerAddress.findUniqueOrThrow({ where: { id: office.id } });
    expect(refreshedHome.isDefaultShipping).toBe(true);
    expect(refreshedHome.isDefaultBilling).toBe(false);
    expect(refreshedOffice.isDefaultBilling).toBe(true);
  });

  it("editing and deleting an address works, and deleting one never touches the customer", async () => {
    const actor = await makeActor();
    const created = await createCustomer({ type: "PERSON", firstName: "EditaDireccion" }, actor.id);
    if (created.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: created.customer.id } }));

    const address = await addCustomerAddress(
      created.customer.id,
      { street: "Original", city: "Ciudad" },
      actor.id,
    );
    const edited = await updateCustomerAddress(
      address.id,
      { street: "Editada", city: "Ciudad" },
      actor.id,
    );
    expect(edited.street).toBe("Editada");

    await deleteCustomerAddress(address.id, actor.id);
    const gone = await prisma.customerAddress.findUnique({ where: { id: address.id } });
    expect(gone).toBeNull();

    const customerStillExists = await prisma.customer.findUnique({ where: { id: created.customer.id } });
    expect(customerStillExists).not.toBeNull();
  });

  it("getCustomerById returns addresses, linkedUser, and createdBy in one call", async () => {
    const actor = await makeActor();
    const created = await createCustomer({ type: "PERSON", firstName: "Completo" }, actor.id);
    if (created.status !== "created") throw new Error("unreachable");
    cleanup.push(() => prisma.customer.delete({ where: { id: created.customer.id } }));
    await addCustomerAddress(created.customer.id, { street: "Calle", city: "Ciudad" }, actor.id);

    const full = await getCustomerById(created.customer.id);
    expect(full?.addresses).toHaveLength(1);
    expect(full?.createdBy?.id).toBe(actor.id);
    expect(full?.linkedUser).toBeNull();
  });

  it("Consumidor Final seed is idempotent and cannot be edited or deactivated", async () => {
    // tests/integration/reset-db.ts already seeds Consumidor Final once
    // before any test in this run — so by the time this test executes, both
    // calls below are expected to be no-ops (created: false). The actual
    // property under test is that repeated calls never produce a second
    // system customer, regardless of which call (if any) was the one that
    // originally created it.
    await seedConsumidorFinal();
    await seedConsumidorFinal();

    const systemCustomers = await prisma.customer.count({ where: { isSystemDefault: true } });
    expect(systemCustomers).toBe(1);

    const consumidorFinal = await prisma.customer.findFirstOrThrow({
      where: { isSystemDefault: true },
    });

    const actor = await makeActor();
    await expect(
      updateCustomer(consumidorFinal.id, { firstName: "Hackeado" }, actor.id),
    ).rejects.toThrow(SystemCustomerProtectedError);
    await expect(deactivateCustomer(consumidorFinal.id, actor.id)).rejects.toThrow(
      SystemCustomerProtectedError,
    );

    // Never hard-deletable through any exposed function — there isn't one
    // (see modules/customers/customer-core.ts's documented lifecycle
    // policy: deactivation only, no delete). Confirmed here by checking the
    // row is still exactly as the seed left it.
    const stillThere = await prisma.customer.findUnique({ where: { id: consumidorFinal.id } });
    expect(stillThere?.isSystemDefault).toBe(true);
    expect(stillThere?.isActive).toBe(true);
  });
});
