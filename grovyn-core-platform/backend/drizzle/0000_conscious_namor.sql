CREATE TYPE "public"."retention_category" AS ENUM('standard', 'financial_72mo', 'employment_72mo_placeholder');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'STAFF');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"retention_category" "retention_category" DEFAULT 'standard' NOT NULL,
	"retain_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"branch_limit" integer DEFAULT 1 NOT NULL,
	"seat_limit" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"retention_category" "retention_category" DEFAULT 'standard' NOT NULL,
	"retain_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'STAFF' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"retention_category" "retention_category" DEFAULT 'employment_72mo_placeholder' NOT NULL,
	"retain_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_id_idx" ON "audit_log" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "session_tenant_id_idx" ON "session" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_hash_unique_idx" ON "session" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_slug_unique_idx" ON "tenant" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "user_tenant_id_idx" ON "user" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_tenant_email_active_unique_idx" ON "user" USING btree ("tenant_id",lower("email")) WHERE "user"."deleted_at" IS NULL;--> statement-breakpoint
CREATE POLICY "audit_log_tenant_isolation" ON "audit_log" AS PERMISSIVE FOR ALL TO public USING ("audit_log"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("audit_log"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "session_tenant_isolation" ON "session" AS PERMISSIVE FOR ALL TO public USING ("session"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("session"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_self_access" ON "tenant" AS PERMISSIVE FOR ALL TO public USING ("tenant"."id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("tenant"."id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "user_tenant_isolation" ON "user" AS PERMISSIVE FOR ALL TO public USING ("user"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("user"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);