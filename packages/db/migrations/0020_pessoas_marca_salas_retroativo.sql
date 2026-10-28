CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"cpf" text,
	"rg" text,
	"birth_date" date,
	"email" text,
	"phone" text,
	"address" jsonb,
	"photo_file_id" uuid,
	"linkedin_url" text,
	"resume_file_id" uuid,
	"started_on" date,
	"ended_on" date,
	"end_notified_at" timestamp with time zone,
	"user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "sales_register_sessions_open_key";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "state_registration" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "municipal_registration" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "instagram" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address" jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_file_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "brand_color" text;--> statement-breakpoint
ALTER TABLE "sales_register_moves" ADD COLUMN "occurred_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_register_sessions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sch_resources" ADD COLUMN "team_member_id" uuid;--> statement-breakpoint
ALTER TABLE "laundry_logistics_jobs" ADD COLUMN "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_photo_file_id_files_id_fk" FOREIGN KEY ("photo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_resume_file_id_files_id_fk" FOREIGN KEY ("resume_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_tenant_cpf_key" ON "team_members" USING btree ("tenant_id","cpf") WHERE cpf is not null;--> statement-breakpoint
CREATE INDEX "team_members_tenant_name_idx" ON "team_members" USING btree ("tenant_id","first_name","last_name");--> statement-breakpoint
CREATE INDEX "team_members_tenant_user_idx" ON "team_members" USING btree ("tenant_id","user_id");--> statement-breakpoint
ALTER TABLE "sch_resources" ADD CONSTRAINT "sch_resources_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_register_sessions_register_idx" ON "sales_register_sessions" USING btree ("register_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sch_resources_team_member_key" ON "sch_resources" USING btree ("tenant_id","team_member_id") WHERE team_member_id is not null;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_brand_color_chk" CHECK (brand_color ~ '^#[0-9a-f]{6}$');--> statement-breakpoint
ALTER TABLE "sales_register_sessions" ADD CONSTRAINT "sales_register_sessions_period_chk" CHECK (closed_at is null or closed_at >= opened_at);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "team_members" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- Pessoas da equipe: profissionais e colaboradores viram pessoas (team_members). A remoção dos
-- dados pessoais duplicados do hr_employees fica na 0021, depois deste preenchimento.
-- 1. Profissionais da agenda: cada um vira uma pessoa ("Ana Maria Lima" → nome "Ana", sobrenome
--    "Maria Lima"; o login do profissional, se houver, vira o login da pessoa).
CREATE TEMP TABLE "_pessoas_profissionais" AS
  SELECT r."id" AS resource_id, gen_random_uuid() AS member_id, r."tenant_id", btrim(regexp_replace(r."name", '\s+', ' ', 'g')) AS full_name, r."user_id", r."created_at"
  FROM "sch_resources" r
  WHERE r."kind" = 'professional' AND r."team_member_id" IS NULL;--> statement-breakpoint
INSERT INTO "team_members" ("id", "tenant_id", "first_name", "last_name", "user_id", "created_at", "updated_at")
  SELECT p.member_id, p."tenant_id", split_part(p.full_name, ' ', 1), nullif(btrim(substr(p.full_name, length(split_part(p.full_name, ' ', 1)) + 1)), ''), p."user_id", p."created_at", now()
  FROM "_pessoas_profissionais" p;--> statement-breakpoint
UPDATE "sch_resources" r SET "team_member_id" = p.member_id FROM "_pessoas_profissionais" p WHERE r."id" = p.resource_id;--> statement-breakpoint
DROP TABLE "_pessoas_profissionais";--> statement-breakpoint

-- 2. Colaboradores do RH: a coluna nova entra sem NOT NULL para ser preenchida.
ALTER TABLE "hr_employees" ADD COLUMN "team_member_id" uuid;--> statement-breakpoint

-- 2a. Já existe pessoa com o mesmo CPF na empresa: vincula e completa o que faltar nela
--     (início na empresa = a data mais antiga entre o cadastro e a admissão).
UPDATE "hr_employees" e SET "team_member_id" = m."id"
  FROM "team_members" m
  WHERE m."tenant_id" = e."tenant_id" AND m."cpf" = regexp_replace(e."cpf", '\D', '', 'g') AND e."team_member_id" IS NULL;--> statement-breakpoint
UPDATE "team_members" m SET
    "birth_date" = coalesce(m."birth_date", e."birth_date"),
    "email" = coalesce(m."email", lower(nullif(btrim(e."email"), ''))),
    "phone" = coalesce(m."phone", nullif(btrim(e."phone"), '')),
    "started_on" = least(coalesce(m."started_on", e."admission_date"), e."admission_date"),
    "ended_on" = coalesce(m."ended_on", e."termination_date"),
    "updated_at" = now()
  FROM "hr_employees" e
  WHERE e."team_member_id" = m."id";--> statement-breakpoint

-- 2b. Os demais: uma pessoa nova com os dados pessoais do colaborador; a admissão vira "início na
--     empresa" e o desligamento, "data de encerramento".
CREATE TEMP TABLE "_pessoas_colaboradores" AS
  SELECT e."id" AS employee_id, gen_random_uuid() AS member_id, btrim(regexp_replace(e."name", '\s+', ' ', 'g')) AS full_name
  FROM "hr_employees" e
  WHERE e."team_member_id" IS NULL;--> statement-breakpoint
INSERT INTO "team_members" ("id", "tenant_id", "first_name", "last_name", "cpf", "birth_date", "email", "phone", "started_on", "ended_on", "created_at", "updated_at")
  SELECT c.member_id, e."tenant_id", split_part(c.full_name, ' ', 1), nullif(btrim(substr(c.full_name, length(split_part(c.full_name, ' ', 1)) + 1)), ''),
         nullif(regexp_replace(e."cpf", '\D', '', 'g'), ''), e."birth_date", lower(nullif(btrim(e."email"), '')), nullif(btrim(e."phone"), ''),
         e."admission_date", e."termination_date", e."created_at", now()
  FROM "_pessoas_colaboradores" c
  JOIN "hr_employees" e ON e."id" = c.employee_id;--> statement-breakpoint
UPDATE "hr_employees" e SET "team_member_id" = c.member_id FROM "_pessoas_colaboradores" c WHERE e."id" = c.employee_id;--> statement-breakpoint
DROP TABLE "_pessoas_colaboradores";--> statement-breakpoint

-- 3. Encerramento já passado: o profissional da pessoa sai da agenda, e o encerramento conta como
--    avisado (o job core.team.endings não precisa publicar core.team.member_ended para essas pessoas).
UPDATE "sch_resources" r SET "active" = false
  FROM "team_members" m
  WHERE r."team_member_id" = m."id" AND r."active" AND m."ended_on" < (now() AT TIME ZONE 'America/Sao_Paulo')::date;--> statement-breakpoint
UPDATE "team_members" SET "end_notified_at" = now()
  WHERE "ended_on" < (now() AT TIME ZONE 'America/Sao_Paulo')::date AND "end_notified_at" IS NULL;--> statement-breakpoint

-- 4. Colaborador = pessoa: NOT NULL, FK e uma pessoa por colaborador (no lugar do CPF único).
ALTER TABLE "hr_employees" ALTER COLUMN "team_member_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_employees_team_member_key" ON "hr_employees" USING btree ("tenant_id","team_member_id");--> statement-breakpoint

-- Datas retroativas no caixa do PDV e na coleta/entrega.
-- Dados que já existem: o registro da sessão é a própria abertura, o movimento aconteceu quando foi
-- lançado e a tentativa que falhou é a última alteração da tarefa. O gatilho de sessão congelada
-- (0018) barraria o UPDATE das sessões fechadas: fica desligado só durante o preenchimento.
ALTER TABLE "sales_register_sessions" DISABLE TRIGGER "sales_register_sessions_frozen";--> statement-breakpoint
UPDATE "sales_register_sessions" SET "created_at" = "opened_at";--> statement-breakpoint
ALTER TABLE "sales_register_sessions" ENABLE TRIGGER "sales_register_sessions_frozen";--> statement-breakpoint
UPDATE "sales_register_moves" SET "occurred_at" = "created_at";--> statement-breakpoint
UPDATE "laundry_logistics_jobs" SET "failed_at" = "updated_at" WHERE "status" = 'failed';--> statement-breakpoint

-- Sessões fechadas do mesmo caixa não se cruzam no tempo (as abertas são conferidas pelo serviço,
-- que trava o caixa na abertura). Antes de rodar, conferir que os dados atuais não se cruzam:
--   select a.id, b.id from sales_register_sessions a join sales_register_sessions b
--     on a.register_id = b.register_id and a.id < b.id and a.status = 'closed' and b.status = 'closed'
--    and tstzrange(a.opened_at, a.closed_at) && tstzrange(b.opened_at, b.closed_at);
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "sales_register_sessions" ADD CONSTRAINT "sales_register_sessions_no_overlap"
  EXCLUDE USING gist ("tenant_id" WITH =, "register_id" WITH =, tstzrange("opened_at", "closed_at") WITH &&)
  WHERE (status = 'closed');--> statement-breakpoint

-- Sessão congelada (ajuste do gatilho da 0018): fechada continua imutável; aberta pode ser fechada
-- com horário passado, mas a abertura (caixa, número, horário, troco, registro) não muda depois de
-- lançada e o fechamento não pode ser no futuro (5 min de folga para o relógio da aplicação).
CREATE OR REPLACE FUNCTION sales_register_session_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Sessão de caixa fechada não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.register_id IS DISTINCT FROM OLD.register_id OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at OR NEW.opening_float IS DISTINCT FROM OLD.opening_float
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A abertura da sessão de caixa não pode ser alterada' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.closed_at IS NOT NULL AND NEW.closed_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'O fechamento do caixa não pode ser no futuro' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- Abertura: nasce aberta e nunca no futuro (a do passado é o caixa lançado depois).
CREATE OR REPLACE FUNCTION sales_register_session_opened() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'open' OR NEW.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Sessão de caixa nasce aberta' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.opened_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'A abertura do caixa não pode ser no futuro' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER sales_register_sessions_opened BEFORE INSERT ON "sales_register_sessions"
  FOR EACH ROW EXECUTE FUNCTION sales_register_session_opened();--> statement-breakpoint

-- Sangria/suprimento só em sessão aberta, dentro do horário dela (da abertura até agora). O limite
-- da sessão seguinte do mesmo caixa fica com o serviço.
CREATE OR REPLACE FUNCTION sales_register_move_in_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s record;
BEGIN
  SELECT status, opened_at INTO s FROM sales_register_sessions WHERE id = NEW.session_id;
  IF s.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Sangria/suprimento só em sessão de caixa aberta' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.occurred_at < s.opened_at OR NEW.occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Sangria/suprimento fora do horário da sessão de caixa' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER sales_register_moves_in_session BEFORE INSERT ON "sales_register_moves"
  FOR EACH ROW EXECUTE FUNCTION sales_register_move_in_session();
