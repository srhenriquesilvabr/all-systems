CREATE TABLE "sch_appointment_services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"service_id" uuid,
	"name" text NOT NULL,
	"duration_min" integer NOT NULL,
	"price" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sch_appointment_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sch_appointments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"source" text DEFAULT 'admin' NOT NULL,
	"notes" text,
	"subject_type" text,
	"subject_id" text,
	"subject_label" text,
	"total" numeric(14, 2) NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sch_appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sch_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"method" text NOT NULL,
	"paid_at" date NOT NULL,
	"fin_entry_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sch_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sch_resources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'professional' NOT NULL,
	"user_id" uuid,
	"color" text DEFAULT '#2d4bff' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sch_resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sch_service_resources" (
	"tenant_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	CONSTRAINT "sch_service_resources_service_id_resource_id_pk" PRIMARY KEY("service_id","resource_id")
);
--> statement-breakpoint
ALTER TABLE "sch_service_resources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sch_services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"duration_min" integer NOT NULL,
	"buffer_min" integer DEFAULT 0 NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"online" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sch_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sch_time_off" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "sch_time_off" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sch_working_hours" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sch_working_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_inbound" (
	"message_id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_phone" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_numbers" (
	"phone_number_id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beauty_commission_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"service_id" uuid,
	"rate" numeric(5, 2) NOT NULL,
	CONSTRAINT "beauty_commission_rules_key" UNIQUE NULLS NOT DISTINCT("tenant_id","resource_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "beauty_commission_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "notification_templates_key";--> statement-breakpoint
ALTER TABLE "notification_templates" ALTER COLUMN "subject" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD COLUMN "channel" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "action_url" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "sch_appointment_services" ADD CONSTRAINT "sch_appointment_services_appointment_id_sch_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."sch_appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sch_appointment_services" ADD CONSTRAINT "sch_appointment_services_service_id_sch_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sch_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sch_appointments" ADD CONSTRAINT "sch_appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sch_appointments" ADD CONSTRAINT "sch_appointments_resource_id_sch_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."sch_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sch_payments" ADD CONSTRAINT "sch_payments_appointment_id_sch_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."sch_appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sch_resources" ADD CONSTRAINT "sch_resources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sch_service_resources" ADD CONSTRAINT "sch_service_resources_service_id_sch_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sch_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sch_service_resources" ADD CONSTRAINT "sch_service_resources_resource_id_sch_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."sch_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sch_time_off" ADD CONSTRAINT "sch_time_off_resource_id_sch_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."sch_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sch_working_hours" ADD CONSTRAINT "sch_working_hours_resource_id_sch_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."sch_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbound" ADD CONSTRAINT "whatsapp_inbound_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_numbers" ADD CONSTRAINT "whatsapp_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beauty_commission_rules" ADD CONSTRAINT "beauty_commission_rules_resource_id_sch_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."sch_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beauty_commission_rules" ADD CONSTRAINT "beauty_commission_rules_service_id_sch_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."sch_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sch_appointment_services_appt_idx" ON "sch_appointment_services" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "sch_appointments_resource_idx" ON "sch_appointments" USING btree ("tenant_id","resource_id","starts_at");--> statement-breakpoint
CREATE INDEX "sch_appointments_customer_idx" ON "sch_appointments" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sch_appointments_starts_idx" ON "sch_appointments" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "sch_payments_appt_idx" ON "sch_payments" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "sch_time_off_resource_idx" ON "sch_time_off" USING btree ("resource_id","starts_at");--> statement-breakpoint
CREATE INDEX "sch_working_hours_resource_idx" ON "sch_working_hours" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_key_channel" ON "notification_templates" USING btree ("tenant_id","key","channel");--> statement-breakpoint
CREATE INDEX "notifications_related_idx" ON "notifications" USING btree ("tenant_id","related_entity","related_id");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_slug_unique" UNIQUE("slug");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sch_appointment_services" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sch_appointments" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sch_payments" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sch_resources" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sch_service_resources" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sch_services" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sch_time_off" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sch_working_hours" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "beauty_commission_rules" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);