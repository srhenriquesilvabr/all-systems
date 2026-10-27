-- Agenda: o mesmo profissional não pode ter dois atendimentos sobrepostos. A regra fica no
-- banco (e não só na aplicação) para valer também entre duas marcações feitas ao mesmo tempo.
-- Atendimentos cancelados ou em que o cliente faltou liberam o horário.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "sch_appointments" ADD CONSTRAINT "sch_appointments_no_overlap"
  EXCLUDE USING gist ("tenant_id" WITH =, "resource_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("status" NOT IN ('cancelled', 'no_show'));--> statement-breakpoint
ALTER TABLE "sch_appointments" ADD CONSTRAINT "sch_appointments_valid_range" CHECK ("ends_at" > "starts_at");--> statement-breakpoint

-- Jobs de plataforma (ex.: lembretes) precisam saber quais empresas usam um módulo, sem
-- enxergar mais nada delas: a função roda como dona das tabelas e devolve só os ids.
CREATE OR REPLACE FUNCTION tenants_with_module(p_key text)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tm.tenant_id
  FROM tenant_modules tm
  JOIN tenants t ON t.id = tm.tenant_id
  WHERE tm.module_key = p_key AND tm.status = 'active' AND t.status <> 'cancelled'
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION tenants_with_module(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tenants_with_module(text) TO app_user;
