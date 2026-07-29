ALTER TABLE "customer" DROP CONSTRAINT "customer_branch_id_branch_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_item" DROP CONSTRAINT "inventory_item_branch_id_branch_id_fk";
--> statement-breakpoint
ALTER TABLE "notification" DROP CONSTRAINT "notification_branch_id_branch_id_fk";
--> statement-breakpoint
ALTER TABLE "sale" DROP CONSTRAINT "sale_branch_id_branch_id_fk";
--> statement-breakpoint
ALTER TABLE "staff_branch_access" DROP CONSTRAINT "staff_branch_access_branch_id_branch_id_fk";
--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_id_tenant_id_unique" UNIQUE("id","tenant_id");--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_branch_id_tenant_id_fk" FOREIGN KEY ("branch_id","tenant_id") REFERENCES "public"."branch"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item" ADD CONSTRAINT "inventory_item_branch_id_tenant_id_fk" FOREIGN KEY ("branch_id","tenant_id") REFERENCES "public"."branch"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_branch_id_tenant_id_fk" FOREIGN KEY ("branch_id","tenant_id") REFERENCES "public"."branch"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_branch_id_tenant_id_fk" FOREIGN KEY ("branch_id","tenant_id") REFERENCES "public"."branch"("id","tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_branch_access" ADD CONSTRAINT "staff_branch_access_branch_id_tenant_id_fk" FOREIGN KEY ("branch_id","tenant_id") REFERENCES "public"."branch"("id","tenant_id") ON DELETE no action ON UPDATE no action;
