export class ImportError extends Error {}

// Thrown by a row processor for a business-rule failure that isn't a schema
// validation error (e.g. a referenced parentLegacyId/categoryLegacyId isn't
// found) — caught per-row in modules/imports/service.ts and turned into an
// ImportIssue rather than failing the whole batch.
export class ImportRowError extends ImportError {
  constructor(
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "ImportRowError";
  }
}

export class ImportBatchNotCancellableError extends ImportError {
  constructor() {
    super("Solo se puede cancelar una importación que aún no se ejecutó.");
    this.name = "ImportBatchNotCancellableError";
  }
}
