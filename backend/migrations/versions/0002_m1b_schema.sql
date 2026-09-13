-- M1B schema: catalog identity, evidence, inventory ledger, sales.
-- GENERATED from the SQLAlchemy models; do not hand-edit.
-- backend/tests/unit/test_m1b_schema_parity.py re-renders the models and
-- fails if this file drifts from them.

CREATE TYPE acquisition_type AS ENUM ('PURCHASE', 'CONSIGNMENT', 'BORROWED', 'TRANSFER', 'RETURN', 'ADJUSTMENT', 'OPENING_BALANCE');
CREATE TYPE alias_evidence_event AS ENUM ('CONFIRM', 'REJECT');
CREATE TYPE alias_status AS ENUM ('NEW', 'LEARNING', 'VERIFIED', 'REJECTED', 'AMBIGUOUS');
CREATE TYPE alias_target_type AS ENUM ('CONCEPT', 'FAMILY', 'VARIANT', 'ATTRIBUTE_TERM', 'SIZE', 'SOURCE');
CREATE TYPE attribute_kind AS ENUM ('COLOR', 'MATERIAL', 'TEXTURE', 'FUR', 'COLLAR', 'OTHER');
CREATE TYPE catalog_entity_status AS ENUM ('ACTIVE', 'NEEDS_REVIEW', 'MERGED');
CREATE TYPE idempotency_status AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE match_decision_status AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'NEEDS_REVIEW');
CREATE TYPE match_decision_type AS ENUM ('SAME_VARIANT', 'NEW_VARIANT', 'NEW_MODEL', 'NEW_CATEGORY', 'AMBIGUOUS');
CREATE TYPE match_mode AS ENUM ('AUTO', 'CONFIRMED', 'MANUAL');
CREATE TYPE movement_reason AS ENUM ('FOUND_DURING_SALE', 'DAMAGED', 'LOST', 'STOCKTAKE', 'SIZE_RECLASSIFICATION_IN', 'SIZE_RECLASSIFICATION_OUT', 'CORRECTION', 'OTHER');
CREATE TYPE movement_type AS ENUM ('SALE', 'REFUND_RETURN', 'DELIVERY', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'STOCKTAKE_CORRECTION', 'OPENING_BALANCE');
CREATE TYPE raw_input_processing_status AS ENUM ('PENDING', 'PARSED', 'AMBIGUOUS', 'FAILED', 'RESOLVED');
CREATE TYPE raw_input_source AS ENUM ('MANUAL_ENTRY', 'BOT_MESSAGE', 'SNAPSHOT_IMPORT', 'API');
CREATE TYPE sale_status AS ENUM ('COMPLETED', 'VOIDED');
CREATE TYPE size_system_code AS ENUM ('ALPHA', 'NUMERIC_EU', 'UNSPECIFIED');
CREATE TYPE snapshot_quantity_state AS ENUM ('KNOWN', 'UNKNOWN_DISTRIBUTION', 'UNKNOWN_QUANTITY');
CREATE TYPE snapshot_row_status AS ENUM ('PENDING', 'RESOLVED', 'NEEDS_REVIEW', 'SKIPPED');
CREATE TYPE snapshot_status AS ENUM ('DRAFT', 'PARSED', 'IN_REVIEW', 'APPROVED', 'APPLIED', 'REJECTED');
CREATE TYPE source_semantic_type AS ENUM ('UNKNOWN', 'BRAND', 'SUPPLIER', 'FACTORY', 'LABEL', 'COLLECTION');
CREATE TYPE transfer_status AS ENUM ('DRAFT', 'SENT', 'RECEIVED', 'CANCELLED');

CREATE TABLE attribute_term (
	organization_id UUID NOT NULL,
	kind attribute_kind NOT NULL,
	name VARCHAR(120) NOT NULL,
	normalized_name VARCHAR(120) NOT NULL,
	status catalog_entity_status DEFAULT 'ACTIVE' NOT NULL,
	merged_into_id UUID,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_attribute_term PRIMARY KEY (id),
	CONSTRAINT uq_attribute_term_org_kind_name UNIQUE (organization_id, kind, normalized_name),
	CONSTRAINT ck_attribute_term_no_self_merge CHECK (merged_into_id IS NULL OR merged_into_id <> id),
	CONSTRAINT fk_attribute_term_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE,
	CONSTRAINT fk_attribute_term_merged_into_id_attribute_term FOREIGN KEY(merged_into_id) REFERENCES attribute_term (id) ON DELETE RESTRICT
);

