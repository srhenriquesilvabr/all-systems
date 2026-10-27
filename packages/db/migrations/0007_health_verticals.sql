CREATE TABLE "mr_access_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entry_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mr_access_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mr_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"form_key" text NOT NULL,
	"title" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"appointment_id" uuid,
	"amends_id" uuid,
	"amend_reason" text,
	"author_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mr_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aes_package_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aes_package_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aes_packages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"total_sessions" integer NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"expires_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aes_packages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ortho_treatments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"appliance" text NOT NULL,
	"started_on" date NOT NULL,
	"expected_months" integer NOT NULL,
	"entry_fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"monthly_fee" numeric(12, 2) NOT NULL,
	"due_day" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"finished_on" date,
	"cancel_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ortho_treatments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vet_vaccinations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pet_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"vaccine" text NOT NULL,
	"dose" text,
	"batch" text,
	"manufacturer" text,
	"applied_on" date NOT NULL,
	"next_due_on" date,
	"applied_by_id" uuid,
	"applied_by_name" text NOT NULL,
	"notes" text,
	"reminder_sent_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vet_vaccinations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mr_access_log" ADD CONSTRAINT "mr_access_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mr_entries" ADD CONSTRAINT "mr_entries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mr_entries" ADD CONSTRAINT "mr_entries_amends_id_mr_entries_id_fk" FOREIGN KEY ("amends_id") REFERENCES "public"."mr_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mr_entries" ADD CONSTRAINT "mr_entries_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aes_package_sessions" ADD CONSTRAINT "aes_package_sessions_package_id_aes_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."aes_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aes_package_sessions" ADD CONSTRAINT "aes_package_sessions_appointment_id_sch_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."sch_appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aes_packages" ADD CONSTRAINT "aes_packages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aes_packages" ADD CONSTRAINT "aes_packages_service_id_sch_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sch_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ortho_treatments" ADD CONSTRAINT "ortho_treatments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_vaccinations" ADD CONSTRAINT "vet_vaccinations_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "public"."pets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_vaccinations" ADD CONSTRAINT "vet_vaccinations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_vaccinations" ADD CONSTRAINT "vet_vaccinations_applied_by_id_users_id_fk" FOREIGN KEY ("applied_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mr_access_log_subject_idx" ON "mr_access_log" USING btree ("tenant_id","subject_type","subject_id","at");--> statement-breakpoint
CREATE INDEX "mr_entries_subject_idx" ON "mr_entries" USING btree ("tenant_id","subject_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "mr_entries_customer_idx" ON "mr_entries" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "mr_entries_amends_idx" ON "mr_entries" USING btree ("amends_id");--> statement-breakpoint
CREATE UNIQUE INDEX "aes_package_sessions_key" ON "aes_package_sessions" USING btree ("package_id","appointment_id");--> statement-breakpoint
CREATE INDEX "aes_package_sessions_appointment_idx" ON "aes_package_sessions" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "aes_packages_customer_idx" ON "aes_packages" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "ortho_treatments_customer_idx" ON "ortho_treatments" USING btree ("customer_id","status");--> statement-breakpoint
CREATE INDEX "vet_vaccinations_pet_idx" ON "vet_vaccinations" USING btree ("pet_id","applied_on");--> statement-breakpoint
CREATE INDEX "vet_vaccinations_due_idx" ON "vet_vaccinations" USING btree ("tenant_id","next_due_on");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "mr_access_log" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "mr_entries" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "aes_package_sessions" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "aes_packages" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ortho_treatments" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "vet_vaccinations" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);