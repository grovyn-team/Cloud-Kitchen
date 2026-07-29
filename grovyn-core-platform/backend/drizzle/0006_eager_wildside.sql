CREATE TYPE "public"."inventory_movement_type" AS ENUM('sale_deduction', 'manual_adjustment', 'excel_import', 'restock', 'correction');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('unread', 'read', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('low_stock', 'inventory_request', 'anomaly', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'upi', 'netbanking', 'other', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."sale_source" AS ENUM('manual', 'csv_import', 'excel_import');--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"category" text,
	"rating" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"retention_category" "retention_category" DEFAULT 'standard' NOT NULL,
	"retain_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "customer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"unit" text NOT NULL,
	"current_stock" numeric(12, 3) DEFAULT '0' NOT NULL,
	"low_stock_threshold" numeric(12, 3),
	"cost_per_unit" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"retention_category" "retention_category" DEFAULT 'standard' NOT NULL,
	"retain_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inventory_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"movement_type" "inventory_movement_type" NOT NULL,
	"quantity_delta" numeric(12, 3) NOT NULL,
	"resulting_stock" numeric(12, 3) NOT NULL,
	"reason" text,
	"actor_user_id" uuid,
	"related_sale_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_movement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"actor_user_id" uuid,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"status" "notification_status" DEFAULT 'unread' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"retention_category" "retention_category" DEFAULT 'standard' NOT NULL,
	"retain_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sale" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_date" date NOT NULL,
	"source" "sale_source" DEFAULT 'manual' NOT NULL,
	"import_batch_ref" text,
	"payment_method" "payment_method",
	"subtotal_amount" numeric(12, 2) NOT NULL,
	"tax_amount" numeric(12, 2) NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"retention_category" "retention_category" DEFAULT 'financial_72mo' NOT NULL,
	"retain_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sale" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sale_line_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"inventory_item_id" uuid,
	"item_name" text NOT NULL,
	"sku" text,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"line_subtotal" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"retention_category" "retention_category" DEFAULT 'financial_72mo' NOT NULL,
	"retain_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sale_line_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tax_period_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"gst_rate" numeric(5, 2) NOT NULL,
	"taxable_amount" numeric(14, 2) NOT NULL,
	"tax_amount" numeric(14, 2) NOT NULL,
	"sale_count" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"retention_category" "retention_category" DEFAULT 'financial_72mo' NOT NULL,
	"retain_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tax_period_summary" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "opening_hours" text;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_item_id_inventory_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_related_sale_id_sale_id_fk" FOREIGN KEY ("related_sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_resolved_by_user_id_user_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_item" ADD CONSTRAINT "sale_line_item_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_item" ADD CONSTRAINT "sale_line_item_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_item" ADD CONSTRAINT "sale_line_item_inventory_item_id_inventory_item_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_period_summary" ADD CONSTRAINT "tax_period_summary_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_period_summary" ADD CONSTRAINT "tax_period_summary_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_tenant_id_idx" ON "customer" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customer_tenant_branch_idx" ON "customer" USING btree ("tenant_id","branch_id");--> statement-breakpoint
CREATE INDEX "customer_tenant_branch_category_idx" ON "customer" USING btree ("tenant_id","branch_id","category");--> statement-breakpoint
CREATE INDEX "inventory_item_tenant_id_idx" ON "inventory_item" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_item_tenant_branch_idx" ON "inventory_item" USING btree ("tenant_id","branch_id");--> statement-breakpoint
CREATE INDEX "inventory_movement_tenant_branch_idx" ON "inventory_movement" USING btree ("tenant_id","branch_id");--> statement-breakpoint
CREATE INDEX "inventory_movement_tenant_item_idx" ON "inventory_movement" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "notification_tenant_id_idx" ON "notification" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "notification_tenant_branch_status_idx" ON "notification" USING btree ("tenant_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "notification_tenant_status_idx" ON "notification" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "sale_tenant_id_idx" ON "sale" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sale_tenant_branch_date_idx" ON "sale" USING btree ("tenant_id","branch_id","sale_date");--> statement-breakpoint
CREATE INDEX "sale_tenant_date_idx" ON "sale" USING btree ("tenant_id","sale_date");--> statement-breakpoint
CREATE INDEX "sale_line_item_tenant_id_idx" ON "sale_line_item" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sale_line_item_sale_id_idx" ON "sale_line_item" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_line_item_inventory_item_id_idx" ON "sale_line_item" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE INDEX "tax_period_summary_tenant_id_idx" ON "tax_period_summary" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tax_period_summary_tenant_branch_period_idx" ON "tax_period_summary" USING btree ("tenant_id","branch_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_period_summary_active_unique_idx" ON "tax_period_summary" USING btree ("tenant_id","branch_id","period_start","period_end","gst_rate") WHERE "tax_period_summary"."deleted_at" IS NULL;--> statement-breakpoint
CREATE POLICY "customer_tenant_isolation" ON "customer" AS PERMISSIVE FOR ALL TO public USING ("customer"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("customer"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "inventory_item_tenant_isolation" ON "inventory_item" AS PERMISSIVE FOR ALL TO public USING ("inventory_item"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("inventory_item"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "inventory_movement_tenant_isolation" ON "inventory_movement" AS PERMISSIVE FOR ALL TO public USING ("inventory_movement"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("inventory_movement"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "notification_tenant_isolation" ON "notification" AS PERMISSIVE FOR ALL TO public USING ("notification"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("notification"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sale_tenant_isolation" ON "sale" AS PERMISSIVE FOR ALL TO public USING ("sale"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("sale"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "sale_line_item_tenant_isolation" ON "sale_line_item" AS PERMISSIVE FOR ALL TO public USING ("sale_line_item"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("sale_line_item"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tax_period_summary_tenant_isolation" ON "tax_period_summary" AS PERMISSIVE FOR ALL TO public USING ("tax_period_summary"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("tax_period_summary"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);