CREATE TABLE audit_log (
	organization_id UUID NOT NULL,
	actor_user_id UUID,
	action VARCHAR(80) NOT NULL,
	entity_type VARCHAR(60) NOT NULL,
	entity_id UUID,
	before JSONB,
	after JSONB,
	reason TEXT,
	correlation_id VARCHAR(128),
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_audit_log PRIMARY KEY (id),
	CONSTRAINT fk_audit_log_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE,
	CONSTRAINT fk_audit_log_actor_user_id_app_user FOREIGN KEY(actor_user_id) REFERENCES app_user (id) ON DELETE SET NULL
);
CREATE INDEX ix_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX ix_audit_log_org_created ON audit_log (organization_id, created_at);

CREATE TABLE business_category (
	organization_id UUID NOT NULL,
	name VARCHAR(120) NOT NULL,
	normalized_name VARCHAR(120) NOT NULL,
	is_active BOOLEAN DEFAULT 'true' NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_business_category PRIMARY KEY (id),
	CONSTRAINT uq_business_category_org_normalized UNIQUE (organization_id, normalized_name),
	CONSTRAINT fk_business_category_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE
);

CREATE TABLE garment_type (
	organization_id UUID NOT NULL,
	name VARCHAR(120) NOT NULL,
	normalized_name VARCHAR(120) NOT NULL,
	is_active BOOLEAN DEFAULT 'true' NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_garment_type PRIMARY KEY (id),
	CONSTRAINT uq_garment_type_org_normalized UNIQUE (organization_id, normalized_name),
	CONSTRAINT fk_garment_type_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE
);

CREATE TABLE idempotency_record (
	organization_id UUID NOT NULL,
	endpoint VARCHAR(120) NOT NULL,
	key VARCHAR(200) NOT NULL,
	request_fingerprint VARCHAR(64) NOT NULL,
	status idempotency_status DEFAULT 'IN_PROGRESS' NOT NULL,
	response_snapshot JSONB,
	http_status INTEGER,
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_idempotency_record PRIMARY KEY (id),
	CONSTRAINT uq_idempotency_org_endpoint_key UNIQUE (organization_id, endpoint, key),
	CONSTRAINT fk_idempotency_record_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE
);
CREATE INDEX ix_idempotency_expires_at ON idempotency_record (expires_at);

CREATE TABLE product_alias (
	organization_id UUID NOT NULL,
	normalized_phrase VARCHAR(200) NOT NULL,
	target_type alias_target_type NOT NULL,
	target_id UUID NOT NULL,
	status alias_status DEFAULT 'NEW' NOT NULL,
	confirm_count INTEGER DEFAULT '0' NOT NULL,
	reject_count INTEGER DEFAULT '0' NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_product_alias PRIMARY KEY (id),
	CONSTRAINT uq_product_alias_org_phrase_target UNIQUE (organization_id, normalized_phrase, target_type, target_id),
	CONSTRAINT ck_product_alias_counts_not_negative CHECK (confirm_count >= 0 AND reject_count >= 0),
	CONSTRAINT fk_product_alias_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE
);
CREATE INDEX ix_product_alias_lookup ON product_alias (organization_id, normalized_phrase);

CREATE TABLE size_system (
	organization_id UUID NOT NULL,
	code size_system_code NOT NULL,
	name VARCHAR(80) NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_size_system PRIMARY KEY (id),
	CONSTRAINT uq_size_system_org_code UNIQUE (organization_id, code),
	CONSTRAINT fk_size_system_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE
);

CREATE TABLE source_identity (
	organization_id UUID NOT NULL,
	name VARCHAR(200) NOT NULL,
	normalized_name VARCHAR(200) NOT NULL,
	semantic_type source_semantic_type DEFAULT 'UNKNOWN' NOT NULL,
	confirmed_by_user_id UUID,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_source_identity PRIMARY KEY (id),
	CONSTRAINT uq_source_identity_org_normalized UNIQUE (organization_id, normalized_name),
	CONSTRAINT fk_source_identity_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE,
	CONSTRAINT fk_source_identity_confirmed_by_user_id_app_user FOREIGN KEY(confirmed_by_user_id) REFERENCES app_user (id) ON DELETE SET NULL
);

CREATE TABLE canonical_concept (
	organization_id UUID NOT NULL,
	name VARCHAR(200) NOT NULL,
	normalized_name VARCHAR(200) NOT NULL,
	business_category_id UUID,
	garment_type_id UUID,
	status catalog_entity_status DEFAULT 'ACTIVE' NOT NULL,
	merged_into_id UUID,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_canonical_concept PRIMARY KEY (id),
	CONSTRAINT uq_canonical_concept_org_normalized UNIQUE (organization_id, normalized_name),
	CONSTRAINT ck_canonical_concept_merged_requires_target CHECK ((status = 'MERGED') = (merged_into_id IS NOT NULL)),
	CONSTRAINT ck_canonical_concept_no_self_merge CHECK (merged_into_id IS NULL OR merged_into_id <> id),
	CONSTRAINT fk_canonical_concept_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE,
	CONSTRAINT fk_canonical_concept_business_category_id_business_category FOREIGN KEY(business_category_id) REFERENCES business_category (id) ON DELETE RESTRICT,
	CONSTRAINT fk_canonical_concept_garment_type_id_garment_type FOREIGN KEY(garment_type_id) REFERENCES garment_type (id) ON DELETE RESTRICT,
	CONSTRAINT fk_canonical_concept_merged_into_id_canonical_concept FOREIGN KEY(merged_into_id) REFERENCES canonical_concept (id) ON DELETE RESTRICT
);

