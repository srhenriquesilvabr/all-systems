CREATE TABLE "pets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"species" text NOT NULL,
	"breed" text,
	"sex" text DEFAULT 'unknown' NOT NULL,
	"birth_date" date,
	"weight_kg" numeric(6, 2),
	"coat" text,
	"size" text,
	"neutered" boolean DEFAULT false NOT NULL,
	"microchip" text,
	"notes" text,
	"deceased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pets" ADD CONSTRAINT "pets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pets_customer_idx" ON "pets" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "pets_tenant_name_idx" ON "pets" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "pets" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);