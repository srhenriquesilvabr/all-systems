CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_entity" text NOT NULL,
	"owner_id" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "laundry_garment_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "laundry_garment_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "laundry_item_details" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"garment_type_id" uuid,
	"tag_code" text NOT NULL,
	"color" text,
	"brand" text,
	"intake_notes" text,
	"incident_notes" text,
	"incident_at" timestamp with time zone,
	"weight_kg" numeric(8, 3),
	"pieces_count" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"rework_count" integer DEFAULT 0 NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "laundry_item_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "laundry_piece_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"notes" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "laundry_piece_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "laundry_service_prices" (
	"tenant_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"garment_type_id" uuid NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	CONSTRAINT "laundry_service_prices_service_id_garment_type_id_pk" PRIMARY KEY("service_id","garment_type_id")
);
--> statement-breakpoint
ALTER TABLE "laundry_service_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD COLUMN "version" text;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_item_details" ADD CONSTRAINT "laundry_item_details_item_id_so_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."so_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_item_details" ADD CONSTRAINT "laundry_item_details_order_id_so_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."so_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_item_details" ADD CONSTRAINT "laundry_item_details_service_id_laundry_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."laundry_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_item_details" ADD CONSTRAINT "laundry_item_details_garment_type_id_laundry_garment_types_id_fk" FOREIGN KEY ("garment_type_id") REFERENCES "public"."laundry_garment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_piece_events" ADD CONSTRAINT "laundry_piece_events_item_id_so_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."so_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_service_prices" ADD CONSTRAINT "laundry_service_prices_service_id_laundry_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."laundry_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laundry_service_prices" ADD CONSTRAINT "laundry_service_prices_garment_type_id_laundry_garment_types_id_fk" FOREIGN KEY ("garment_type_id") REFERENCES "public"."laundry_garment_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("tenant_id","owner_entity","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "laundry_garment_types_name" ON "laundry_garment_types" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "laundry_item_details_tag" ON "laundry_item_details" USING btree ("tenant_id","tag_code");--> statement-breakpoint
CREATE INDEX "laundry_item_details_order_idx" ON "laundry_item_details" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "laundry_item_details_status_idx" ON "laundry_item_details" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "laundry_piece_events_created_idx" ON "laundry_piece_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "laundry_piece_events_item_idx" ON "laundry_piece_events" USING btree ("item_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "files" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "laundry_garment_types" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "laundry_item_details" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "laundry_piece_events" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "laundry_service_prices" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);