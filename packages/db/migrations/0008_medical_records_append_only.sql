-- Prontuário é só inclusão: nem a aplicação consegue alterar ou apagar registros e o log de
-- acesso. Corrigir um registro é incluir uma retificação (mr_entries.amends_id).
REVOKE UPDATE, DELETE, TRUNCATE ON mr_entries FROM app_user;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON mr_access_log FROM app_user;--> statement-breakpoint
-- Sanidade dos contratos: pacote com sessões e vencimento que existe em todo mês.
ALTER TABLE aes_packages ADD CONSTRAINT aes_packages_sessions_check CHECK (total_sessions > 0);--> statement-breakpoint
ALTER TABLE ortho_treatments ADD CONSTRAINT ortho_treatments_due_day_check CHECK (due_day BETWEEN 1 AND 28);
