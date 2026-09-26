"""Transactional organization knowledge revision for catalog matching inputs.

Backfills every existing organization before installing triggers. Each changed
catalog row invalidates previews in the same transaction. This is an invalidation
counter, not an event count. Downgrade removes only this feature's objects.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013_catalog_knowledge"
down_revision: str | None = "0012_catalog_trigram"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = (
    "business_category",
    "garment_type",
    "canonical_concept",
    "source_identity",
    "attribute_term",
    "product_family",
    "product_variant",
    "product_alias",
)


def upgrade() -> None:
    op.create_table(
        "catalog_knowledge_revision",
        sa.Column(
            "organization_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("organization.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("revision", sa.BigInteger(), nullable=False, server_default="0"),
        sa.CheckConstraint("revision >= 0", name="revision_nonnegative"),
    )
    # Lock against writes during backfill/trigger installation: no catalog or
    # organization mutation can slip between the initial snapshot and triggers.
    op.execute("LOCK TABLE organization IN SHARE ROW EXCLUSIVE MODE")
    for table in _TABLES:
        op.execute(f"LOCK TABLE {table} IN SHARE ROW EXCLUSIVE MODE")
    op.execute(
        "INSERT INTO catalog_knowledge_revision (organization_id, revision) "
        "SELECT o.id, coalesce(max(d.knowledge_revision), 0) + 1 FROM organization o "
        "LEFT JOIN catalog_match_decision d ON d.organization_id = o.id GROUP BY o.id"
    )
    op.execute("""
        CREATE FUNCTION initialize_catalog_knowledge_revision() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            INSERT INTO catalog_knowledge_revision (organization_id) VALUES (NEW.id);
            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER organization_catalog_knowledge
        AFTER INSERT ON organization FOR EACH ROW
        EXECUTE FUNCTION initialize_catalog_knowledge_revision()
    """)
    op.execute("""
        CREATE FUNCTION invalidate_catalog_knowledge() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE
            old_org uuid;
            new_org uuid;
            old_family uuid;
            new_family uuid;
            affected_org uuid;
        BEGIN
            IF TG_TABLE_NAME = 'product_variant' THEN
                IF TG_OP <> 'INSERT' THEN old_family := OLD.product_family_id; END IF;
                IF TG_OP <> 'DELETE' THEN new_family := NEW.product_family_id; END IF;
                -- A concurrent family tenant move must not leave a variant
                -- mutation invalidating only its former organization.
                PERFORM id FROM product_family
                  WHERE id IN (old_family, new_family) ORDER BY id FOR SHARE;
                SELECT organization_id INTO old_org FROM product_family WHERE id = old_family;
                SELECT organization_id INTO new_org FROM product_family WHERE id = new_family;
            ELSE
                IF TG_OP <> 'INSERT' THEN old_org := OLD.organization_id; END IF;
                IF TG_OP <> 'DELETE' THEN new_org := NEW.organization_id; END IF;
            END IF;
            FOR affected_org IN
                SELECT DISTINCT value FROM unnest(ARRAY[old_org, new_org]) AS t(value)
                WHERE value IS NOT NULL ORDER BY value
            LOOP
                UPDATE catalog_knowledge_revision SET revision = revision + 1
                  WHERE organization_id = affected_org;
            END LOOP;
            RETURN NULL;
        END;
        $$
    """)
    op.execute("""
        CREATE FUNCTION invalidate_all_catalog_knowledge() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE affected_org uuid;
        BEGIN
            FOR affected_org IN
                SELECT organization_id FROM catalog_knowledge_revision ORDER BY organization_id
            LOOP
                UPDATE catalog_knowledge_revision SET revision = revision + 1
                  WHERE organization_id = affected_org;
            END LOOP;
            RETURN NULL;
        END;
        $$
    """)
    for table in _TABLES:
        op.execute(f"""
            CREATE TRIGGER {table}_catalog_knowledge
            AFTER INSERT OR UPDATE OR DELETE ON {table} FOR EACH ROW
            EXECUTE FUNCTION invalidate_catalog_knowledge()
        """)
        op.execute(f"""
            CREATE TRIGGER {table}_catalog_knowledge_truncate
            AFTER TRUNCATE ON {table} FOR EACH STATEMENT
            EXECUTE FUNCTION invalidate_all_catalog_knowledge()
        """)


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.execute(f"DROP TRIGGER {table}_catalog_knowledge_truncate ON {table}")
        op.execute(f"DROP TRIGGER {table}_catalog_knowledge ON {table}")
    op.execute("DROP FUNCTION invalidate_all_catalog_knowledge()")
    op.execute("DROP FUNCTION invalidate_catalog_knowledge()")
    op.execute("DROP TRIGGER organization_catalog_knowledge ON organization")
    op.execute("DROP FUNCTION initialize_catalog_knowledge_revision()")
    op.drop_table("catalog_knowledge_revision")