CREATE TABLE inventory_snapshot (
	organization_id UUID NOT NULL,
	store_id UUID,
	source_document_ref VARCHAR(300),
	captured_at VARCHAR(40),
	status snapshot_status DEFAULT 'DRAFT' NOT NULL,
	approved_by_user_id UUID,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_inventory_snapshot PRIMARY KEY (id),
	CONSTRAINT fk_inventory_snapshot_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE,
	CONSTRAINT fk_inventory_snapshot_store_id_store FOREIGN KEY(store_id) REFERENCES store (id) ON DELETE RESTRICT,
	CONSTRAINT fk_inventory_snapshot_approved_by_user_id_app_user FOREIGN KEY(approved_by_user_id) REFERENCES app_user (id) ON DELETE SET NULL
);

CREATE TABLE raw_input (
	organization_id UUID NOT NULL,
	store_id UUID,
	source_kind raw_input_source NOT NULL,
	source_ref VARCHAR(200),
	raw_text TEXT NOT NULL,
	content_hash VARCHAR(64) NOT NULL,
	created_by_user_id UUID,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_raw_input PRIMARY KEY (id),
	CONSTRAINT ck_raw_input_raw_text_not_empty CHECK (length(raw_text) > 0),
	CONSTRAINT fk_raw_input_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE,
	CONSTRAINT fk_raw_input_store_id_store FOREIGN KEY(store_id) REFERENCES store (id) ON DELETE SET NULL,
	CONSTRAINT fk_raw_input_created_by_user_id_app_user FOREIGN KEY(created_by_user_id) REFERENCES app_user (id) ON DELETE SET NULL
);
CREATE INDEX ix_raw_input_org_hash ON raw_input (organization_id, content_hash);

CREATE TABLE sale (
	organization_id UUID NOT NULL,
	store_id UUID NOT NULL,
	seller_user_id UUID NOT NULL,
	command_id UUID NOT NULL,
	status sale_status DEFAULT 'COMPLETED' NOT NULL,
	currency_code VARCHAR(3) NOT NULL,
	subtotal NUMERIC(12, 2) NOT NULL,
	discount_total NUMERIC(12, 2) DEFAULT '0' NOT NULL,
	total NUMERIC(12, 2) NOT NULL,
	sold_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	correlation_id VARCHAR(128),
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_sale PRIMARY KEY (id),
	CONSTRAINT uq_sale_org_command UNIQUE (organization_id, command_id),
	CONSTRAINT ck_sale_amounts_sane CHECK (subtotal >= 0 AND total >= 0 AND discount_total >= 0),
	CONSTRAINT ck_sale_total_is_consistent CHECK (total = subtotal - discount_total),
	CONSTRAINT ck_sale_currency_code_iso4217 CHECK (char_length(currency_code) = 3),
	CONSTRAINT fk_sale_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE RESTRICT,
	CONSTRAINT fk_sale_store_id_store FOREIGN KEY(store_id) REFERENCES store (id) ON DELETE RESTRICT,
	CONSTRAINT fk_sale_seller_user_id_app_user FOREIGN KEY(seller_user_id) REFERENCES app_user (id) ON DELETE RESTRICT
);
CREATE INDEX ix_sale_store_sold_at ON sale (store_id, sold_at);

CREATE TABLE size (
	size_system_id UUID NOT NULL,
	code VARCHAR(20) NOT NULL,
	sort_order INTEGER DEFAULT '0' NOT NULL,
	is_unknown BOOLEAN DEFAULT 'false' NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_size PRIMARY KEY (id),
	CONSTRAINT uq_size_system_code UNIQUE (size_system_id, code),
	CONSTRAINT fk_size_size_system_id_size_system FOREIGN KEY(size_system_id) REFERENCES size_system (id) ON DELETE RESTRICT
);

