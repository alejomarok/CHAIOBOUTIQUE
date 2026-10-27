-- Business tables are accessed only through the permission-checked Next.js server.
-- Deny the Supabase Data API roles; keep Storage and provider-owned schemas untouched.
-- The Prisma connection must be the table owner (or a deliberately configured server role).
DO $$
DECLARE
  table_name text;
  client_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'user',
    'session',
    'account',
    'verification',
    'role',
    'permission',
    'user_role',
    'role_permission',
    'store_configuration',
    'store_branch',
    'audit_log',
    'category',
    'brand',
    'size_group',
    'size_option',
    'color',
    'product',
    'product_variant',
    'product_image',
    'warehouse',
    'inventory_balance',
    'inventory_operation',
    'inventory_movement',
    'import_batch',
    'import_issue',
    'public_registration_intent',
    'customer_profile',
    'customer_consent',
    'cart',
    'cart_item',
    'customer',
    'customer_address',
    'sale',
    'sale_item',
    'sale_payment',
    'fiscal_document',
    'order',
    'order_item',
    'inventory_reservation',
    'order_payment_attempt',
    'rate_limit',
    'app_rate_limit',
    'provider_payment_adjustment',
    'email_outbox',
    'consumer_request',
    '_prisma_migrations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', table_name);
    FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', table_name, client_role);
    END LOOP;
  END LOOP;
  -- Avoid reintroducing API grants on future tables created by this migration owner.
  FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I', client_role);
  END LOOP;
END $$;
