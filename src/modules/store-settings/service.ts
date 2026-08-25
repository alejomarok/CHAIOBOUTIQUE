import "server-only";

import { cache } from "react";

import { getStoreConfiguration as getStoreConfigurationCore } from "./service-core";

// The actual implementations live in service-core.ts, which has no
// "server-only" import so it stays importable from a plain Node context —
// see that file and ARCHITECTURE.md. This wrapper adds back the
// request-level cache() memoization the old single-file version had: this
// single-row, rarely-changing config is read by nearly every cart/pricing/
// checkout operation, and several calls can happen in the same request.
// Named re-exports (not `export *`) specifically so this cached
// getStoreConfiguration can shadow the uncached one from service-core
// without a duplicate-export conflict.
export type { UpdateStoreConfigurationInput } from "./service-core";
export { updateStoreConfiguration } from "./service-core";
export const getStoreConfiguration = cache(getStoreConfigurationCore);
