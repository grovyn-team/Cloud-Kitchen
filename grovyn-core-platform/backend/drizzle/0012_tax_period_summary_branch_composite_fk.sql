ALTER TABLE "tax_period_summary" DROP CONSTRAINT "tax_period_summary_branch_id_branch_id_fk";
--> statement-breakpoint
ALTER TABLE "tax_period_summary" ADD CONSTRAINT "tax_period_summary_branch_id_tenant_id_fk" FOREIGN KEY ("branch_id","tenant_id") REFERENCES "public"."branch"("id","tenant_id") ON DELETE no action ON UPDATE no action;