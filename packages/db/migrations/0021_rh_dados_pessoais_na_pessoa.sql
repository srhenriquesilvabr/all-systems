-- Dados pessoais do colaborador já copiados para team_members na 0020.
DROP INDEX "hr_employees_cpf_key";--> statement-breakpoint
ALTER TABLE "hr_employees" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "hr_employees" DROP COLUMN "cpf";--> statement-breakpoint
ALTER TABLE "hr_employees" DROP COLUMN "birth_date";--> statement-breakpoint
ALTER TABLE "hr_employees" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "hr_employees" DROP COLUMN "phone";