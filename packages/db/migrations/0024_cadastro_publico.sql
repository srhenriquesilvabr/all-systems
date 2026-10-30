CREATE TABLE "tenant_signups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ip_hash" text,
	"consent_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_signups" ADD CONSTRAINT "tenant_signups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_signups_ip_idx" ON "tenant_signups" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "tenant_signups_created_idx" ON "tenant_signups" USING btree ("created_at");