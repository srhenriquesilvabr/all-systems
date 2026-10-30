CREATE TABLE "bakery_item_details" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"inscription" text,
	"stock_moved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bakery_item_details" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "beauty_commission_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appointment_service_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"service_id" uuid,
	"rate" numeric(5, 2) NOT NULL,
	"commission" numeric(14, 2) NOT NULL,
	"payout_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beauty_commission_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "beauty_commission_payouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"due_date" date NOT NULL,
	"fin_entry_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beauty_commission_payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_assembly_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assembly_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"effects" jsonb NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_assembly_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "petshop_pickups" (
	"appointment_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"picked_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	"picked_up_by" uuid
);
--> statement-breakpoint
ALTER TABLE "petshop_pickups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vet_vaccines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vet_vaccines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "cons_assemblies_key";--> statement-breakpoint
DROP INDEX "hr_terminations_employee_key";--> statement-breakpoint
ALTER TABLE "sch_services" ALTER COLUMN "online" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "sales_register_moves" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "sales_register_moves" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "sales_register_moves" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "sch_appointment_services" ADD COLUMN "discount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sch_appointment_services" ADD COLUMN "covered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sch_payments" ADD COLUMN "register_session_id" uuid;--> statement-breakpoint
ALTER TABLE "aes_lot_usages" ADD COLUMN "reversal_of" uuid;--> statement-breakpoint
ALTER TABLE "aes_packages" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "cons_assemblies" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "cons_quotas" ADD COLUMN "contemplated_assembly_id" uuid;--> statement-breakpoint
ALTER TABLE "hr_terminations" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hr_terminations" ADD COLUMN "cancelled_by_id" uuid;--> statement-breakpoint
ALTER TABLE "hr_terminations" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "legal_deadlines" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "legal_deadlines" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "legal_deadlines" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD COLUMN "auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD COLUMN "deadline_id" uuid;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD COLUMN "edited_by" uuid;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "vet_vaccinations" ADD COLUMN "vaccine_id" uuid;--> statement-breakpoint
ALTER TABLE "bakery_item_details" ADD CONSTRAINT "bakery_item_details_item_id_so_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."so_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bakery_item_details" ADD CONSTRAINT "bakery_item_details_order_id_so_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."so_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beauty_commission_lines" ADD CONSTRAINT "beauty_commission_lines_appointment_service_id_sch_appointment_services_id_fk" FOREIGN KEY ("appointment_service_id") REFERENCES "public"."sch_appointment_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beauty_commission_lines" ADD CONSTRAINT "beauty_commission_lines_appointment_id_sch_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."sch_appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beauty_commission_lines" ADD CONSTRAINT "beauty_commission_lines_resource_id_sch_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."sch_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beauty_commission_lines" ADD CONSTRAINT "beauty_commission_lines_payout_id_beauty_commission_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."beauty_commission_payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beauty_commission_payouts" ADD CONSTRAINT "beauty_commission_payouts_resource_id_sch_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."sch_resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_assembly_corrections" ADD CONSTRAINT "cons_assembly_corrections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_assembly_corrections" ADD CONSTRAINT "cons_assembly_corrections_assembly_id_cons_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."cons_assemblies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_assembly_corrections" ADD CONSTRAINT "cons_assembly_corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petshop_pickups" ADD CONSTRAINT "petshop_pickups_appointment_id_sch_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."sch_appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petshop_pickups" ADD CONSTRAINT "petshop_pickups_picked_up_by_users_id_fk" FOREIGN KEY ("picked_up_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bakery_item_details_order_idx" ON "bakery_item_details" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "beauty_commission_lines_service_key" ON "beauty_commission_lines" USING btree ("appointment_service_id");--> statement-breakpoint
CREATE INDEX "beauty_commission_lines_appointment_idx" ON "beauty_commission_lines" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "beauty_commission_lines_payout_idx" ON "beauty_commission_lines" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "beauty_commission_payouts_period_idx" ON "beauty_commission_payouts" USING btree ("tenant_id","period_from");--> statement-breakpoint
CREATE INDEX "cons_assembly_corrections_assembly_idx" ON "cons_assembly_corrections" USING btree ("assembly_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vet_vaccines_name_key" ON "vet_vaccines" USING btree ("tenant_id","name_key");--> statement-breakpoint
ALTER TABLE "aes_lot_usages" ADD CONSTRAINT "aes_lot_usages_reversal_of_aes_lot_usages_id_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."aes_lot_usages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aes_packages" ADD CONSTRAINT "aes_packages_case_id_aes_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."aes_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_quotas" ADD CONSTRAINT "cons_quotas_contemplated_assembly_id_cons_assemblies_id_fk" FOREIGN KEY ("contemplated_assembly_id") REFERENCES "public"."cons_assemblies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_terminations" ADD CONSTRAINT "hr_terminations_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_deadlines" ADD CONSTRAINT "legal_deadlines_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD CONSTRAINT "legal_updates_deadline_id_legal_deadlines_id_fk" FOREIGN KEY ("deadline_id") REFERENCES "public"."legal_deadlines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD CONSTRAINT "legal_updates_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_updates" ADD CONSTRAINT "legal_updates_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vet_vaccinations" ADD CONSTRAINT "vet_vaccinations_vaccine_id_vet_vaccines_id_fk" FOREIGN KEY ("vaccine_id") REFERENCES "public"."vet_vaccines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cons_assemblies_no_admin_key" ON "cons_assemblies" USING btree ("tenant_id","group_code","held_on") WHERE connection_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "vet_vaccinations_once" ON "vet_vaccinations" USING btree ("pet_id","vaccine_id","applied_on") WHERE voided_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "cons_assemblies_key" ON "cons_assemblies" USING btree ("tenant_id","connection_id","group_code","held_on") WHERE connection_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_terminations_employee_key" ON "hr_terminations" USING btree ("tenant_id","employee_id") WHERE cancelled_at is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bakery_item_details" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "beauty_commission_lines" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "beauty_commission_payouts" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_assembly_corrections" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "petshop_pickups" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "vet_vaccines" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- Backfills e regras manuais (não saem do drizzle-kit).

-- Assembleias antigas: preenche quando o código do grupo (comparado sem zeros à esquerda, espaços e
-- caixa) pertence a uma só administradora da empresa. As ambíguas ficam vazias e a administradora é
-- pedida na próxima correção.
WITH known AS (
  SELECT tenant_id, connection_id, regexp_replace(upper(regexp_replace(group_code, '\s+', '', 'g')), '^0+(?=.)', '') AS code FROM cons_groups
  UNION
  SELECT q.tenant_id, p.connection_id, regexp_replace(upper(regexp_replace(q.group_code, '\s+', '', 'g')), '^0+(?=.)', '')
  FROM cons_quotas q JOIN cons_plans p ON p.id = q.plan_id
  WHERE q.group_code IS NOT NULL
), single AS (
  SELECT tenant_id, code, min(connection_id::text)::uuid AS connection_id FROM known GROUP BY tenant_id, code HAVING count(DISTINCT connection_id) = 1
)
UPDATE cons_assemblies a SET connection_id = s.connection_id
FROM single s
WHERE s.tenant_id = a.tenant_id AND s.code = regexp_replace(upper(regexp_replace(a.group_code, '\s+', '', 'g')), '^0+(?=.)', '');--> statement-breakpoint

-- Consórcio: qual assembleia contemplou as cotas já contempladas.

UPDATE cons_quotas q SET contemplated_assembly_id = a.id
FROM cons_assemblies a, cons_plans p
WHERE q.status = 'contemplated'
  AND p.id = q.plan_id
  AND a.tenant_id = q.tenant_id
  AND a.status = 'held'
  AND a.held_on = q.contemplated_on
  AND (a.connection_id IS NULL OR a.connection_id = p.connection_id)
  AND regexp_replace(upper(regexp_replace(a.group_code, '\s+', '', 'g')), '^0+(?=.)', '') = regexp_replace(upper(regexp_replace(q.group_code, '\s+', '', 'g')), '^0+(?=.)', '');--> statement-breakpoint

-- O histórico das correções é só de inclusão.

REVOKE UPDATE, DELETE, TRUNCATE ON "cons_assembly_corrections" FROM app_user;--> statement-breakpoint

-- ---- Imobiliária: repasse com baixa no contrato (aviso quando o aluguel não foi recebido) ---------
-- O repasse deixa de ter baixa pela tela do financeiro. Os já pagos ficam como estão.
UPDATE fin_entries SET settle_in_finance = false
WHERE kind = 'expense' AND status = 'pending' AND source_type IN ('real_estate_lease', 'real_estate_lease_extra');--> statement-breakpoint

-- ---- Rastreio de lote: o estorno de ficha retificada é uma linha nova, de quantidade negativa ------
-- A tabela continua só de inclusão (REVOKE da 0022): a correção nunca altera a linha antiga.
ALTER TABLE "aes_lot_usages" DROP CONSTRAINT IF EXISTS "aes_lot_usages_amount_chk";--> statement-breakpoint
ALTER TABLE "aes_lot_usages" ADD CONSTRAINT "aes_lot_usages_amount_chk" CHECK (amount >= 0 OR reversal_of IS NOT NULL);--> statement-breakpoint

-- ---- Agendamento online: Audiência e Diligência saem do link dos escritórios -----------------------
-- Até agora todo serviço nascia liberado. Decisão conservadora: quem quiser que o visitante marque
-- liga de novo em Serviços da agenda. Os demais serviços dos outros ramos ficam como estão.
UPDATE sch_services s
SET online = false
FROM tenant_modules m
WHERE m.tenant_id = s.tenant_id
  AND m.module_key = 'legal'
  AND m.status = 'active'
  AND s.online
  AND (s.name ILIKE 'audi%ncia%' OR s.name ILIKE 'dilig%ncia%');--> statement-breakpoint

-- ---- Ortodontia: o serviço de instalação passa a ser reconhecido pela categoria --------------------
UPDATE sch_services s
SET category = 'Instalação'
FROM tenant_modules m
WHERE m.tenant_id = s.tenant_id
  AND m.module_key = 'orthodontics'
  AND m.status = 'active'
  AND s.name ILIKE 'instala%o de aparelho'
  AND s.category IS DISTINCT FROM 'Instalação';--> statement-breakpoint

-- ---- Agenda: linhas já cobertas por pacote ou tratamento não mudam de valor à mão ------------------
UPDATE sch_appointment_services
SET covered = true
WHERE NOT covered
  AND price = 0
  AND (name LIKE '%(pacote %/%)' OR name LIKE '%(no tratamento)');--> statement-breakpoint

-- ---- Salão: grava o percentual atual nos atendimentos já concluídos --------------------------------
-- Daqui em diante, mudar o percentual não recalcula o passado.
INSERT INTO beauty_commission_lines (id, tenant_id, appointment_service_id, appointment_id, resource_id, service_id, rate, commission)
SELECT gen_random_uuid(), l.tenant_id, l.id, a.id, a.resource_id, l.service_id, r.rate, round(l.price * r.rate / 100, 2)
FROM sch_appointment_services l
JOIN sch_appointments a ON a.id = l.appointment_id AND a.status = 'done'
JOIN tenant_modules m ON m.tenant_id = l.tenant_id AND m.module_key = 'beauty' AND m.status = 'active'
CROSS JOIN LATERAL (
  SELECT coalesce(
    (SELECT c.rate FROM beauty_commission_rules c WHERE c.resource_id = a.resource_id AND c.service_id = l.service_id),
    (SELECT c.rate FROM beauty_commission_rules c WHERE c.resource_id = a.resource_id AND c.service_id IS NULL),
    0
  ) AS rate
) r
ON CONFLICT (appointment_service_id) DO NOTHING;--> statement-breakpoint

-- ---- Advocacia: andamentos gerados pelo sistema ---------------------------------------------------
UPDATE legal_updates
SET auto = true
WHERE NOT auto
  AND (description LIKE 'Prazo cumprido: %' OR description LIKE 'Situação alterada para: %' OR description LIKE 'Êxito registrado: %');--> statement-breakpoint

-- Liga "Prazo cumprido" ao prazo, para o Reabrir saber qual andamento retirar (o mais recente de cada um).
UPDATE legal_updates u
SET deadline_id = d.id
FROM legal_deadlines d
WHERE u.deadline_id IS NULL
  AND u.case_id = d.case_id
  AND d.status = 'done'
  AND u.description = 'Prazo cumprido: ' || d.title
  AND u.id = (
    SELECT x.id FROM legal_updates x
    WHERE x.case_id = d.case_id AND x.description = u.description
    ORDER BY x.created_at DESC LIMIT 1
  );--> statement-breakpoint

-- ---- Estética: depilação dos exemplos básicos em quem já tinha ligado o laser ----------------------
-- Quem liga o laser daqui em diante recebe isso na hora; aqui só os que ligaram antes.
UPDATE sch_services s
SET requires_room = true
FROM sch_resources r
WHERE r.tenant_id = s.tenant_id
  AND r.kind = 'room'
  AND r.name = 'Laser de diodo (equipamento)'
  AND lower(s.name) = lower('Depilação a laser (área pequena)')
  AND NOT s.requires_room;--> statement-breakpoint

INSERT INTO sch_service_resources (tenant_id, service_id, resource_id)
SELECT s.tenant_id, s.id, r.id
FROM sch_services s
JOIN sch_resources r ON r.tenant_id = s.tenant_id AND r.kind = 'room' AND r.name = 'Laser de diodo (equipamento)'
WHERE lower(s.name) = lower('Depilação a laser (área pequena)')
ON CONFLICT DO NOTHING;

-- Lavanderia: `pricingMode` saiu (sem uso: quem define a cobrança é cada serviço) e `requirePhotosOnReceive`
-- virou `requirePiecePhotos`, desligado por padrão. A leitura já ignora as chaves antigas; isto só limpa.
UPDATE "tenant_modules"
SET "settings" = "settings" - 'pricingMode' - 'requirePhotosOnReceive'
WHERE "module_key" = 'laundry' AND "settings" IS NOT NULL;
