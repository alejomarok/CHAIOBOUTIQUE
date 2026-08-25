import "server-only";

import { cache } from "react";

import { listActiveBranches as listActiveBranchesCore } from "./branch-core";

// The actual implementations live in branch-core.ts, which has no
// "server-only" import so it stays importable from a plain Node context —
// see that file and ARCHITECTURE.md. Named re-exports (not `export *`),
// same reason as modules/store-settings/service.ts: listActiveBranches
// needs to be wrapped in cache() here without a duplicate-export conflict.
// Every public page renders the footer (which calls this) exactly once per
// request, but request-level memoization means a future page that also
// needs branch data never pays a second query within the same request —
// see this phase's own "no multiple sequential DB calls" requirement.
export type { UpdateBranchInput } from "./branch-core";
export { BranchNotFoundError, listBranches, updateBranch } from "./branch-core";
export const listActiveBranches = cache(listActiveBranchesCore);
