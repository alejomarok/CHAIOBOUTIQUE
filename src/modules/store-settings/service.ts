import "server-only";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { recordAuditLog } from "@/modules/audit";

const STORE_CONFIGURATION_ID = "main";

// Upserts the single-row store configuration, seeding it from env defaults
// on first read so the settings page always has something to render.
export async function getStoreConfiguration() {
  return prisma.storeConfiguration.upsert({
    where: { id: STORE_CONFIGURATION_ID },
    update: {},
    create: {
      id: STORE_CONFIGURATION_ID,
      name: env.STORE_NAME,
      currency: env.STORE_CURRENCY,
      locale: env.STORE_LOCALE,
      timezone: env.STORE_TIMEZONE,
    },
  });
}

export interface UpdateStoreConfigurationInput {
  name: string;
  currency: string;
  locale: string;
  timezone: string;
}

export async function updateStoreConfiguration(
  input: UpdateStoreConfigurationInput,
  actorId: string,
): Promise<void> {
  const before = await getStoreConfiguration();

  await prisma.storeConfiguration.update({
    where: { id: STORE_CONFIGURATION_ID },
    data: input,
  });

  await recordAuditLog({
    userId: actorId,
    action: "store_settings.updated",
    entityType: "StoreConfiguration",
    entityId: STORE_CONFIGURATION_ID,
    previousValue: {
      name: before.name,
      currency: before.currency,
      locale: before.locale,
      timezone: before.timezone,
    },
    newValue: { ...input },
  });
}