CREATE TABLE transfer (
	organization_id UUID NOT NULL,
	from_store_id UUID NOT NULL,
	to_store_id UUID NOT NULL,
	created_by_user_id UUID NOT NULL,
	command_id UUID NOT NULL,
	status transfer_status NOT NULL,
	sent_at TIMESTAMP WITH TIME ZONE,
	received_at TIMESTAMP WITH TIME ZONE,
	correlation_id VARCHAR(128),
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_transfer PRIMARY KEY (id),
	CONSTRAINT uq_transfer_org_command UNIQUE (organization_id, command_id),
	CONSTRAINT ck_transfer_stores_differ CHECK (from_store_id <> to_store_id),
	CONSTRAINT fk_transfer_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE RESTRICT,
	CONSTRAINT fk_transfer_from_store_id_store FOREIGN KEY(from_store_id) REFERENCES store (id) ON DELETE RESTRICT,
	CONSTRAINT fk_transfer_to_store_id_store FOREIGN KEY(to_store_id) REFERENCES store (id) ON DELETE RESTRICT,
	CONSTRAINT fk_transfer_created_by_user_id_app_user FOREIGN KEY(created_by_user_id) REFERENCES app_user (id) ON DELETE RESTRICT
);

CREATE TABLE parse_result (
	raw_input_id UUID NOT NULL,
	parser_version VARCHAR(40) NOT NULL,
	parsed JSONB DEFAULT '{}' NOT NULL,
	field_confidence JSONB DEFAULT '{}' NOT NULL,
	unclassified JSONB DEFAULT '[]' NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_parse_result PRIMARY KEY (id),
	CONSTRAINT uq_parse_result_input_version UNIQUE (raw_input_id, parser_version),
	CONSTRAINT fk_parse_result_raw_input_id_raw_input FOREIGN KEY(raw_input_id) REFERENCES raw_input (id) ON DELETE CASCADE
);

CREATE TABLE product_family (
	organization_id UUID NOT NULL,
	canonical_concept_id UUID NOT NULL,
	source_identity_id UUID,
	garment_type_id UUID,
	distinction_note TEXT,
	status catalog_entity_status DEFAULT 'ACTIVE' NOT NULL,
	merged_into_id UUID,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_product_family PRIMARY KEY (id),
	CONSTRAINT ck_product_family_merged_requires_target CHECK ((status = 'MERGED') = (merged_into_id IS NOT NULL)),
	CONSTRAINT ck_product_family_no_self_merge CHECK (merged_into_id IS NULL OR merged_into_id <> id),
	CONSTRAINT fk_product_family_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE,
	CONSTRAINT fk_product_family_canonical_concept_id_canonical_concept FOREIGN KEY(canonical_concept_id) REFERENCES canonical_concept (id) ON DELETE RESTRICT,
	CONSTRAINT fk_product_family_source_identity_id_source_identity FOREIGN KEY(source_identity_id) REFERENCES source_identity (id) ON DELETE RESTRICT,
	CONSTRAINT fk_product_family_garment_type_id_garment_type FOREIGN KEY(garment_type_id) REFERENCES garment_type (id) ON DELETE RESTRICT,
	CONSTRAINT fk_product_family_merged_into_id_product_family FOREIGN KEY(merged_into_id) REFERENCES product_family (id) ON DELETE RESTRICT
);
CREATE INDEX ix_product_family_signature ON product_family (organization_id, canonical_concept_id, source_identity_id, garment_type_id);

CREATE TABLE refund (
	organization_id UUID NOT NULL,
	store_id UUID NOT NULL,
	sale_id UUID NOT NULL,
	actor_user_id UUID NOT NULL,
	command_id UUID NOT NULL,
	total_amount NUMERIC(12, 2) NOT NULL,
	currency_code VARCHAR(3) NOT NULL,
	reason TEXT,
	correlation_id VARCHAR(128),
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_refund PRIMARY KEY (id),
	CONSTRAINT uq_refund_org_command UNIQUE (organization_id, command_id),
	CONSTRAINT ck_refund_amount_not_negative CHECK (total_amount >= 0),
	CONSTRAINT ck_refund_currency_code_iso4217 CHECK (char_length(currency_code) = 3),
	CONSTRAINT fk_refund_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE RESTRICT,
	CONSTRAINT fk_refund_store_id_store FOREIGN KEY(store_id) REFERENCES store (id) ON DELETE RESTRICT,
	CONSTRAINT fk_refund_sale_id_sale FOREIGN KEY(sale_id) REFERENCES sale (id) ON DELETE RESTRICT,
	CONSTRAINT fk_refund_actor_user_id_app_user FOREIGN KEY(actor_user_id) REFERENCES app_user (id) ON DELETE RESTRICT
);
CREATE INDEX ix_refund_sale ON refund (sale_id);

CREATE TABLE size_alias (
	organization_id UUID NOT NULL,
	normalized_text VARCHAR(60) NOT NULL,
	size_id UUID NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_size_alias PRIMARY KEY (id),
	CONSTRAINT uq_size_alias_org_text UNIQUE (organization_id, normalized_text),
	CONSTRAINT fk_size_alias_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE,
	CONSTRAINT fk_size_alias_size_id_size FOREIGN KEY(size_id) REFERENCES size (id) ON DELETE CASCADE
);

