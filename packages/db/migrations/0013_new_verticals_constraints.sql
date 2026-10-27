-- Sanidade que o banco garante mesmo se a validação da API falhar.
ALTER TABLE veh_vehicles ADD CONSTRAINT veh_vehicles_price_check CHECK (price > 0 AND km >= 0);--> statement-breakpoint
ALTER TABLE veh_deals ADD CONSTRAINT veh_deals_amounts_check CHECK (price > 0 AND discount >= 0 AND down_payment >= 0);--> statement-breakpoint
ALTER TABLE re_deals ADD CONSTRAINT re_deals_amounts_check CHECK (price > 0 AND down_payment >= 0 AND fgts_amount >= 0 AND down_payment + fgts_amount <= price);--> statement-breakpoint
ALTER TABLE cons_plans ADD CONSTRAINT cons_plans_values_check CHECK (credit_value > 0 AND term_months > 0);--> statement-breakpoint
ALTER TABLE hr_employees ADD CONSTRAINT hr_employees_salary_check CHECK (salary > 0 AND weekly_hours BETWEEN 1 AND 44);--> statement-breakpoint
ALTER TABLE hr_vacations ADD CONSTRAINT hr_vacations_days_check CHECK (days >= 5 AND days <= 30 AND sold_days BETWEEN 0 AND 10);--> statement-breakpoint
ALTER TABLE acc_clients ADD CONSTRAINT acc_clients_fee_check CHECK (monthly_fee >= 0 AND fee_due_day BETWEEN 1 AND 28);
