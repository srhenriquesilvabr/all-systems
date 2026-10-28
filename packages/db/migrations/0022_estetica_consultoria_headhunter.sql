CREATE TABLE "rec_analyses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"requested" text DEFAULT 'auto' NOT NULL,
	"method" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"score" smallint,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 6),
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rec_analyses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rec_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"stage_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"rejection_reason" text,
	"rejected_at" timestamp with time zone,
	"hired_at" timestamp with time zone,
	"team_member_id" uuid,
	"salary_expectation" numeric(14, 2),
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resume_file_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"consent" jsonb,
	"ip_hash" text,
	"score" smallint,
	"score_method" text,
	"analysis_status" text DEFAULT 'pending' NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rec_applications_score_chk" CHECK (score is null or score between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "rec_applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rec_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"linkedin_url" text,
	"city" text,
	"state" text,
	"notes" text,
	"resume_file_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"retain_until" date,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rec_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rec_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"application_id" uuid,
	"kind" text NOT NULL,
	"text" text,
	"data" jsonb,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rec_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rec_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid,
	"confidential" boolean DEFAULT false NOT NULL,
	"title" text NOT NULL,
	"area" text,
	"description" text DEFAULT '' NOT NULL,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nice_to_have" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"salary_min" numeric(14, 2),
	"salary_max" numeric(14, 2),
	"show_salary" boolean DEFAULT false NOT NULL,
	"benefits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"work_model" text DEFAULT 'onsite' NOT NULL,
	"city" text,
	"state" text,
	"contract_type" text DEFAULT 'clt' NOT NULL,
	"positions" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"stages" jsonb NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"publish_gupy" boolean DEFAULT false NOT NULL,
	"gupy_job_id" text,
	"gupy_sync_status" text DEFAULT 'none' NOT NULL,
	"gupy_error" text,
	"gupy_synced_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rec_jobs_positions_chk" CHECK (positions > 0),
	CONSTRAINT "rec_jobs_salary_chk" CHECK (salary_min is null or salary_max is null or salary_max >= salary_min)
);
--> statement-breakpoint
ALTER TABLE "rec_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aes_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"specialty" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"stage" text,
	"professional_id" uuid,
	"planned_sessions" integer,
	"started_on" date NOT NULL,
	"finished_on" date,
	"close_reason" text,
	"notes" text,
	"budget" jsonb,
	"surgery" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aes_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aes_consent_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text,
	"specialty" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aes_consent_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aes_lot_usages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"specialty" text NOT NULL,
	"amount" numeric(14, 3) NOT NULL,
	"unit" text NOT NULL,
	"used_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aes_lot_usages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aes_product_lots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"lot" text NOT NULL,
	"expires_on" date NOT NULL,
	"received_on" date,
	"quantity" numeric(14, 3),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aes_product_lots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aes_products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"kind" text NOT NULL,
	"unit" text NOT NULL,
	"anvisa_registration" text,
	"units_per_package" numeric(14, 3),
	"sales_product_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aes_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aes_professional_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"team_member_id" uuid NOT NULL,
	"council" text NOT NULL,
	"number" text NOT NULL,
	"uf" text NOT NULL,
	"rqe" text,
	"specialty" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aes_professional_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hrc_clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"fee_mode" text DEFAULT 'none' NOT NULL,
	"fee_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"fee_due_day" integer DEFAULT 10 NOT NULL,
	"thirteenth_fee" boolean DEFAULT false NOT NULL,
	"termination_fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hrc_clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "hr_employees_team_member_key";--> statement-breakpoint
