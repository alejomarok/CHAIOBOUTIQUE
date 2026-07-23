import { prisma } from "@/lib/db";

import { ADMIN_FIXTURE, RESTRICTED_FIXTURE } from "./fixture-credentials";
import { deleteTestUser } from "../fixtures/users";

export default async function globalTeardown() {
  for (const fixture of [ADMIN_FIXTURE, RESTRICTED_FIXTURE]) {
    const user = await prisma.user.findUnique({ where: { email: fixture.email } });
    if (user) await deleteTestUser(user.id);
  }
}
