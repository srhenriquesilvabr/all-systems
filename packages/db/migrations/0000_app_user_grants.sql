-- A aplicação conecta como app_user (sem superuser/BYPASSRLS), então as políticas de RLS
-- valem para ela. As migrations rodam com o dono do schema; as tabelas criadas a partir
-- daqui recebem as permissões abaixo automaticamente.
-- O papel app_user é criado fora das migrations (docker/postgres/init.sql em dev; IaC em produção).
GRANT USAGE ON SCHEMA public TO app_user;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
