CREATE TABLE "tax_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rate_percent" numeric(5, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_rate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_line_item" ADD COLUMN "gst_rate_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "sale_line_item" ADD COLUMN "tax_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "tax_rate" ADD CONSTRAINT "tax_rate_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_rate_tenant_id_idx" ON "tax_rate" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tax_rate_tenant_effective_from_idx" ON "tax_rate" USING btree ("tenant_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rate_tenant_open_unique_idx" ON "tax_rate" USING btree ("tenant_id") WHERE "tax_rate"."effective_to" IS NULL;--> statement-breakpoint
CREATE POLICY "tax_rate_tenant_isolation" ON "tax_rate" AS PERMISSIVE FOR ALL TO public USING ("tax_rate"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("tax_rate"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);