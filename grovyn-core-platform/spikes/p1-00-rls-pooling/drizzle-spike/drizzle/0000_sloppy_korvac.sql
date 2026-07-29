CREATE TABLE "rls_test" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rls_test" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rls_test" AS PERMISSIVE FOR ALL TO public USING ("rls_test"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);