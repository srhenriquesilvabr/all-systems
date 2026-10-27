CREATE TABLE "sales_register_moves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"reason" text NOT NULL,
	"account_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_register_moves_amount_chk" CHECK (amount > 0)
);
--> statement-breakpoint
ALTER TABLE "sales_register_moves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_register_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opening_float" numeric(12, 2) NOT NULL,
	"opened_by" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"expected_cash" numeric(12, 2),
	"counted_cash" numeric(12, 2),
	"cash_difference" numeric(12, 2),
	"closing" jsonb,
	"notes" text,
	CONSTRAINT "sales_register_sessions_closed_chk" CHECK (status = 'open' or (closed_at is not null and counted_cash is not null and closing is not null))
);
--> statement-breakpoint
ALTER TABLE "sales_register_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_registers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_registers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_administrators" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"institution" text NOT NULL,
	"commission_percent" numeric(6, 3),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_administrators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_bids" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quota_id" uuid NOT NULL,
	"assembly_id" uuid NOT NULL,
	"type" text NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'registered' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_bids" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_credits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quota_id" uuid NOT NULL,
	"status" text DEFAULT 'awaiting_docs' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"released_on" date,
	"asset_description" text,
	"acquired_on" date,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_credits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"plan_id" uuid,
	"group_code" text NOT NULL,
	"members" integer,
	"months_remaining" integer,
	"months_remaining_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_installments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quota_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"due_on" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_on" date,
	"paid_amount" numeric(14, 2),
	"notes" text,
	"paid_by" uuid,
	"late_notice_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_installments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_leaves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"type" text NOT NULL,
	"start_on" date NOT NULL,
	"end_on" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_leaves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hr_terminations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"payroll_id" uuid NOT NULL,
	"type" text NOT NULL,
	"notice" text NOT NULL,
	"termination_date" date NOT NULL,
	"projected_end" date NOT NULL,
	"input" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_terminations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "laundry_logistics_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid,
	"address" jsonb NOT NULL,
	"date" date NOT NULL,
	"period" text,
	"window_start" time NOT NULL,
	"window_end" time NOT NULL,
	"fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"driver_user_id" uuid,
	"items_count" integer,
	"receiver_name" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"fail_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "laundry_logistics_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "re_lease_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"index" text NOT NULL,
	"percent" numeric(6, 2),
	"previous_rent" numeric(14, 2) NOT NULL,
	"new_rent" numeric(14, 2),
	"status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"applied_at" timestamp with time zone,
	"applied_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "re_lease_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "re_lease_charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"period_start" date NOT NULL,
	"due_date" date NOT NULL,
	"payout_date" date NOT NULL,
	"rent" numeric(14, 2) NOT NULL,
	"condo_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"iptu" numeric(14, 2) DEFAULT '0' NOT NULL,
	"admin_fee" numeric(14, 2) NOT NULL,
	"payout" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "re_lease_charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "re_lease_extras" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"due_date" date NOT NULL,
	"pass_to_owner" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "re_lease_extras" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "re_leases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"property_id" uuid NOT NULL,
	"renter_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"term_months" integer NOT NULL,
	"end_date" date NOT NULL,
	"initial_rent" numeric(14, 2) NOT NULL,
	"rent" numeric(14, 2) NOT NULL,
	"due_day" integer NOT NULL,
	"condo_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"iptu_monthly" numeric(14, 2) DEFAULT '0' NOT NULL,
	"adjustment_index" text NOT NULL,
	"adjustment_percent" numeric(6, 2),
	"adjustment_month" integer NOT NULL,
	"guarantee_type" text NOT NULL,
	"guarantee_amount" numeric(14, 2),
	"guarantor_name" text,
	"guarantor_document" text,
	"guarantee_provider" text,
	"guarantee_number" text,
	"admin_fee_percent" numeric(5, 2) NOT NULL,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"terminated_on" date,
	"termination_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "re_leases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "hr_payrolls_competence_key";--> statement-breakpoint
