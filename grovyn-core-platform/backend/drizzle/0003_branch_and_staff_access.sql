CREATE TABLE "branch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"retention_category" "retention_category" DEFAULT 'standard' NOT NULL,
	"retain_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "branch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "staff_branch_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"retention_category" "retention_category" DEFAULT 'standard' NOT NULL,
	"retain_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "staff_branch_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_branch_access" ADD CONSTRAINT "staff_branch_access_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_branch_access" ADD CONSTRAINT "staff_branch_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_branch_access" ADD CONSTRAINT "staff_branch_access_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_tenant_id_idx" ON "branch" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "staff_branch_access_tenant_id_idx" ON "staff_branch_access" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "staff_branch_access_user_id_idx" ON "staff_branch_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "staff_branch_access_branch_id_idx" ON "staff_branch_access" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_branch_access_active_unique_idx" ON "staff_branch_access" USING btree ("user_id","branch_id") WHERE "staff_branch_access"."revoked_at" IS NULL;--> statement-breakpoint
CREATE POLICY "branch_tenant_isolation" ON "branch" AS PERMISSIVE FOR ALL TO public USING ("branch"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("branch"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "staff_branch_access_tenant_isolation" ON "staff_branch_access" AS PERMISSIVE FOR ALL TO public USING ("staff_branch_access"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("staff_branch_access"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);