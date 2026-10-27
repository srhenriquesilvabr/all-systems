CREATE TABLE "bank_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"products" text[] NOT NULL,
	"base_url" text,
	"client_id" text,
	"client_secret_enc" text,
	"webhook_secret_enc" text,
	"vehicle_monthly_rate" numeric(6, 4) DEFAULT '1.99' NOT NULL,
	"real_estate_yearly_rate" numeric(6, 4) DEFAULT '11.5' NOT NULL,
	"tac_fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bank_proposal_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"source" text NOT NULL,
	"payload" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_proposal_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bank_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"product" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"term_months" integer NOT NULL,
	"offer" jsonb,
	"applicant" jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"status_message" text,
	"external_id" text,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bank_webhook_routes" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "acc_clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"tax_regime" text NOT NULL,
	"cnae" text,
	"has_employees" boolean DEFAULT false NOT NULL,
	"monthly_fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"fee_due_day" integer DEFAULT 10 NOT NULL,
	"responsible_user_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acc_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "acc_fee_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"competence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acc_fee_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "acc_obligation_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"regimes" text[] NOT NULL,
	"requires_employees" boolean DEFAULT false NOT NULL,
	"frequency" text NOT NULL,
	"due_day" integer NOT NULL,
	"due_month" integer,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acc_obligation_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "acc_obligations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"competence" text NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"done_at" timestamp with time zone,
	"done_by_id" uuid,
	"alerted_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acc_obligations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_assemblies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_code" text NOT NULL,
	"held_on" date NOT NULL,
	"drawn" text[] NOT NULL,
	"bids" jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_assemblies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"institution" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"asset_type" text NOT NULL,
	"credit_value" numeric(14, 2) NOT NULL,
	"term_months" integer NOT NULL,
	"admin_fee_percent" numeric(6, 3) NOT NULL,
	"reserve_fund_percent" numeric(6, 3) NOT NULL,
	"insurance_percent" numeric(6, 3) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_quotas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"proposal_id" uuid,
	"status" text DEFAULT 'proposal' NOT NULL,
	"status_message" text,
	"group_code" text,
	"quota_number" text,
	"due_day" integer NOT NULL,
	"contemplated_on" date,
	"contemplation_type" text,
	"bid_percent" numeric(5, 2),
	"seller_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_quotas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"cpf" text NOT NULL,
	"birth_date" date,
	"email" text,
	"phone" text,
	"position" text NOT NULL,
	"department" text,
	"admission_date" date NOT NULL,
	"salary" numeric(12, 2) NOT NULL,
	"weekly_hours" integer DEFAULT 44 NOT NULL,
	"dependents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"termination_date" date,
	"pix_key" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_payroll_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payroll_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"salary" numeric(12, 2) NOT NULL,
	"dependents" integer NOT NULL,
	"days_worked" integer NOT NULL,
	"overtime50_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"overtime100_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"other_earnings" numeric(12, 2) DEFAULT '0' NOT NULL,
	"other_deductions" numeric(12, 2) DEFAULT '0' NOT NULL,
	"result" jsonb NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "hr_payroll_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_payrolls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"competence" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"tables" jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_payrolls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_vacations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"start_on" date NOT NULL,
	"days" integer NOT NULL,
	"sold_days" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_vacations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "re_deals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"payment_type" text NOT NULL,
	"down_payment" numeric(14, 2) DEFAULT '0' NOT NULL,
	"fgts_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"commission_percent" numeric(5, 2) NOT NULL,
	"status" text DEFAULT 'negotiating' NOT NULL,
	"lost_reason" text,
	"broker_id" uuid,
	"notes" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "re_deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "re_properties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" integer NOT NULL,
	"purpose" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"street" text NOT NULL,
	"number" text,
	"complement" text,
	"district" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text,
	"area_m2" numeric(12, 2),
	"land_m2" numeric(14, 2),
	"bedrooms" integer DEFAULT 0 NOT NULL,
	"suites" integer DEFAULT 0 NOT NULL,
	"bathrooms" integer DEFAULT 0 NOT NULL,
	"parking" integer DEFAULT 0 NOT NULL,
	"sale_price" numeric(14, 2),
	"rent_price" numeric(14, 2),
	"condo_fee" numeric(14, 2),
	"iptu_yearly" numeric(14, 2),
	"financeable" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "re_properties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "veh_deals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"payment_type" text NOT NULL,
	"down_payment" numeric(14, 2) DEFAULT '0' NOT NULL,
	"trade_in" jsonb,
	"status" text DEFAULT 'negotiating' NOT NULL,
	"lost_reason" text,
	"seller_id" uuid,
	"notes" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "veh_deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "veh_vehicles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"version" text,
	"year_manufacture" integer NOT NULL,
	"year_model" integer NOT NULL,
	"plate" text,
	"color" text,
	"km" integer DEFAULT 0 NOT NULL,
	"fuel" text NOT NULL,
	"transmission" text NOT NULL,
	"fipe_code" text,
	"fipe_price" numeric(14, 2),
	"cost" numeric(14, 2),
	"price" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "veh_vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_proposal_events" ADD CONSTRAINT "bank_proposal_events_proposal_id_bank_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."bank_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_proposals" ADD CONSTRAINT "bank_proposals_connection_id_bank_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_proposals" ADD CONSTRAINT "bank_proposals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_webhook_routes" ADD CONSTRAINT "bank_webhook_routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_clients" ADD CONSTRAINT "acc_clients_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_clients" ADD CONSTRAINT "acc_clients_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_fee_invoices" ADD CONSTRAINT "acc_fee_invoices_client_id_acc_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."acc_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_obligations" ADD CONSTRAINT "acc_obligations_client_id_acc_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."acc_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_obligations" ADD CONSTRAINT "acc_obligations_type_id_acc_obligation_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."acc_obligation_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acc_obligations" ADD CONSTRAINT "acc_obligations_done_by_id_users_id_fk" FOREIGN KEY ("done_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_quotas" ADD CONSTRAINT "cons_quotas_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_quotas" ADD CONSTRAINT "cons_quotas_plan_id_cons_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."cons_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_quotas" ADD CONSTRAINT "cons_quotas_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_items" ADD CONSTRAINT "hr_payroll_items_payroll_id_hr_payrolls_id_fk" FOREIGN KEY ("payroll_id") REFERENCES "public"."hr_payrolls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payroll_items" ADD CONSTRAINT "hr_payroll_items_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payrolls" ADD CONSTRAINT "hr_payrolls_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_vacations" ADD CONSTRAINT "hr_vacations_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_deals" ADD CONSTRAINT "re_deals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_deals" ADD CONSTRAINT "re_deals_property_id_re_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."re_properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_deals" ADD CONSTRAINT "re_deals_broker_id_users_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_properties" ADD CONSTRAINT "re_properties_owner_id_customers_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veh_deals" ADD CONSTRAINT "veh_deals_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veh_deals" ADD CONSTRAINT "veh_deals_vehicle_id_veh_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."veh_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veh_deals" ADD CONSTRAINT "veh_deals_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_proposal_events_proposal_idx" ON "bank_proposal_events" USING btree ("proposal_id","at");--> statement-breakpoint
CREATE INDEX "bank_proposals_source_idx" ON "bank_proposals" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "bank_proposals_status_idx" ON "bank_proposals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "acc_clients_customer_key" ON "acc_clients" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "acc_fee_invoices_key" ON "acc_fee_invoices" USING btree ("client_id","competence");--> statement-breakpoint
CREATE UNIQUE INDEX "acc_obligation_types_code_key" ON "acc_obligation_types" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "acc_obligations_key" ON "acc_obligations" USING btree ("client_id","type_id","competence");--> statement-breakpoint
CREATE INDEX "acc_obligations_due_idx" ON "acc_obligations" USING btree ("tenant_id","status","due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "cons_assemblies_key" ON "cons_assemblies" USING btree ("tenant_id","group_code","held_on");--> statement-breakpoint
CREATE UNIQUE INDEX "cons_plans_external_key" ON "cons_plans" USING btree ("tenant_id","connection_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cons_quotas_number_key" ON "cons_quotas" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "cons_quotas_group_idx" ON "cons_quotas" USING btree ("tenant_id","group_code","quota_number");--> statement-breakpoint
CREATE INDEX "cons_quotas_customer_idx" ON "cons_quotas" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employees_cpf_key" ON "hr_employees" USING btree ("tenant_id","cpf");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_payroll_items_key" ON "hr_payroll_items" USING btree ("payroll_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_payrolls_competence_key" ON "hr_payrolls" USING btree ("tenant_id","competence");--> statement-breakpoint
CREATE INDEX "hr_vacations_employee_idx" ON "hr_vacations" USING btree ("employee_id","start_on");--> statement-breakpoint
CREATE UNIQUE INDEX "re_deals_number_key" ON "re_deals" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "re_deals_property_idx" ON "re_deals" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "re_deals_customer_idx" ON "re_deals" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "re_properties_code_key" ON "re_properties" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "re_properties_city_idx" ON "re_properties" USING btree ("tenant_id","city","district");--> statement-breakpoint
CREATE UNIQUE INDEX "veh_deals_number_key" ON "veh_deals" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "veh_deals_vehicle_idx" ON "veh_deals" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "veh_deals_customer_idx" ON "veh_deals" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "veh_vehicles_plate_key" ON "veh_vehicles" USING btree ("tenant_id","plate");--> statement-breakpoint
CREATE INDEX "veh_vehicles_status_idx" ON "veh_vehicles" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bank_connections" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bank_proposal_events" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bank_proposals" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "acc_clients" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "acc_fee_invoices" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "acc_obligation_types" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "acc_obligations" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_assemblies" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_plans" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_quotas" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hr_employees" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hr_payroll_items" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hr_payrolls" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hr_vacations" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "re_deals" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "re_properties" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "veh_deals" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "veh_vehicles" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);