CREATE TABLE product_variant (
	product_family_id UUID NOT NULL,
	color_term_id UUID,
	material_term_id UUID,
	texture_term_id UUID,
	fur_term_id UUID,
	collar_term_id UUID,
	length_cm NUMERIC(5, 1),
	attributes JSONB DEFAULT '{}' NOT NULL,
	status catalog_entity_status DEFAULT 'ACTIVE' NOT NULL,
	merged_into_id UUID,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_product_variant PRIMARY KEY (id),
	CONSTRAINT uq_product_variant_attributes UNIQUE NULLS NOT DISTINCT (product_family_id, color_term_id, material_term_id, texture_term_id, fur_term_id, collar_term_id, length_cm),
	CONSTRAINT ck_product_variant_length_positive CHECK (length_cm IS NULL OR length_cm > 0),
	CONSTRAINT ck_product_variant_no_self_merge CHECK (merged_into_id IS NULL OR merged_into_id <> id),
	CONSTRAINT fk_product_variant_product_family_id_product_family FOREIGN KEY(product_family_id) REFERENCES product_family (id) ON DELETE RESTRICT,
	CONSTRAINT fk_product_variant_color_term_id_attribute_term FOREIGN KEY(color_term_id) REFERENCES attribute_term (id) ON DELETE RESTRICT,
	CONSTRAINT fk_product_variant_material_term_id_attribute_term FOREIGN KEY(material_term_id) REFERENCES attribute_term (id) ON DELETE RESTRICT,
	CONSTRAINT fk_product_variant_texture_term_id_attribute_term FOREIGN KEY(texture_term_id) REFERENCES attribute_term (id) ON DELETE RESTRICT,
	CONSTRAINT fk_product_variant_fur_term_id_attribute_term FOREIGN KEY(fur_term_id) REFERENCES attribute_term (id) ON DELETE RESTRICT,
	CONSTRAINT fk_product_variant_collar_term_id_attribute_term FOREIGN KEY(collar_term_id) REFERENCES attribute_term (id) ON DELETE RESTRICT,
	CONSTRAINT fk_product_variant_merged_into_id_product_variant FOREIGN KEY(merged_into_id) REFERENCES product_variant (id) ON DELETE RESTRICT
);
CREATE INDEX ix_product_variant_attributes_gin ON product_variant USING gin (attributes);

CREATE TABLE raw_input_processing (
	raw_input_id UUID NOT NULL,
	status raw_input_processing_status DEFAULT 'PENDING' NOT NULL,
	attempts INTEGER DEFAULT '0' NOT NULL,
	parser_version VARCHAR(40),
	last_parse_result_id UUID,
	last_error TEXT,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_raw_input_processing PRIMARY KEY (raw_input_id),
	CONSTRAINT ck_raw_input_processing_attempts_not_negative CHECK (attempts >= 0),
	CONSTRAINT fk_raw_input_processing_raw_input_id_raw_input FOREIGN KEY(raw_input_id) REFERENCES raw_input (id) ON DELETE CASCADE,
	CONSTRAINT fk_raw_input_processing_last_parse_result_id_parse_result FOREIGN KEY(last_parse_result_id) REFERENCES parse_result (id) ON DELETE SET NULL
);
CREATE INDEX ix_raw_input_processing_status ON raw_input_processing (status);

CREATE TABLE catalog_match_decision (
	organization_id UUID NOT NULL,
	raw_input_id UUID NOT NULL,
	parse_result_id UUID,
	decision_type match_decision_type NOT NULL,
	resolved_variant_id UUID,
	top_candidate_variant_id UUID,
	top_score NUMERIC(4, 3),
	second_score NUMERIC(4, 3),
	margin NUMERIC(4, 3),
	field_scores JSONB DEFAULT '{}' NOT NULL,
	conflicts JSONB DEFAULT '[]' NOT NULL,
	matcher_version VARCHAR(40) NOT NULL,
	knowledge_revision BIGINT DEFAULT '0' NOT NULL,
	mode match_mode NOT NULL,
	status match_decision_status DEFAULT 'PENDING' NOT NULL,
	decided_by_user_id UUID,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_catalog_match_decision PRIMARY KEY (id),
	CONSTRAINT ck_catalog_match_decision_applied_requires_resolution CHECK ((status <> 'APPLIED') OR (resolved_variant_id IS NOT NULL)),
	CONSTRAINT ck_catalog_match_decision_ambiguous_resolves_nothing CHECK ((decision_type <> 'AMBIGUOUS') OR (resolved_variant_id IS NULL)),
	CONSTRAINT fk_catalog_match_decision_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE,
	CONSTRAINT fk_catalog_match_decision_raw_input_id_raw_input FOREIGN KEY(raw_input_id) REFERENCES raw_input (id) ON DELETE CASCADE,
	CONSTRAINT fk_catalog_match_decision_parse_result_id_parse_result FOREIGN KEY(parse_result_id) REFERENCES parse_result (id) ON DELETE SET NULL,
	CONSTRAINT fk_catalog_match_decision_resolved_variant_id_product_variant FOREIGN KEY(resolved_variant_id) REFERENCES product_variant (id) ON DELETE RESTRICT,
	CONSTRAINT fk_catalog_match_decision_top_candidate_variant_id_prod_81d7 FOREIGN KEY(top_candidate_variant_id) REFERENCES product_variant (id) ON DELETE SET NULL,
	CONSTRAINT fk_catalog_match_decision_decided_by_user_id_app_user FOREIGN KEY(decided_by_user_id) REFERENCES app_user (id) ON DELETE SET NULL
);
CREATE INDEX ix_catalog_match_decision_review ON catalog_match_decision (organization_id, status);