ALTER TABLE "sales_sales" ADD COLUMN "register_session_id" uuid;--> statement-breakpoint
ALTER TABLE "cons_assemblies" ADD COLUMN "status" text DEFAULT 'held' NOT NULL;--> statement-breakpoint
ALTER TABLE "cons_plans" ADD COLUMN "commission_percent" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "cons_quotas" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cons_quotas" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cons_quotas" ADD COLUMN "commission_percent" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "cons_quotas" ADD COLUMN "commission_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "cons_quotas" ADD COLUMN "commission_reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "category" text DEFAULT 'employee' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "experience_end" date;--> statement-breakpoint
ALTER TABLE "hr_payroll_items" ADD COLUMN "commissions" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_payroll_items" ADD COLUMN "absences" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_payroll_items" ADD COLUMN "dsr_lost_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_payroll_items" ADD COLUMN "avos" integer;--> statement-breakpoint
ALTER TABLE "hr_payroll_items" ADD COLUMN "variable_average" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_payrolls" ADD COLUMN "type" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_payrolls" ADD COLUMN "holidays" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_register_moves" ADD CONSTRAINT "sales_register_moves_session_id_sales_register_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sales_register_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_register_moves" ADD CONSTRAINT "sales_register_moves_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_register_moves" ADD CONSTRAINT "sales_register_moves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_register_sessions" ADD CONSTRAINT "sales_register_sessions_register_id_sales_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."sales_registers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_register_sessions" ADD CONSTRAINT "sales_register_sessions_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_register_sessions" ADD CONSTRAINT "sales_register_sessions_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_bids" ADD CONSTRAINT "cons_bids_quota_id_cons_quotas_id_fk" FOREIGN KEY ("quota_id") REFERENCES "public"."cons_quotas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_bids" ADD CONSTRAINT "cons_bids_assembly_id_cons_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."cons_assemblies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_bids" ADD CONSTRAINT "cons_bids_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_credits" ADD CONSTRAINT "cons_credits_quota_id_cons_quotas_id_fk" FOREIGN KEY ("quota_id") REFERENCES "public"."cons_quotas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_groups" ADD CONSTRAINT "cons_groups_plan_id_cons_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."cons_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_installments" ADD CONSTRAINT "cons_installments_quota_id_cons_quotas_id_fk" FOREIGN KEY ("quota_id") REFERENCES "public"."cons_quotas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_installments" ADD CONSTRAINT "cons_installments_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_leaves" ADD CONSTRAINT "hr_leaves_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_terminations" ADD CONSTRAINT "hr_terminations_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_terminations" ADD CONSTRAINT "hr_terminations_payroll_id_hr_payrolls_id_fk" FOREIGN KEY ("payroll_id") REFERENCES "public"."hr_payrolls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_terminations" ADD CONSTRAINT "hr_terminations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_logistics_jobs" ADD CONSTRAINT "laundry_logistics_jobs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_logistics_jobs" ADD CONSTRAINT "laundry_logistics_jobs_order_id_so_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."so_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_logistics_jobs" ADD CONSTRAINT "laundry_logistics_jobs_driver_user_id_users_id_fk" FOREIGN KEY ("driver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_logistics_jobs" ADD CONSTRAINT "laundry_logistics_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_lease_adjustments" ADD CONSTRAINT "re_lease_adjustments_lease_id_re_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."re_leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_lease_adjustments" ADD CONSTRAINT "re_lease_adjustments_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_lease_charges" ADD CONSTRAINT "re_lease_charges_lease_id_re_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."re_leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_lease_extras" ADD CONSTRAINT "re_lease_extras_lease_id_re_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."re_leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_leases" ADD CONSTRAINT "re_leases_property_id_re_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."re_properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_leases" ADD CONSTRAINT "re_leases_renter_id_customers_id_fk" FOREIGN KEY ("renter_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_leases" ADD CONSTRAINT "re_leases_owner_id_customers_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_leases" ADD CONSTRAINT "re_leases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_register_moves_session_idx" ON "sales_register_moves" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_register_sessions_number_key" ON "sales_register_sessions" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_register_sessions_open_key" ON "sales_register_sessions" USING btree ("tenant_id","register_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "sales_register_sessions_opened_idx" ON "sales_register_sessions" USING btree ("tenant_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_registers_name_key" ON "sales_registers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "cons_administrators_key" ON "cons_administrators" USING btree ("tenant_id","connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cons_bids_key" ON "cons_bids" USING btree ("quota_id","assembly_id");--> statement-breakpoint
CREATE INDEX "cons_bids_assembly_idx" ON "cons_bids" USING btree ("assembly_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cons_credits_quota_key" ON "cons_credits" USING btree ("quota_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cons_groups_key" ON "cons_groups" USING btree ("tenant_id","connection_id","group_code");--> statement-breakpoint
CREATE INDEX "cons_groups_code_idx" ON "cons_groups" USING btree ("tenant_id","group_code");--> statement-breakpoint
CREATE UNIQUE INDEX "cons_installments_seq_key" ON "cons_installments" USING btree ("quota_id","seq");--> statement-breakpoint
CREATE INDEX "cons_installments_due_idx" ON "cons_installments" USING btree ("tenant_id","due_on");--> statement-breakpoint
CREATE INDEX "hr_leaves_employee_idx" ON "hr_leaves" USING btree ("employee_id","start_on");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_terminations_employee_key" ON "hr_terminations" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "laundry_logistics_jobs_day_idx" ON "laundry_logistics_jobs" USING btree ("tenant_id","date","window_start");--> statement-breakpoint
CREATE INDEX "laundry_logistics_jobs_driver_idx" ON "laundry_logistics_jobs" USING btree ("tenant_id","driver_user_id","date");--> statement-breakpoint
CREATE INDEX "laundry_logistics_jobs_customer_idx" ON "laundry_logistics_jobs" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "laundry_logistics_jobs_order_idx" ON "laundry_logistics_jobs" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "laundry_logistics_jobs_open_delivery" ON "laundry_logistics_jobs" USING btree ("order_id") WHERE kind = 'delivery' and status in ('scheduled', 'en_route', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX "laundry_logistics_jobs_pickup_order" ON "laundry_logistics_jobs" USING btree ("order_id") WHERE kind = 'pickup';--> statement-breakpoint
CREATE UNIQUE INDEX "re_lease_adjustments_due_key" ON "re_lease_adjustments" USING btree ("lease_id","due_on");--> statement-breakpoint
CREATE INDEX "re_lease_adjustments_status_idx" ON "re_lease_adjustments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "re_lease_charges_seq_key" ON "re_lease_charges" USING btree ("lease_id","seq");--> statement-breakpoint
CREATE INDEX "re_lease_charges_due_idx" ON "re_lease_charges" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "re_lease_extras_lease_idx" ON "re_lease_extras" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "re_lease_extras_due_idx" ON "re_lease_extras" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "re_leases_number_key" ON "re_leases" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "re_leases_property_active_key" ON "re_leases" USING btree ("property_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "re_leases_renter_idx" ON "re_leases" USING btree ("renter_id");--> statement-breakpoint
CREATE INDEX "re_leases_owner_idx" ON "re_leases" USING btree ("tenant_id","owner_id");--> statement-breakpoint
ALTER TABLE "sales_sales" ADD CONSTRAINT "sales_sales_register_session_id_sales_register_sessions_id_fk" FOREIGN KEY ("register_session_id") REFERENCES "public"."sales_register_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_sales_register_session_idx" ON "sales_sales" USING btree ("register_session_id");--> statement-breakpoint
CREATE INDEX "cons_assemblies_date_idx" ON "cons_assemblies" USING btree ("tenant_id","held_on");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_payrolls_competence_type_key" ON "hr_payrolls" USING btree ("tenant_id","competence","type");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales_register_moves" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales_register_sessions" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales_registers" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_administrators" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_bids" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_credits" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_groups" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_installments" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hr_leaves" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hr_terminations" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "laundry_logistics_jobs" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "re_lease_adjustments" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "re_lease_charges" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "re_lease_extras" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "re_leases" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Consórcio: cotas já ativas ganham a data de ativação (janela de estorno da comissão).
UPDATE "cons_quotas" SET "activated_at" = "created_at" WHERE "status" IN ('active', 'contemplated') AND "activated_at" IS NULL;--> statement-breakpoint
-- Caixa do PDV: movimentos (sangria/suprimento) não mudam depois de lançados e sessão fechada
-- não é alterada, nem pela aplicação (mesma ideia do prontuário, 0008).
REVOKE UPDATE, DELETE, TRUNCATE ON "sales_register_moves" FROM app_user;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "sales_register_sessions" FROM app_user;--> statement-breakpoint
CREATE OR REPLACE FUNCTION sales_register_session_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Sessão de caixa fechada não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER sales_register_sessions_frozen BEFORE UPDATE ON "sales_register_sessions"
  FOR EACH ROW EXECUTE FUNCTION sales_register_session_frozen();
