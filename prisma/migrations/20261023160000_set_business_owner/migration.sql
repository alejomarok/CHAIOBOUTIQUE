-- Confirmed by the store owner. Preserve any existing explicit fiscal configuration.
UPDATE store_configuration
SET "fiscalLegalName" = 'SILVINA IVANA DANI', "updatedAt" = CURRENT_TIMESTAMP
WHERE id = 'main' AND "fiscalLegalName" IS NULL;