CREATE TABLE inventory (
	store_id UUID NOT NULL,
	product_variant_id UUID NOT NULL,
	size_id UUID NOT NULL,
	quantity INTEGER DEFAULT '0' NOT NULL,
	id UUID NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_inventory PRIMARY KEY (id),
	CONSTRAINT uq_inventory_store_variant_size UNIQUE (store_id, product_variant_id, size_id),
	CONSTRAINT ck_inventory_quantity_not_negative CHECK (quantity >= 0),
	CONSTRAINT fk_inventory_store_id_store FOREIGN KEY(store_id) REFERENCES store (id) ON DELETE RESTRICT,
	CONSTRAINT fk_inventory_product_variant_id_product_variant FOREIGN KEY(product_variant_id) REFERENCES product_variant (id) ON DELETE RESTRICT,
	CONSTRAINT fk_inventory_size_id_size FOREIGN KEY(size_id) REFERENCES size (id) ON DELETE RESTRICT
);

CREATE TABLE inventory_snapshot_row (
	inventory_snapshot_id UUID NOT NULL,
	line_no INTEGER NOT NULL,
	raw_input_id UUID NOT NULL,
	parse_result_id UUID,
	quantity_total INTEGER,
	quantity_state snapshot_quantity_state DEFAULT 'KNOWN' NOT NULL,
	resolved_variant_id UUID,
	resolved_size_id UUID,
	status snapshot_row_status DEFAULT 'PENDING' NOT NULL,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_inventory_snapshot_row PRIMARY KEY (id),
	CONSTRAINT uq_snapshot_row_line UNIQUE (inventory_snapshot_id, line_no),
	CONSTRAINT ck_inventory_snapshot_row_quantity_not_negative CHECK (quantity_total IS NULL OR quantity_total >= 0),
	CONSTRAINT ck_inventory_snapshot_row_resolved_requires_complete_row CHECK (status <> 'RESOLVED' OR ( resolved_variant_id IS NOT NULL AND resolved_size_id IS NOT NULL AND quantity_total IS NOT NULL AND quantity_state = 'KNOWN')),
	CONSTRAINT fk_inventory_snapshot_row_inventory_snapshot_id_invento_8022 FOREIGN KEY(inventory_snapshot_id) REFERENCES inventory_snapshot (id) ON DELETE CASCADE,
	CONSTRAINT fk_inventory_snapshot_row_raw_input_id_raw_input FOREIGN KEY(raw_input_id) REFERENCES raw_input (id) ON DELETE RESTRICT,
	CONSTRAINT fk_inventory_snapshot_row_parse_result_id_parse_result FOREIGN KEY(parse_result_id) REFERENCES parse_result (id) ON DELETE SET NULL,
	CONSTRAINT fk_inventory_snapshot_row_resolved_variant_id_product_variant FOREIGN KEY(resolved_variant_id) REFERENCES product_variant (id) ON DELETE RESTRICT,
	CONSTRAINT fk_inventory_snapshot_row_resolved_size_id_size FOREIGN KEY(resolved_size_id) REFERENCES size (id) ON DELETE RESTRICT
);

