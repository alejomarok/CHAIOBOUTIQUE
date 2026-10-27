-- Confirmed business details. Preserve the closed branch's history, but
-- remove it from the storefront. Fresh databases seed only Embalse.
UPDATE "store_branch"
SET "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'rio-tercero';

UPDATE "store_configuration"
SET "instagramUrl" = 'https://www.instagram.com/chaioboutique/',
    "facebookUrl" = 'https://web.facebook.com/profile.php?id=100037192312370',
    "whatsappPhone" = '+5493571319469',
    "publicPhone" = '+54 9 3571 31-9469',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'main';
