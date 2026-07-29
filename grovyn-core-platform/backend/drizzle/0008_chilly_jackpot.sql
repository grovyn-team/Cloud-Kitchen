ALTER TABLE "inventory_movement" DROP CONSTRAINT "inventory_movement_item_id_inventory_item_id_fk";
--> statement-breakpoint
ALTER TABLE "sale_line_item" DROP CONSTRAINT "sale_line_item_sale_id_sale_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_id_tenant_id_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_id_tenant_id_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_item_id_tenant_id_fk" FOREIGN KEY ("item_id","tenant_id") REFERENCES "public"."inventory_item"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_item" ADD CONSTRAINT "sale_line_item_sale_id_tenant_id_fk" FOREIGN KEY ("sale_id","tenant_id") REFERENCES "public"."sale"("id","tenant_id") ON DELETE no action ON UPDATE no action;
