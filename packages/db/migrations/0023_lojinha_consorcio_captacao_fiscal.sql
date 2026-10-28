CREATE TABLE "store_listing_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_listing_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_listings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"visible" boolean DEFAULT false NOT NULL,
	"title" text,
	"description" text DEFAULT '' NOT NULL,
	"category" text,
	"featured" boolean DEFAULT false NOT NULL,
	"promo_price" numeric(12, 2),
	"promo_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_listings_promo_chk" CHECK (promo_price is null or promo_price > 0)
);
--> statement-breakpoint
ALTER TABLE "store_listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_order_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text,
	"text" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_order_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"regular_price" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	CONSTRAINT "store_order_items_quantity_chk" CHECK (quantity > 0)
);
--> statement-breakpoint
ALTER TABLE "store_order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"source" text DEFAULT 'public' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"customer_email" text,
	"customer_id" uuid,
	"fulfillment" text NOT NULL,
	"address" jsonb,
	"payment_mode" text NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"payment_reference" text,
	"payment_method" text,
	"subtotal" numeric(12, 2) NOT NULL,
	"delivery_fee" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"notes" text,
	"consent" jsonb,
	"ip_hash" text,
	"sale_id" uuid,
	"cancel_reason" text,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_orders_total_chk" CHECK (total = subtotal + delivery_fee and subtotal >= 0 and delivery_fee >= 0),
	CONSTRAINT "store_orders_completed_chk" CHECK (status <> 'completed' or sale_id is not null),
	CONSTRAINT "store_orders_cancelled_chk" CHECK (status <> 'cancelled' or cancel_reason is not null),
	CONSTRAINT "store_orders_address_chk" CHECK (fulfillment <> 'delivery' or address is not null or customer_phone is null)
);
--> statement-breakpoint
ALTER TABLE "store_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cb_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document" text NOT NULL,
	"document_type" text NOT NULL,
	"subject_name" text NOT NULL,
	"customer_id" uuid,
	"purpose" text NOT NULL,
	"method" text NOT NULL,
	"given_at" date NOT NULL,
	"evidence" text,
	"text" text NOT NULL,
	"version" text NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cb_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cb_queries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"document" text NOT NULL,
	"document_type" text NOT NULL,
	"subject_name" text NOT NULL,
	"customer_id" uuid,
	"source_type" text,
	"source_id" uuid,
	"provider" text NOT NULL,
	"simulated" boolean NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"external_id" text,
	"score" integer,
	"risk_band" text,
	"summary" jsonb,
	"cost" numeric(10, 2) DEFAULT '0' NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"queried_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cb_queries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fiscal_certificates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"password_enc" text NOT NULL,
	"subject_name" text NOT NULL,
	"subject_document" text,
	"issuer_name" text NOT NULL,
	"serial_number" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_alert_days" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiscal_certificates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fiscal_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"text" text NOT NULL,
	"protocol" text,
	"xml_file_id" uuid,
	"pdf_file_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiscal_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fiscal_document_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text,
	"message" text,
	"source" text NOT NULL,
	"payload" jsonb,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiscal_document_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fiscal_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"environment" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reference" text NOT NULL,
	"series" text,
	"number" integer,
	"access_key" text,
	"verification_code" text,
	"protocol" text,
	"source_type" text NOT NULL,
	"source_id" text,
	"source_label" text,
	"customer_id" uuid,
	"recipient" jsonb,
	"items" jsonb NOT NULL,
	"payments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxes" jsonb NOT NULL,
	"nature" text NOT NULL,
	"additional_info" text,
	"service_date" text,
	"issued_at" timestamp with time zone,
	"authorized_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"status_code" text,
	"status_message" text,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contingency" boolean DEFAULT false NOT NULL,
	"transmitted_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"xml_file_id" uuid,
	"pdf_file_id" uuid,
	"cancel_xml_file_id" uuid,
	"remote_files" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consult_url" text,
	"qr_code_url" text,
	"delivery" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_documents_total_chk" CHECK (total >= 0)
);
--> statement-breakpoint
ALTER TABLE "fiscal_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fiscal_product_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"ncm" text NOT NULL,
	"cfop" text NOT NULL,
	"cest" text,
	"origin" smallint DEFAULT 0 NOT NULL,
	"icms_situation" text NOT NULL,
	"icms_rate" numeric(5, 2),
	"pis_cofins_cst" text,
	"pis_rate" numeric(5, 2),
	"cofins_rate" numeric(5, 2),
	"tax_unit" text NOT NULL,
	"ibs_cbs_cst" text,
	"class_trib" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_product_codes_ncm_chk" CHECK (ncm ~ '^[0-9]{8}$'),
	CONSTRAINT "fiscal_product_codes_cfop_chk" CHECK (cfop ~ '^[5-7][0-9]{3}$'),
	CONSTRAINT "fiscal_product_codes_origin_chk" CHECK (origin between 0 and 8)
);
--> statement-breakpoint
ALTER TABLE "fiscal_product_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fiscal_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"environment" text NOT NULL,
	"series" text NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_series_next_chk" CHECK (next_number > 0)
);
--> statement-breakpoint
ALTER TABLE "fiscal_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fiscal_service_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text NOT NULL,
	"service_name" text NOT NULL,
	"lc116" text NOT NULL,
	"national_code" text,
	"nbs" text,
	"municipal_code" text,
	"iss_rate" numeric(5, 2) NOT NULL,
	"iss_withheld" boolean DEFAULT false NOT NULL,
	"cnae" text,
	"ibs_cbs_cst" text,
	"class_trib" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_service_codes_lc116_chk" CHECK (lc116 ~ '^[0-9]{2}\.[0-9]{2}$'),
	CONSTRAINT "fiscal_service_codes_iss_chk" CHECK (iss_rate between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "fiscal_service_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fiscal_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"label" text NOT NULL,
	"customer_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"document_id" uuid,
	"auto_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiscal_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fiscal_voids" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"environment" text NOT NULL,
	"series" text NOT NULL,
	"number_from" integer NOT NULL,
	"number_to" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"protocol" text,
	"xml_file_id" uuid,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_voids_range_chk" CHECK (number_to >= number_from)
);
--> statement-breakpoint
ALTER TABLE "fiscal_voids" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_lead_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mode" text DEFAULT 'simulated' NOT NULL,
	"page_id" text,
	"form_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"access_token_enc" text,
	"webhook_key_enc" text,
	"asset_type" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_lead_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_lead_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_lead_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"data" jsonb,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_lead_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_lead_routes" (
	"channel_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"page_id" text
);
--> statement-breakpoint
CREATE TABLE "cons_lead_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"assigned_to" uuid,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_lead_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"city" text,
	"state" text,
	"asset_type" text,
	"credit_value" numeric(14, 2),
	"term_months" integer,
	"estimated_installment" numeric(14, 2),
	"source" text NOT NULL,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"campaign" text,
	"form_id" text,
	"ad_id" text,
	"external_id" text,
	"channel_id" uuid,
	"referrer_id" uuid,
	"reward_status" text DEFAULT 'none' NOT NULL,
	"reward_amount" numeric(14, 2),
	"reward_paid_at" timestamp with time zone,
	"status" text DEFAULT 'new' NOT NULL,
	"lost_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seller_id" uuid,
	"assigned_at" timestamp with time zone,
	"customer_id" uuid,
	"quota_id" uuid,
	"contact_basis" text NOT NULL,
	"consent" jsonb,
	"ip_hash" text,
	"notes" text,
	"created_by" uuid,
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cons_referrers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"customer_id" uuid,
	"user_id" uuid,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cons_referrers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "catalog_key" text;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "adapter" text DEFAULT 'generic_rest' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD COLUMN "manual_plans" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "store_listing_photos" ADD CONSTRAINT "store_listing_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_listing_photos" ADD CONSTRAINT "store_listing_photos_listing_id_store_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."store_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_listing_photos" ADD CONSTRAINT "store_listing_photos_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_listings" ADD CONSTRAINT "store_listings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_listings" ADD CONSTRAINT "store_listings_product_id_sales_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."sales_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_events" ADD CONSTRAINT "store_order_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_events" ADD CONSTRAINT "store_order_events_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_events" ADD CONSTRAINT "store_order_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_order_id_store_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."store_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_items" ADD CONSTRAINT "store_order_items_product_id_sales_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."sales_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_sale_id_sales_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cb_consents" ADD CONSTRAINT "cb_consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cb_consents" ADD CONSTRAINT "cb_consents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cb_consents" ADD CONSTRAINT "cb_consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cb_queries" ADD CONSTRAINT "cb_queries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cb_queries" ADD CONSTRAINT "cb_queries_consent_id_cb_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."cb_consents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cb_queries" ADD CONSTRAINT "cb_queries_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cb_queries" ADD CONSTRAINT "cb_queries_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cb_queries" ADD CONSTRAINT "cb_queries_queried_by_users_id_fk" FOREIGN KEY ("queried_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_certificates" ADD CONSTRAINT "fiscal_certificates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_corrections" ADD CONSTRAINT "fiscal_corrections_document_id_fiscal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_corrections" ADD CONSTRAINT "fiscal_corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_document_events" ADD CONSTRAINT "fiscal_document_events_document_id_fiscal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_document_events" ADD CONSTRAINT "fiscal_document_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_sources" ADD CONSTRAINT "fiscal_sources_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_voids" ADD CONSTRAINT "fiscal_voids_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_lead_channels" ADD CONSTRAINT "cons_lead_channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_lead_events" ADD CONSTRAINT "cons_lead_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_lead_events" ADD CONSTRAINT "cons_lead_events_lead_id_cons_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."cons_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_lead_events" ADD CONSTRAINT "cons_lead_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_lead_routes" ADD CONSTRAINT "cons_lead_routes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_lead_tasks" ADD CONSTRAINT "cons_lead_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_lead_tasks" ADD CONSTRAINT "cons_lead_tasks_lead_id_cons_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."cons_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_lead_tasks" ADD CONSTRAINT "cons_lead_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_lead_tasks" ADD CONSTRAINT "cons_lead_tasks_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_lead_tasks" ADD CONSTRAINT "cons_lead_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_leads" ADD CONSTRAINT "cons_leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_leads" ADD CONSTRAINT "cons_leads_referrer_id_cons_referrers_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."cons_referrers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_leads" ADD CONSTRAINT "cons_leads_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_leads" ADD CONSTRAINT "cons_leads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_leads" ADD CONSTRAINT "cons_leads_quota_id_cons_quotas_id_fk" FOREIGN KEY ("quota_id") REFERENCES "public"."cons_quotas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_leads" ADD CONSTRAINT "cons_leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_referrers" ADD CONSTRAINT "cons_referrers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_referrers" ADD CONSTRAINT "cons_referrers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cons_referrers" ADD CONSTRAINT "cons_referrers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_listing_photos_file_key" ON "store_listing_photos" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "store_listing_photos_listing_idx" ON "store_listing_photos" USING btree ("listing_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "store_listings_product_key" ON "store_listings" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "store_listings_visible_idx" ON "store_listings" USING btree ("tenant_id","visible");--> statement-breakpoint
CREATE INDEX "store_order_events_order_idx" ON "store_order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "store_order_items_order_idx" ON "store_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "store_order_items_product_idx" ON "store_order_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_orders_number_key" ON "store_orders" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "store_orders_status_idx" ON "store_orders" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "store_orders_phone_idx" ON "store_orders" USING btree ("tenant_id","customer_phone","created_at");--> statement-breakpoint
CREATE INDEX "store_orders_ip_idx" ON "store_orders" USING btree ("tenant_id","ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "store_orders_customer_idx" ON "store_orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "cb_consents_document_idx" ON "cb_consents" USING btree ("tenant_id","document");--> statement-breakpoint
CREATE INDEX "cb_queries_created_idx" ON "cb_queries" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "cb_queries_document_idx" ON "cb_queries" USING btree ("tenant_id","document","created_at");--> statement-breakpoint
CREATE INDEX "cb_queries_source_idx" ON "cb_queries" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_certificates_active_key" ON "fiscal_certificates" USING btree ("tenant_id") WHERE active;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_corrections_seq_key" ON "fiscal_corrections" USING btree ("document_id","sequence");--> statement-breakpoint
CREATE INDEX "fiscal_document_events_doc_idx" ON "fiscal_document_events" USING btree ("document_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_documents_reference_key" ON "fiscal_documents" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_documents_number_key" ON "fiscal_documents" USING btree ("tenant_id","type","environment","series","number") WHERE number is not null;--> statement-breakpoint
CREATE INDEX "fiscal_documents_source_idx" ON "fiscal_documents" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "fiscal_documents_status_idx" ON "fiscal_documents" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "fiscal_documents_issued_idx" ON "fiscal_documents" USING btree ("tenant_id","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_product_codes_product_key" ON "fiscal_product_codes" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_series_key" ON "fiscal_series" USING btree ("tenant_id","type","environment");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_service_codes_ref_key" ON "fiscal_service_codes" USING btree ("tenant_id","ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_sources_key" ON "fiscal_sources" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "fiscal_sources_status_idx" ON "fiscal_sources" USING btree ("tenant_id","status","occurred_at");--> statement-breakpoint
CREATE INDEX "fiscal_voids_series_idx" ON "fiscal_voids" USING btree ("tenant_id","type","environment","series");--> statement-breakpoint
CREATE INDEX "cons_lead_events_lead_idx" ON "cons_lead_events" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cons_lead_routes_page_key" ON "cons_lead_routes" USING btree ("page_id") WHERE page_id is not null;--> statement-breakpoint
CREATE INDEX "cons_lead_tasks_open_idx" ON "cons_lead_tasks" USING btree ("tenant_id","assigned_to","due_at") WHERE done_at is null;--> statement-breakpoint
CREATE INDEX "cons_lead_tasks_lead_idx" ON "cons_lead_tasks" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cons_leads_number_key" ON "cons_leads" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "cons_leads_external_key" ON "cons_leads" USING btree ("tenant_id","source","external_id") WHERE external_id is not null;--> statement-breakpoint
CREATE INDEX "cons_leads_status_idx" ON "cons_leads" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "cons_leads_seller_idx" ON "cons_leads" USING btree ("tenant_id","seller_id","status");--> statement-breakpoint
CREATE INDEX "cons_leads_phone_idx" ON "cons_leads" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "cons_leads_source_idx" ON "cons_leads" USING btree ("tenant_id","source","created_at");--> statement-breakpoint
CREATE INDEX "cons_leads_quota_idx" ON "cons_leads" USING btree ("quota_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cons_referrers_code_key" ON "cons_referrers" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "cons_referrers_customer_key" ON "cons_referrers" USING btree ("tenant_id","customer_id") WHERE customer_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cons_referrers_user_key" ON "cons_referrers" USING btree ("tenant_id","user_id") WHERE user_id is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_listing_photos" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_listings" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_order_events" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_order_items" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_orders" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cb_consents" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cb_queries" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_certificates" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_corrections" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_document_events" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_documents" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_product_codes" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_series" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_service_codes" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_sources" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_voids" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_lead_channels" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_lead_events" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_lead_tasks" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_leads" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cons_referrers" AS PERMISSIVE FOR ALL TO public USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- Lojinha: o histórico do pedido é só inclusão, como a auditoria.
REVOKE UPDATE, DELETE, TRUNCATE ON "store_order_events" FROM app_user;--> statement-breakpoint

-- Nota fiscal: guarda legal e checagens.
-- Guarda legal (5 anos): a aplicação nunca apaga nota, histórico, carta de correção nem inutilização.
-- O histórico é só de inclusão (como a auditoria); notas mudam de status, mas não somem.
REVOKE DELETE, TRUNCATE ON "fiscal_documents" FROM app_user;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "fiscal_document_events" FROM app_user;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "fiscal_corrections" FROM app_user;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "fiscal_voids" FROM app_user;--> statement-breakpoint

-- Sanidade dos valores fechados (o schema TS já restringe; o banco garante).
ALTER TABLE "fiscal_documents" DROP CONSTRAINT IF EXISTS "fiscal_documents_type_chk";--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_type_chk" CHECK (type in ('nfse', 'nfce', 'nfe'));--> statement-breakpoint
ALTER TABLE "fiscal_documents" DROP CONSTRAINT IF EXISTS "fiscal_documents_status_chk";--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_status_chk" CHECK (status in ('draft', 'sending', 'authorized', 'rejected', 'denied', 'cancelled', 'discarded'));--> statement-breakpoint
ALTER TABLE "fiscal_documents" DROP CONSTRAINT IF EXISTS "fiscal_documents_environment_chk";--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_environment_chk" CHECK (environment in ('homologation', 'production'));--> statement-breakpoint
-- Autorizada ou cancelada sempre tem data de emissão (relatórios do contador filtram por ela).
ALTER TABLE "fiscal_documents" DROP CONSTRAINT IF EXISTS "fiscal_documents_issued_chk";--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_issued_chk" CHECK (status not in ('sending', 'authorized', 'cancelled', 'denied') or issued_at is not null);--> statement-breakpoint
ALTER TABLE "fiscal_sources" DROP CONSTRAINT IF EXISTS "fiscal_sources_status_chk";--> statement-breakpoint
ALTER TABLE "fiscal_sources" ADD CONSTRAINT "fiscal_sources_status_chk" CHECK (status in ('pending', 'ready', 'cancelled'));--> statement-breakpoint
ALTER TABLE "fiscal_corrections" DROP CONSTRAINT IF EXISTS "fiscal_corrections_sequence_chk";--> statement-breakpoint
ALTER TABLE "fiscal_corrections" ADD CONSTRAINT "fiscal_corrections_sequence_chk" CHECK (sequence between 1 and 20);