DROP INDEX "hr_payrolls_competence_type_key";--> statement-breakpoint
ALTER TABLE "hr_employees" ADD COLUMN "employer_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "hr_payrolls" ADD COLUMN "employer_customer_id" uuid;--> statement-breakpoint
ALTER TABLE "rec_analyses" ADD CONSTRAINT "rec_analyses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_analyses" ADD CONSTRAINT "rec_analyses_application_id_rec_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."rec_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_applications" ADD CONSTRAINT "rec_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_applications" ADD CONSTRAINT "rec_applications_job_id_rec_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."rec_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_applications" ADD CONSTRAINT "rec_applications_candidate_id_rec_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."rec_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_applications" ADD CONSTRAINT "rec_applications_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_applications" ADD CONSTRAINT "rec_applications_resume_file_id_files_id_fk" FOREIGN KEY ("resume_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_candidates" ADD CONSTRAINT "rec_candidates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_candidates" ADD CONSTRAINT "rec_candidates_resume_file_id_files_id_fk" FOREIGN KEY ("resume_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_events" ADD CONSTRAINT "rec_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_events" ADD CONSTRAINT "rec_events_candidate_id_rec_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."rec_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_events" ADD CONSTRAINT "rec_events_application_id_rec_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."rec_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_events" ADD CONSTRAINT "rec_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_jobs" ADD CONSTRAINT "rec_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_jobs" ADD CONSTRAINT "rec_jobs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rec_jobs" ADD CONSTRAINT "rec_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aes_cases" ADD CONSTRAINT "aes_cases_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aes_cases" ADD CONSTRAINT "aes_cases_professional_id_sch_resources_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."sch_resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aes_lot_usages" ADD CONSTRAINT "aes_lot_usages_lot_id_aes_product_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."aes_product_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aes_lot_usages" ADD CONSTRAINT "aes_lot_usages_product_id_aes_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."aes_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aes_lot_usages" ADD CONSTRAINT "aes_lot_usages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aes_product_lots" ADD CONSTRAINT "aes_product_lots_product_id_aes_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."aes_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aes_products" ADD CONSTRAINT "aes_products_sales_product_id_sales_products_id_fk" FOREIGN KEY ("sales_product_id") REFERENCES "public"."sales_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aes_professional_credentials" ADD CONSTRAINT "aes_professional_credentials_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrc_clients" ADD CONSTRAINT "hrc_clients_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rec_analyses_status_idx" ON "rec_analyses" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "rec_analyses_application_idx" ON "rec_analyses" USING btree ("tenant_id","application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rec_applications_job_candidate_key" ON "rec_applications" USING btree ("tenant_id","job_id","candidate_id");--> statement-breakpoint
CREATE INDEX "rec_applications_job_idx" ON "rec_applications" USING btree ("tenant_id","job_id","status","score");--> statement-breakpoint
CREATE INDEX "rec_applications_candidate_idx" ON "rec_applications" USING btree ("tenant_id","candidate_id");--> statement-breakpoint
CREATE INDEX "rec_applications_ip_idx" ON "rec_applications" USING btree ("tenant_id","ip_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rec_candidates_tenant_email_key" ON "rec_candidates" USING btree ("tenant_id","email") WHERE email is not null;--> statement-breakpoint
CREATE INDEX "rec_candidates_tenant_name_idx" ON "rec_candidates" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "rec_candidates_tenant_retain_idx" ON "rec_candidates" USING btree ("tenant_id","retain_until");--> statement-breakpoint
CREATE INDEX "rec_events_candidate_idx" ON "rec_events" USING btree ("tenant_id","candidate_id","created_at");--> statement-breakpoint
CREATE INDEX "rec_jobs_tenant_status_idx" ON "rec_jobs" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "rec_jobs_tenant_customer_idx" ON "rec_jobs" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "aes_cases_customer_idx" ON "aes_cases" USING btree ("customer_id","specialty");--> statement-breakpoint
CREATE INDEX "aes_cases_open_idx" ON "aes_cases" USING btree ("tenant_id","specialty","status");--> statement-breakpoint
CREATE UNIQUE INDEX "aes_consent_templates_key" ON "aes_consent_templates" USING btree ("tenant_id","key") WHERE key is not null;--> statement-breakpoint
CREATE INDEX "aes_lot_usages_lot_idx" ON "aes_lot_usages" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "aes_lot_usages_customer_idx" ON "aes_lot_usages" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "aes_product_lots_key" ON "aes_product_lots" USING btree ("tenant_id","product_id","lot");--> statement-breakpoint
CREATE INDEX "aes_product_lots_expiry_idx" ON "aes_product_lots" USING btree ("tenant_id","expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "aes_products_name_key" ON "aes_products" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "aes_professional_credentials_member_key" ON "aes_professional_credentials" USING btree ("tenant_id","team_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hrc_clients_customer_key" ON "hrc_clients" USING btree ("tenant_id","customer_id");--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_employer_customer_id_customers_id_fk" FOREIGN KEY ("employer_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payrolls" ADD CONSTRAINT "hr_payrolls_employer_customer_id_customers_id_fk" FOREIGN KEY ("employer_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employees_own_member_key" ON "hr_employees" USING btree ("tenant_id","team_member_id") WHERE employer_customer_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employees_employer_member_key" ON "hr_employees" USING btree ("tenant_id","employer_customer_id","team_member_id") WHERE employer_customer_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_payrolls_own_competence_type_key" ON "hr_payrolls" USING btree ("tenant_id","competence","type") WHERE employer_customer_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_payrolls_employer_competence_type_key" ON "hr_payrolls" USING btree ("tenant_id","employer_customer_id","competence","type") WHERE employer_customer_id is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rec_analyses" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rec_applications" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rec_candidates" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rec_events" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "rec_jobs" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "aes_cases" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "aes_consent_templates" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "aes_lot_usages" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "aes_product_lots" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "aes_products" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "aes_professional_credentials" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "hrc_clients" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- Estética: uso de lote só de inclusão (rastreio Anvisa) e checagens.
-- Estética: especialidades (harmonização, clareamento, cirurgia plástica, micropigmentação, laser,
-- tricologia) — registro no conselho, produtos com lote e validade, rastreio de uso por paciente,
-- modelos de termo e casos (tratamentos) com orçamento e cirurgia.
--
-- COMO USAR
-- 1. Gere a migration normalmente (drizzle-kit generate). Ela deve conter:
--    - CREATE TABLE "aes_professional_credentials", "aes_products", "aes_product_lots",
--      "aes_lot_usages", "aes_consent_templates", "aes_cases" (+ ENABLE ROW LEVEL SECURITY,
--      POLICY "tenant_isolation", FKs e índices);
--    - o índice único por nome do produto sem diferenciar maiúsculas:
--      CREATE UNIQUE INDEX "aes_products_name_key" ON "aes_products" USING btree ("tenant_id", lower("name"));
--    - o índice único parcial dos modelos: ... ON "aes_consent_templates" ("tenant_id","key") WHERE key is not null.
--    Nada muda em tabelas existentes: o tipo de movimento de estoque "consumption" (uso em
--    atendimento) é só um valor novo na coluna text sales_stock_moves.kind, sem CHECK no banco.
-- 2. Cole este arquivo NO FIM da migration gerada (ou rode depois dela). Tudo aqui é idempotente.
-- Permissões: as tabelas novas recebem SELECT/INSERT/UPDATE/DELETE para app_user pelos default
-- privileges (0000); o REVOKE abaixo tira o que não pode do rastreio de lote.

-- Rastreio de lote é só inclusão, como o prontuário (ADR-017): num recall da Anvisa, a lista de quem
-- recebeu o lote não pode ter sido alterada nem apagada, nem pela aplicação.
REVOKE UPDATE, DELETE, TRUNCATE ON "aes_lot_usages" FROM app_user;--> statement-breakpoint

-- Sanidade dos cadastros.
ALTER TABLE "aes_lot_usages" DROP CONSTRAINT IF EXISTS "aes_lot_usages_amount_chk";--> statement-breakpoint
ALTER TABLE "aes_lot_usages" ADD CONSTRAINT "aes_lot_usages_amount_chk" CHECK (amount >= 0);--> statement-breakpoint
ALTER TABLE "aes_products" DROP CONSTRAINT IF EXISTS "aes_products_units_per_package_chk";--> statement-breakpoint
ALTER TABLE "aes_products" ADD CONSTRAINT "aes_products_units_per_package_chk" CHECK (units_per_package IS NULL OR units_per_package > 0);--> statement-breakpoint
ALTER TABLE "aes_product_lots" DROP CONSTRAINT IF EXISTS "aes_product_lots_quantity_chk";--> statement-breakpoint
ALTER TABLE "aes_product_lots" ADD CONSTRAINT "aes_product_lots_quantity_chk" CHECK (quantity IS NULL OR quantity >= 0);--> statement-breakpoint
ALTER TABLE "aes_professional_credentials" DROP CONSTRAINT IF EXISTS "aes_professional_credentials_uf_chk";--> statement-breakpoint
ALTER TABLE "aes_professional_credentials" ADD CONSTRAINT "aes_professional_credentials_uf_chk" CHECK (uf ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "aes_cases" DROP CONSTRAINT IF EXISTS "aes_cases_planned_sessions_chk";--> statement-breakpoint
ALTER TABLE "aes_cases" ADD CONSTRAINT "aes_cases_planned_sessions_chk" CHECK (planned_sessions IS NULL OR planned_sessions > 0);--> statement-breakpoint
-- Etapa só existe na cirurgia plástica.
ALTER TABLE "aes_cases" DROP CONSTRAINT IF EXISTS "aes_cases_stage_chk";--> statement-breakpoint
ALTER TABLE "aes_cases" ADD CONSTRAINT "aes_cases_stage_chk" CHECK ((specialty = 'plastic_surgery') = (stage IS NOT NULL));
