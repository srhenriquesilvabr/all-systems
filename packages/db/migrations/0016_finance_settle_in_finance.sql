ALTER TABLE "fin_entries" ADD COLUMN "settle_in_finance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Lançamentos já criados por módulos sem fluxo de pagamento próprio (parcelas, honorários,
-- folha, férias, comissões): passam a receber baixa no financeiro, como os novos.
UPDATE "fin_entries" SET "settle_in_finance" = true
WHERE "source_type" IN ('legal_fee', 'acc_fee', 'hr_vacation', 'hr_payroll', 'ortho_treatment', 'ortho_entry_fee', 'aes_package', 'consortium_quota', 'real_estate_deal', 'vehicle_deal');
