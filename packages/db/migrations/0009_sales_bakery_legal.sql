CREATE TABLE "sales_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"barcode" text,
	"category" text,
	"unit" text DEFAULT 'un' NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"cost" numeric(12, 2),
	"track_stock" boolean DEFAULT true NOT NULL,
	"stock" numeric(14, 3) DEFAULT '0' NOT NULL,
	"min_stock" numeric(14, 3),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"customer_id" uuid,
	"subtotal" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"change" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"seller_id" uuid,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_stock_moves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"balance" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(12, 2),
	"reason" text,
	"sale_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_stock_moves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "legal_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"number" text,
	"title" text NOT NULL,
	"area" text NOT NULL,
	"role" text NOT NULL,
	"court" text,
	"opposing_party" text,
	"claim_value" numeric(14, 2),
	"responsible_user_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "legal_deadlines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_on" date NOT NULL,
	"alert_days" integer DEFAULT 3 NOT NULL,
	"assigned_user_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"done_at" timestamp with time zone,
	"alerted_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_deadlines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "legal_fees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"amount" numeric(14, 2),
	"installments" integer DEFAULT 1 NOT NULL,
	"success_percent" numeric(5, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_fees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "legal_updates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"description" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_updates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_sale_id_sales_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales_sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_product_id_sales_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."sales_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_payments" ADD CONSTRAINT "sales_payments_sale_id_sales_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales_sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_sales" ADD CONSTRAINT "sales_sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_sales" ADD CONSTRAINT "sales_sales_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stock_moves" ADD CONSTRAINT "sales_stock_moves_product_id_sales_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."sales_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stock_moves" ADD CONSTRAINT "sales_stock_moves_sale_id_sales_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stock_moves" ADD CONSTRAINT "sales_stock_moves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_cases" ADD CONSTRAINT "legal_cases_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_deadlines" ADD CONSTRAINT "legal_deadlines_case_id_legal_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."legal_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_deadlines" ADD CONSTRAINT "legal_deadlines_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_fees" ADD CONSTRAINT "legal_fees_case_id_legal_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."legal_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_fees" ADD CONSTRAINT "legal_fees_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD CONSTRAINT "legal_updates_case_id_legal_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."legal_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD CONSTRAINT "legal_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_items_sale_idx" ON "sales_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sales_items_product_idx" ON "sales_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sales_payments_sale_idx" ON "sales_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_products_barcode_key" ON "sales_products" USING btree ("tenant_id","barcode");--> statement-breakpoint
CREATE INDEX "sales_products_name_idx" ON "sales_products" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_sales_number_key" ON "sales_sales" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "sales_sales_created_idx" ON "sales_sales" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_stock_moves_product_idx" ON "sales_stock_moves" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_cases_number_key" ON "legal_cases" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "legal_cases_customer_idx" ON "legal_cases" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "legal_deadlines_due_idx" ON "legal_deadlines" USING btree ("tenant_id","status","due_on");--> statement-breakpoint
CREATE INDEX "legal_deadlines_case_idx" ON "legal_deadlines" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "legal_fees_case_idx" ON "legal_fees" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "legal_updates_case_idx" ON "legal_updates" USING btree ("case_id","occurred_on");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales_items" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales_payments" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales_products" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales_sales" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales_stock_moves" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "legal_cases" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "legal_deadlines" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "legal_fees" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "legal_updates" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);