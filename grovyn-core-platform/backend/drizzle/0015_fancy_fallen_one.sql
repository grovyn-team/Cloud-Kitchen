CREATE TABLE "inventory_item_alias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"alias_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_item_alias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_item_alias" ADD CONSTRAINT "inventory_item_alias_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_alias" ADD CONSTRAINT "inventory_item_alias_branch_id_tenant_id_fk" FOREIGN KEY ("branch_id","tenant_id") REFERENCES "public"."branch"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_alias" ADD CONSTRAINT "inventory_item_alias_inventory_item_id_tenant_id_fk" FOREIGN KEY ("inventory_item_id","tenant_id") REFERENCES "public"."inventory_item"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_item_alias_tenant_id_idx" ON "inventory_item_alias" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_item_alias_inventory_item_id_idx" ON "inventory_item_alias" USING btree ("inventory_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_item_alias_branch_alias_unique_idx" ON "inventory_item_alias" USING btree ("branch_id",lower("alias_name"));--> statement-breakpoint
CREATE POLICY "inventory_item_alias_tenant_isolation" ON "inventory_item_alias" AS PERMISSIVE FOR ALL TO public USING ("inventory_item_alias"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK ("inventory_item_alias"."tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::uuid);