CREATE TABLE sale_item (
	sale_id UUID NOT NULL,
	product_variant_id UUID NOT NULL,
	size_id UUID NOT NULL,
	quantity INTEGER NOT NULL,
	unit_price NUMERIC(12, 2) NOT NULL,
	discount_amount NUMERIC(12, 2) DEFAULT '0' NOT NULL,
	final_unit_price NUMERIC(12, 2) NOT NULL,
	line_total NUMERIC(12, 2) NOT NULL,
	currency_code VARCHAR(3) NOT NULL,
	display_name_snapshot TEXT NOT NULL,
	variant_snapshot JSONB NOT NULL,
	id UUID NOT NULL,
	CONSTRAINT pk_sale_item PRIMARY KEY (id),
	CONSTRAINT ck_sale_item_quantity_positive CHECK (quantity > 0),
	CONSTRAINT ck_sale_item_amounts_not_negative CHECK (unit_price >= 0 AND discount_amount >= 0 AND final_unit_price >= 0),
	CONSTRAINT ck_sale_item_final_price_is_consistent CHECK (final_unit_price = unit_price - discount_amount),
	CONSTRAINT ck_sale_item_line_total_is_consistent CHECK (line_total = final_unit_price * quantity),
	CONSTRAINT ck_sale_item_currency_code_iso4217 CHECK (char_length(currency_code) = 3),
	CONSTRAINT fk_sale_item_sale_id_sale FOREIGN KEY(sale_id) REFERENCES sale (id) ON DELETE RESTRICT,
	CONSTRAINT fk_sale_item_product_variant_id_product_variant FOREIGN KEY(product_variant_id) REFERENCES product_variant (id) ON DELETE RESTRICT,
	CONSTRAINT fk_sale_item_size_id_size FOREIGN KEY(size_id) REFERENCES size (id) ON DELETE RESTRICT
);
CREATE INDEX ix_sale_item_sale ON sale_item (sale_id);

CREATE TABLE stock_lot (
	organization_id UUID NOT NULL,
	store_id UUID NOT NULL,
	product_variant_id UUID NOT NULL,
	size_id UUID NOT NULL,
	acquisition_type acquisition_type NOT NULL,
	source_identity_id UUID,
	unit_cost NUMERIC(12, 2),
	currency_code VARCHAR(3),
	inventory_snapshot_id UUID,
	notes TEXT,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_stock_lot PRIMARY KEY (id),
	CONSTRAINT ck_stock_lot_unit_cost_not_negative CHECK (unit_cost IS NULL OR unit_cost >= 0),
	CONSTRAINT ck_stock_lot_cost_requires_currency CHECK ((unit_cost IS NULL) = (currency_code IS NULL)),
	CONSTRAINT fk_stock_lot_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE,
	CONSTRAINT fk_stock_lot_store_id_store FOREIGN KEY(store_id) REFERENCES store (id) ON DELETE RESTRICT,
	CONSTRAINT fk_stock_lot_product_variant_id_product_variant FOREIGN KEY(product_variant_id) REFERENCES product_variant (id) ON DELETE RESTRICT,
	CONSTRAINT fk_stock_lot_size_id_size FOREIGN KEY(size_id) REFERENCES size (id) ON DELETE RESTRICT,
	CONSTRAINT fk_stock_lot_source_identity_id_source_identity FOREIGN KEY(source_identity_id) REFERENCES source_identity (id) ON DELETE SET NULL,
	CONSTRAINT fk_stock_lot_inventory_snapshot_id_inventory_snapshot FOREIGN KEY(inventory_snapshot_id) REFERENCES inventory_snapshot (id) ON DELETE SET NULL
);
CREATE INDEX ix_stock_lot_store_variant ON stock_lot (store_id, product_variant_id, size_id);

CREATE TABLE transfer_item (
	transfer_id UUID NOT NULL,
	product_variant_id UUID NOT NULL,
	size_id UUID NOT NULL,
	quantity INTEGER NOT NULL,
	id UUID NOT NULL,
	CONSTRAINT pk_transfer_item PRIMARY KEY (id),
	CONSTRAINT ck_transfer_item_quantity_positive CHECK (quantity > 0),
	CONSTRAINT fk_transfer_item_transfer_id_transfer FOREIGN KEY(transfer_id) REFERENCES transfer (id) ON DELETE RESTRICT,
	CONSTRAINT fk_transfer_item_product_variant_id_product_variant FOREIGN KEY(product_variant_id) REFERENCES product_variant (id) ON DELETE RESTRICT,
	CONSTRAINT fk_transfer_item_size_id_size FOREIGN KEY(size_id) REFERENCES size (id) ON DELETE RESTRICT
);
CREATE INDEX ix_transfer_item_transfer ON transfer_item (transfer_id);

CREATE TABLE variant_price (
	organization_id UUID NOT NULL,
	store_id UUID,
	product_variant_id UUID NOT NULL,
	suggested_price NUMERIC(12, 2) NOT NULL,
	currency_code VARCHAR(3) NOT NULL,
	updated_by_user_id UUID,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_variant_price PRIMARY KEY (id),
	CONSTRAINT uq_variant_price_org_store_variant UNIQUE NULLS NOT DISTINCT (organization_id, store_id, product_variant_id),
	CONSTRAINT ck_variant_price_price_not_negative CHECK (suggested_price >= 0),
	CONSTRAINT ck_variant_price_currency_code_iso4217 CHECK (char_length(currency_code) = 3),
	CONSTRAINT fk_variant_price_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE,
	CONSTRAINT fk_variant_price_store_id_store FOREIGN KEY(store_id) REFERENCES store (id) ON DELETE CASCADE,
	CONSTRAINT fk_variant_price_product_variant_id_product_variant FOREIGN KEY(product_variant_id) REFERENCES product_variant (id) ON DELETE CASCADE,
	CONSTRAINT fk_variant_price_updated_by_user_id_app_user FOREIGN KEY(updated_by_user_id) REFERENCES app_user (id) ON DELETE SET NULL
);

