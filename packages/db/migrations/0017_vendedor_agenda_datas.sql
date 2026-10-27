ALTER TABLE "cons_quotas" DROP CONSTRAINT "cons_quotas_seller_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "re_deals" DROP CONSTRAINT "re_deals_broker_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "veh_deals" DROP CONSTRAINT "veh_deals_seller_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "sales_stock_moves_product_idx";--> statement-breakpoint
ALTER TABLE "mr_entries" ADD COLUMN "occurred_on" date DEFAULT (now() at time zone 'America/Sao_Paulo')::date NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_sales" ADD COLUMN "sold_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_stock_moves" ADD COLUMN "occurred_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sch_appointments" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "sch_appointments" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "sch_services" ADD COLUMN "requires_room" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "so_orders" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "aes_packages" ADD COLUMN "sold_on" date DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "aes_packages" ADD COLUMN "cancelled_on" date;--> statement-breakpoint
ALTER TABLE "re_deals" ADD COLUMN "lost_reason_key" text;--> statement-breakpoint
ALTER TABLE "re_deals" ADD COLUMN "lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "veh_deals" ADD COLUMN "lost_reason_key" text;--> statement-breakpoint
ALTER TABLE "veh_deals" ADD COLUMN "lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sch_appointments" ADD CONSTRAINT "sch_appointments_room_id_sch_resources_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."sch_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_quotas" ADD CONSTRAINT "cons_quotas_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "re_deals" ADD CONSTRAINT "re_deals_broker_id_users_id_fk" FOREIGN KEY ("broker_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veh_deals" ADD CONSTRAINT "veh_deals_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_sales_sold_idx" ON "sales_sales" USING btree ("tenant_id","sold_at");--> statement-breakpoint
CREATE INDEX "sch_appointments_room_idx" ON "sch_appointments" USING btree ("tenant_id","room_id","starts_at");--> statement-breakpoint
CREATE INDEX "sch_appointments_series_idx" ON "sch_appointments" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "so_orders_tenant_received_idx" ON "so_orders" USING btree ("tenant_id","received_at");--> statement-breakpoint
CREATE INDEX "cons_quotas_seller_idx" ON "cons_quotas" USING btree ("tenant_id","seller_id");--> statement-breakpoint
CREATE INDEX "re_deals_broker_idx" ON "re_deals" USING btree ("tenant_id","broker_id");--> statement-breakpoint
CREATE INDEX "veh_deals_seller_idx" ON "veh_deals" USING btree ("tenant_id","seller_id");--> statement-breakpoint
CREATE INDEX "sales_stock_moves_product_idx" ON "sales_stock_moves" USING btree ("product_id","occurred_at");--> statement-breakpoint
-- Agenda: a mesma sala/equipamento não pode ter dois atendimentos sobrepostos (cancelado/falta liberam).
ALTER TABLE "sch_appointments" ADD CONSTRAINT "sch_appointments_room_no_overlap"
  EXCLUDE USING gist ("tenant_id" WITH =, "room_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("room_id" IS NOT NULL AND "status" NOT IN ('cancelled', 'no_show'));--> statement-breakpoint
-- Datas do negócio nos registros que já existem: até aqui eram sempre a data de criação.
-- (mr_entries não aceita UPDATE do app_user, ADR-017; a migration roda como dona das tabelas.)
UPDATE "sales_sales" SET "sold_at" = "created_at";--> statement-breakpoint
UPDATE "sales_stock_moves" SET "occurred_at" = "created_at";--> statement-breakpoint
UPDATE "mr_entries" SET "occurred_on" = ("created_at" AT TIME ZONE 'America/Sao_Paulo')::date;--> statement-breakpoint
UPDATE "aes_packages" SET "sold_on" = ("created_at" AT TIME ZONE 'America/Sao_Paulo')::date;--> statement-breakpoint
UPDATE "so_orders" SET "received_at" = "created_at";
