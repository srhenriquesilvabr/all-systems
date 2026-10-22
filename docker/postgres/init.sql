-- Papel usado pela aplicação. Não é superuser nem tem BYPASSRLS:
-- é isso que faz as políticas de Row-Level Security valerem.
-- As permissões nas tabelas são concedidas pelas migrations.
CREATE ROLE app_user LOGIN PASSWORD 'app_user' NOSUPERUSER NOBYPASSRLS;

CREATE DATABASE allsystems_test;