CREATE TABLE alias_evidence (
	alias_id UUID NOT NULL,
	raw_input_id UUID,
	decision_id UUID,
	event alias_evidence_event NOT NULL,
	actor_user_id UUID,
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_alias_evidence PRIMARY KEY (id),
	CONSTRAINT fk_alias_evidence_alias_id_product_alias FOREIGN KEY(alias_id) REFERENCES product_alias (id) ON DELETE CASCADE,
	CONSTRAINT fk_alias_evidence_raw_input_id_raw_input FOREIGN KEY(raw_input_id) REFERENCES raw_input (id) ON DELETE SET NULL,
	CONSTRAINT fk_alias_evidence_decision_id_catalog_match_decision FOREIGN KEY(decision_id) REFERENCES catalog_match_decision (id) ON DELETE SET NULL,
	CONSTRAINT fk_alias_evidence_actor_user_id_app_user FOREIGN KEY(actor_user_id) REFERENCES app_user (id) ON DELETE SET NULL
);
CREATE INDEX ix_alias_evidence_alias ON alias_evidence (alias_id);

CREATE TABLE refund_item (
	refund_id UUID NOT NULL,
	sale_item_id UUID NOT NULL,
	quantity INTEGER NOT NULL,
	amount NUMERIC(12, 2) NOT NULL,
	restock BOOLEAN NOT NULL,
	id UUID NOT NULL,
	CONSTRAINT pk_refund_item PRIMARY KEY (id),
	CONSTRAINT ck_refund_item_quantity_positive CHECK (quantity > 0),
	CONSTRAINT ck_refund_item_amount_not_negative CHECK (amount >= 0),
	CONSTRAINT fk_refund_item_refund_id_refund FOREIGN KEY(refund_id) REFERENCES refund (id) ON DELETE RESTRICT,
	CONSTRAINT fk_refund_item_sale_item_id_sale_item FOREIGN KEY(sale_item_id) REFERENCES sale_item (id) ON DELETE RESTRICT
);
CREATE INDEX ix_refund_item_refund ON refund_item (refund_id);
CREATE INDEX ix_refund_item_sale_item ON refund_item (sale_item_id);

CREATE TABLE stock_movement (
	organization_id UUID NOT NULL,
	store_id UUID NOT NULL,
	product_variant_id UUID NOT NULL,
	size_id UUID NOT NULL,
	stock_lot_id UUID,
	movement_type movement_type NOT NULL,
	quantity_delta INTEGER NOT NULL,
	reason_code movement_reason,
	reference_type VARCHAR(40),
	reference_id UUID,
	actor_user_id UUID,
	correlation_id VARCHAR(128),
	id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_stock_movement PRIMARY KEY (id),
	CONSTRAINT ck_stock_movement_delta_not_zero CHECK (quantity_delta <> 0),
	CONSTRAINT ck_stock_movement_adjustment_requires_reason CHECK (movement_type <> 'ADJUSTMENT' OR reason_code IS NOT NULL),
	CONSTRAINT fk_stock_movement_organization_id_organization FOREIGN KEY(organization_id) REFERENCES organization (id) ON DELETE CASCADE,
	CONSTRAINT fk_stock_movement_store_id_store FOREIGN KEY(store_id) REFERENCES store (id) ON DELETE RESTRICT,
	CONSTRAINT fk_stock_movement_product_variant_id_product_variant FOREIGN KEY(product_variant_id) REFERENCES product_variant (id) ON DELETE RESTRICT,
	CONSTRAINT fk_stock_movement_size_id_size FOREIGN KEY(size_id) REFERENCES size (id) ON DELETE RESTRICT,
	CONSTRAINT fk_stock_movement_stock_lot_id_stock_lot FOREIGN KEY(stock_lot_id) REFERENCES stock_lot (id) ON DELETE SET NULL,
	CONSTRAINT fk_stock_movement_actor_user_id_app_user FOREIGN KEY(actor_user_id) REFERENCES app_user (id) ON DELETE SET NULL
);
CREATE INDEX ix_stock_movement_key ON stock_movement (store_id, product_variant_id, size_id, created_at);
CREATE INDEX ix_stock_movement_reference ON stock_movement (reference_type, reference_id);
