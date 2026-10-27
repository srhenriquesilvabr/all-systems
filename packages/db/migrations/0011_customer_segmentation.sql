CREATE TABLE "customer_features" (
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"first_purchase_on" date NOT NULL,
	"last_purchase_on" date NOT NULL,
	"recency_days" integer NOT NULL,
	"frequency" integer NOT NULL,
	"monetary" numeric(14, 2) NOT NULL,
	"r" integer NOT NULL,
	"f" integer NOT NULL,
	"m" integer NOT NULL,
	"segment" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_features_tenant_id_customer_id_pk" PRIMARY KEY("tenant_id","customer_id")
);
--> statement-breakpoint
ALTER TABLE "customer_features" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_features" ADD CONSTRAINT "customer_features_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_features_segment_idx" ON "customer_features" USING btree ("tenant_id","segment");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_features" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);