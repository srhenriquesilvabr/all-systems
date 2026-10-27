-- Sanidade que o banco garante mesmo se a validação da API falhar.
ALTER TABLE sales_products ADD CONSTRAINT sales_products_price_check CHECK (price >= 0);--> statement-breakpoint
ALTER TABLE sales_items ADD CONSTRAINT sales_items_quantity_check CHECK (quantity > 0);--> statement-breakpoint
ALTER TABLE sales_sales ADD CONSTRAINT sales_sales_total_check CHECK (total >= 0 AND discount >= 0 AND discount <= subtotal);--> statement-breakpoint
ALTER TABLE legal_deadlines ADD CONSTRAINT legal_deadlines_alert_days_check CHECK (alert_days BETWEEN 0 AND 30);--> statement-breakpoint
ALTER TABLE legal_fees ADD CONSTRAINT legal_fees_success_percent_check CHECK (success_percent IS NULL OR (success_percent > 0 AND success_percent <= 100));
