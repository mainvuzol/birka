"""Move the stock key from the selling store to the physical location.

Owner decisions of 2026-09-15 and 2026-09-17: one primary warehouse serves both
stores, the child store also has its own, a sale is credited to the store that
made it, and the shared balance is stored once. `store_id` cannot express that
— it means "where the goods are", "who may sell them" and "whose they are" all
at once. See ADR-0004.

**This is a relabelling, not a reorganisation.** It creates exactly one
location per existing store, grants exactly that store access to it, and moves
every quantity, lot, movement and snapshot across unchanged. Afterwards the
system behaves precisely as it did before: the same balances, the same reach,
the same reconciliation. What changes is that the model can now *express* a
shared warehouse — it does not yet contain one.

**Nothing is merged.** Whether two stores' balances are the same goods recorded
twice or two genuine piles is not knowable from the database, and a migration
must not guess (owner decision: all current data is test data; whether to
import or start fresh is decided separately before launch, and nothing is
cleaned automatically).

**The ledger is briefly mutable.** `stock_movement` carries the
`stock_movement_is_append_only` trigger from `0002` (invariants I10/I11), which
refuses every UPDATE. Backfilling its new columns therefore requires suspending
that trigger — the one moment in this system's life when the ledger can be
rewritten. It happens inside this single transaction, and the assertions below
refuse to finish unless the trigger is back on.

Revision ID: 0006_stock_location_rekey
Revises: 0005_stock_locations
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_stock_rekey"
down_revision: str | None = "0005_stock_locations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LEDGER_TRIGGER = "stock_movement_is_append_only"

# Tables whose stock key moves from the store to the location.
STOCK_TABLES = ("inventory", "stock_lot", "stock_movement", "inventory_snapshot")


def _assert(condition_sql: str, message: str) -> None:
    """Abort the migration — inside its transaction — when an invariant fails."""
    op.execute(
        f"""DO $$ BEGIN
        IF NOT ({condition_sql}) THEN
            RAISE EXCEPTION '0006 aborted: {message}';
        END IF;
        END $$"""
    )


def upgrade() -> None:
    # --- 0. preflight -------------------------------------------------------
    # The foundation tables from `0005` must be empty. This migration treats
    # `store_location_access` as *the* store<->location mapping for every
    # backfill below, which only holds if it wrote every row in it. A warehouse
    # provisioned by hand between `0005` and here would silently become part of
    # that mapping, so refuse with the real reason rather than let a later
    # count mismatch report it as merged balances.
    _assert(
        "NOT EXISTS (SELECT 1 FROM stock_location)",
        "stock_location must be empty before the re-key: a warehouse already "
        "exists, and this migration cannot tell which stock belongs to it",
    )
    _assert(
        "NOT EXISTS (SELECT 1 FROM store_location_access)",
        "store_location_access must be empty before the re-key: an access grant "
        "already exists and would be mistaken for the store<->location mapping",
    )

    # --- 1. one location per existing store, named after it -----------------
    # Deterministic and derived from data already present. `store_location_access`
    # is the store<->location mapping: every later step and `downgrade()` read
    # it back rather than a temporary table that would not survive either.
    #
    # `is_active` is `true` for every location, never copied from the store. A
    # place does not close because a shop does, and the owner's rule of
    # 2026-09-15 keeps the two concepts apart — copying the flag would invent a
    # rule ("blocking a shop closes its warehouse") that nobody stated, and
    # would take the *shared* warehouse away from the other store the moment
    # the primary one was blocked.
    op.execute(
        """
        INSERT INTO stock_location (id, organization_id, code, name, is_active, created_at)
        SELECT gen_random_uuid(), s.organization_id, s.code, s.name, true, now()
        FROM store s
        """
    )
    op.execute(
        """
        INSERT INTO store_location_access
            (id, organization_id, store_id, location_id, can_sell, can_receive, created_at)
        SELECT gen_random_uuid(), s.organization_id, s.id, l.id, true, true, now()
        FROM store s
        JOIN stock_location l
          ON l.organization_id = s.organization_id AND l.code = s.code
        """
    )
    _assert(
        "(SELECT count(*) FROM stock_location) = (SELECT count(*) FROM store)",
        "one location per store expected",
    )
    _assert(
        "NOT EXISTS (SELECT 1 FROM store_location_access GROUP BY location_id HAVING count(*) > 1)",
        "a location reachable by two stores would mean balances were merged",
    )

    # --- 2. additive columns, nullable for now ------------------------------
    for table in STOCK_TABLES:
        op.add_column(table, sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column(
        "stock_movement", sa.Column("acting_store_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column(
        "sale_item", sa.Column("source_location_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column(
        "refund_item",
        sa.Column("destination_location_id", postgresql.UUID(as_uuid=True), nullable=True),
    )

    # --- 3. backfill through the access mapping ----------------------------
    # `store_location_access` is the store<->location mapping, and it is 1:1
    # while this migration runs (asserted above). Written out literally rather
    # than looped: a migration that moves the stock key should read as exactly
    # the statements it executes.
    for statement in (
        "UPDATE inventory t SET location_id = a.location_id "
        "FROM store_location_access a WHERE a.store_id = t.store_id",
        "UPDATE stock_lot t SET location_id = a.location_id "
        "FROM store_location_access a WHERE a.store_id = t.store_id",
        "UPDATE inventory_snapshot t SET location_id = a.location_id "
        "FROM store_location_access a WHERE a.store_id = t.store_id",
    ):
        op.execute(statement)

    # The ledger is append-only. Suspend, backfill, restore — and the trigger
    # assertion below refuses to let the migration finish if the restore is lost.
    op.execute(f"ALTER TABLE stock_movement DISABLE TRIGGER {LEDGER_TRIGGER}")
    op.execute(
        "UPDATE stock_movement t "
        "SET location_id = a.location_id, acting_store_id = t.store_id "
        "FROM store_location_access a WHERE a.store_id = t.store_id"
    )
    op.execute(f"ALTER TABLE stock_movement ENABLE TRIGGER {LEDGER_TRIGGER}")

    # A sale's stock key *was* its store, so this is what the goods actually
    # left; likewise a refund restocked into the sale's store.
    op.execute(
        "UPDATE sale_item si SET source_location_id = a.location_id "
        "FROM sale s, store_location_access a "
        "WHERE s.id = si.sale_id AND a.store_id = s.store_id"
    )
    op.execute(
        "UPDATE refund_item ri SET destination_location_id = a.location_id "
        "FROM refund r, store_location_access a "
        "WHERE r.id = ri.refund_id AND a.store_id = r.store_id AND ri.restock IS TRUE"
    )

    # --- 4. assertions ------------------------------------------------------
    for condition, table in (
        ("NOT EXISTS (SELECT 1 FROM inventory WHERE location_id IS NULL)", "inventory"),
        ("NOT EXISTS (SELECT 1 FROM stock_lot WHERE location_id IS NULL)", "stock_lot"),
        (
            "NOT EXISTS (SELECT 1 FROM stock_movement WHERE location_id IS NULL)",
            "stock_movement",
        ),
        (
            "NOT EXISTS (SELECT 1 FROM inventory_snapshot "
            "WHERE store_id IS NOT NULL AND location_id IS NULL)",
            "inventory_snapshot",
        ),
    ):
        _assert(condition, f"{table} backfill incomplete")
    _assert(
        "NOT EXISTS (SELECT 1 FROM sale_item WHERE source_location_id IS NULL)",
        "sale_item backfill incomplete",
    )
    _assert(
        "NOT EXISTS (SELECT 1 FROM refund_item "
        "WHERE (restock IS TRUE) <> (destination_location_id IS NOT NULL))",
        "refund_item destination must be present exactly where restock is true",
    )
    _assert(
        "NOT EXISTS (SELECT 1 FROM stock_movement WHERE acting_store_id IS NULL)",
        "every historical movement was caused by a store",
    )

    # Every backfilled row must name the location its own store maps to. Both
    # columns still exist at this point, so the mapping can be checked row by
    # row instead of inferred from an aggregate — a ledger backfilled from the
    # wrong store is caught here whether or not the balances still reconcile.
    for condition, table in (
        (
            "NOT EXISTS (SELECT 1 FROM inventory t JOIN store_location_access a "
            "ON a.store_id = t.store_id WHERE t.location_id <> a.location_id)",
            "inventory",
        ),
        (
            "NOT EXISTS (SELECT 1 FROM stock_lot t JOIN store_location_access a "
            "ON a.store_id = t.store_id WHERE t.location_id <> a.location_id)",
            "stock_lot",
        ),
        (
            "NOT EXISTS (SELECT 1 FROM stock_movement t JOIN store_location_access a "
            "ON a.store_id = t.store_id "
            "WHERE t.location_id <> a.location_id OR t.acting_store_id <> t.store_id)",
            "stock_movement",
        ),
        (
            "NOT EXISTS (SELECT 1 FROM inventory_snapshot t JOIN store_location_access a "
            "ON a.store_id = t.store_id WHERE t.location_id <> a.location_id)",
            "inventory_snapshot",
        ),
        (
            "NOT EXISTS (SELECT 1 FROM sale_item si JOIN sale s ON s.id = si.sale_id "
            "JOIN store_location_access a ON a.store_id = s.store_id "
            "WHERE si.source_location_id <> a.location_id)",
            "sale_item",
        ),
        (
            "NOT EXISTS (SELECT 1 FROM refund_item ri JOIN refund r ON r.id = ri.refund_id "
            "JOIN store_location_access a ON a.store_id = r.store_id "
            "WHERE ri.restock IS TRUE AND ri.destination_location_id <> a.location_id)",
            "refund_item",
        ),
    ):
        _assert(condition, f"{table} was backfilled from the wrong store")

    # The reconciliation set must also be IDENTICAL, not empty: a divergence
    # that already existed has to survive visibly rather than be tidied away.
    # Note what this one is and is not. It proves the *shape* of the ledger's
    # disagreement with the balances is unchanged; on data where nothing
    # diverges it has nothing to compare and passes regardless. The per-row
    # assertions above are what catch a wrong backfill on healthy data.
    _assert(
        """NOT EXISTS (
            SELECT 1 FROM (
                SELECT COALESCE(i.store_id, m.store_id) AS store_id,
                       COALESCE(i.product_variant_id, m.product_variant_id) AS variant,
                       COALESCE(i.size_id, m.size_id) AS size,
                       COALESCE(i.quantity, 0) - COALESCE(m.d, 0) AS diff
                FROM inventory i
                FULL OUTER JOIN (SELECT store_id, product_variant_id, size_id,
                                        SUM(quantity_delta) AS d
                                 FROM stock_movement
                                 GROUP BY store_id, product_variant_id, size_id) m
                  ON m.store_id = i.store_id
                 AND m.product_variant_id = i.product_variant_id
                 AND m.size_id = i.size_id
                WHERE COALESCE(i.quantity, 0) <> COALESCE(m.d, 0)
            ) old
            FULL OUTER JOIN (
                SELECT COALESCE(i.location_id, m.location_id) AS location_id,
                       COALESCE(i.product_variant_id, m.product_variant_id) AS variant,
                       COALESCE(i.size_id, m.size_id) AS size,
                       COALESCE(i.quantity, 0) - COALESCE(m.d, 0) AS diff
                FROM inventory i
                FULL OUTER JOIN (SELECT location_id, product_variant_id, size_id,
                                        SUM(quantity_delta) AS d
                                 FROM stock_movement
                                 GROUP BY location_id, product_variant_id, size_id) m
                  ON m.location_id = i.location_id
                 AND m.product_variant_id = i.product_variant_id
                 AND m.size_id = i.size_id
                WHERE COALESCE(i.quantity, 0) <> COALESCE(m.d, 0)
            ) new
              ON new.location_id = (SELECT location_id FROM store_location_access
                                    WHERE store_id = old.store_id)
             AND new.variant = old.variant AND new.size = old.size
             AND new.diff = old.diff
            WHERE old.store_id IS NULL OR new.location_id IS NULL
        )""",
        "reconciliation divergence set changed across the re-key",
    )
    _assert(
        "(SELECT tgenabled FROM pg_trigger WHERE tgname = 'stock_movement_is_append_only') = 'O'",
        "the append-only ledger trigger was not restored",
    )

    # --- 5. tighten, swap keys, drop the old column ------------------------
    for table in ("inventory", "stock_lot", "stock_movement"):
        op.alter_column(table, "location_id", nullable=False)

    op.drop_constraint("uq_inventory_store_variant_size", "inventory", type_="unique")
    op.drop_index("ix_stock_lot_store_variant", table_name="stock_lot")
    op.drop_index("ix_stock_movement_key", table_name="stock_movement")
    for table in STOCK_TABLES:
        op.drop_column(table, "store_id")

    op.create_unique_constraint(
        "uq_inventory_location_variant_size",
        "inventory",
        ["location_id", "product_variant_id", "size_id"],
    )
    op.create_index(
        "ix_stock_lot_location_variant",
        "stock_lot",
        ["location_id", "product_variant_id", "size_id"],
    )
    op.create_index(
        "ix_stock_movement_key",
        "stock_movement",
        ["location_id", "product_variant_id", "size_id", "created_at"],
    )
    op.create_index("ix_sale_item_source_location", "sale_item", ["source_location_id"])

    # --- 6. constraints ----------------------------------------------------
    op.create_foreign_key(
        "fk_inventory_location_id_stock_location",
        "inventory",
        "stock_location",
        ["location_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_sale_item_source_location_id_stock_location",
        "sale_item",
        "stock_location",
        ["source_location_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_refund_item_destination_location_id_stock_location",
        "refund_item",
        "stock_location",
        ["destination_location_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    # Composite, so a row cannot reach another organization's location or store.
    op.create_foreign_key(
        "fk_inventory_snapshot_org_location",
        "inventory_snapshot",
        "stock_location",
        ["organization_id", "location_id"],
        ["organization_id", "id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_stock_lot_org_location",
        "stock_lot",
        "stock_location",
        ["organization_id", "location_id"],
        ["organization_id", "id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_stock_movement_org_location",
        "stock_movement",
        "stock_location",
        ["organization_id", "location_id"],
        ["organization_id", "id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_stock_movement_org_acting_store",
        "stock_movement",
        "store",
        ["organization_id", "acting_store_id"],
        ["organization_id", "id"],
        ondelete="RESTRICT",
    )
    op.alter_column("sale_item", "source_location_id", nullable=False)
    op.create_check_constraint(
        "acting_store_required",
        "stock_movement",
        "movement_type IN ('TRANSFER_IN', 'TRANSFER_OUT') OR acting_store_id IS NOT NULL",
    )
    op.create_check_constraint(
        "destination_matches_restock",
        "refund_item",
        "(restock IS TRUE) = (destination_location_id IS NOT NULL)",
    )

    # --- 7. transfers move between locations -------------------------------
    # The table has never been written by any code path, so there is nothing
    # to convert; `initiating_store_id` keeps the permission check a subject.
    op.drop_constraint("stores_differ", "transfer", type_="check")
    op.add_column(
        "transfer",
        sa.Column("from_location_id", postgresql.UUID(as_uuid=True), nullable=False),
    )
    op.add_column(
        "transfer", sa.Column("to_location_id", postgresql.UUID(as_uuid=True), nullable=False)
    )
    op.alter_column("transfer", "from_store_id", new_column_name="initiating_store_id")
    # Renaming a column does not rename the constraint built from its name, and
    # `alembic check` compares columns, not names — so without this a migrated
    # database and a freshly created one differ in a way nothing would report.
    op.execute(
        "ALTER TABLE transfer RENAME CONSTRAINT fk_transfer_from_store_id_store "
        "TO fk_transfer_initiating_store_id_store"
    )
    op.drop_column("transfer", "to_store_id")
    op.create_foreign_key(
        "fk_transfer_from_location_id_stock_location",
        "transfer",
        "stock_location",
        ["from_location_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_transfer_to_location_id_stock_location",
        "transfer",
        "stock_location",
        ["to_location_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint("locations_differ", "transfer", "from_location_id <> to_location_id")


def downgrade() -> None:
    """Reverse the re-key, but only from the exact shape this migration left.

    The window is the whole safety story. `store_location_access` is the
    store<->location mapping, and it answers "which store owns this location's
    rows" only while every location has exactly one store and every store has
    exactly one location — the bijection `upgrade()` creates. The moment a
    second store is granted access to a shared warehouse, or a second warehouse
    is provisioned for one store, or a transfer moves goods across locations,
    the question stops having an answer.

    So the guards below check the *shape* rather than trying to recognise the
    rows this migration wrote. That matters for the cleanup at the end: names
    and codes can be edited afterwards, so deleting "the locations that look
    migration-made" would strand a renamed one, leave the database half
    re-keyed, and block any attempt to upgrade again. Proving the bijection
    first means every location present *is* one of ours and can go.

    Anything outside that shape is refused with its reason, before any DDL
    runs. Refusing is the safe half of the bargain: the alternative is deleting
    a warehouse somebody deliberately created.
    """
    op.execute(
        """DO $$ BEGIN
        IF EXISTS (
            SELECT 1 FROM store_location_access GROUP BY location_id HAVING count(*) > 1
        ) THEN
            RAISE EXCEPTION
                'Cannot downgrade: a location is shared by several stores, so '
                'its rows cannot be attributed back to one store';
        END IF;
        IF EXISTS (
            SELECT 1 FROM store_location_access GROUP BY store_id HAVING count(*) > 1
        ) THEN
            RAISE EXCEPTION
                'Cannot downgrade: a store reaches several locations, so its '
                'rows cannot be re-keyed onto a single store_id';
        END IF;
        IF EXISTS (
            SELECT 1 FROM stock_location l
            WHERE NOT EXISTS (SELECT 1 FROM store_location_access a WHERE a.location_id = l.id)
        ) THEN
            RAISE EXCEPTION
                'Cannot downgrade: a location exists that no store reaches; '
                'downgrading would either delete it or strand it';
        END IF;
        END $$"""
    )

    op.drop_constraint("locations_differ", "transfer", type_="check")
    op.drop_constraint("fk_transfer_to_location_id_stock_location", "transfer", type_="foreignkey")
    op.drop_constraint(
        "fk_transfer_from_location_id_stock_location", "transfer", type_="foreignkey"
    )
    op.alter_column("transfer", "initiating_store_id", new_column_name="from_store_id")
    op.execute(
        "ALTER TABLE transfer RENAME CONSTRAINT fk_transfer_initiating_store_id_store "
        "TO fk_transfer_from_store_id_store"
    )
    op.add_column(
        "transfer", sa.Column("to_store_id", postgresql.UUID(as_uuid=True), nullable=False)
    )
    op.drop_column("transfer", "to_location_id")
    op.drop_column("transfer", "from_location_id")
    op.create_check_constraint("stores_differ", "transfer", "from_store_id <> to_store_id")

    op.drop_constraint("destination_matches_restock", "refund_item", type_="check")
    op.drop_constraint("acting_store_required", "stock_movement", type_="check")
    for name, table in (
        ("fk_stock_movement_org_acting_store", "stock_movement"),
        ("fk_stock_movement_org_location", "stock_movement"),
        ("fk_stock_lot_org_location", "stock_lot"),
        ("fk_refund_item_destination_location_id_stock_location", "refund_item"),
        ("fk_sale_item_source_location_id_stock_location", "sale_item"),
        ("fk_inventory_snapshot_org_location", "inventory_snapshot"),
        ("fk_inventory_location_id_stock_location", "inventory"),
    ):
        op.drop_constraint(name, table, type_="foreignkey")

    op.drop_index("ix_sale_item_source_location", table_name="sale_item")
    op.drop_index("ix_stock_movement_key", table_name="stock_movement")
    op.drop_index("ix_stock_lot_location_variant", table_name="stock_lot")
    op.drop_constraint("uq_inventory_location_variant_size", "inventory", type_="unique")

    for table in STOCK_TABLES:
        op.add_column(table, sa.Column("store_id", postgresql.UUID(as_uuid=True), nullable=True))

    op.execute(f"ALTER TABLE stock_movement DISABLE TRIGGER {LEDGER_TRIGGER}")
    for statement in (
        "UPDATE inventory t SET store_id = a.store_id "
        "FROM store_location_access a WHERE a.location_id = t.location_id",
        "UPDATE stock_lot t SET store_id = a.store_id "
        "FROM store_location_access a WHERE a.location_id = t.location_id",
        "UPDATE stock_movement t SET store_id = a.store_id "
        "FROM store_location_access a WHERE a.location_id = t.location_id",
        "UPDATE inventory_snapshot t SET store_id = a.store_id "
        "FROM store_location_access a WHERE a.location_id = t.location_id",
    ):
        op.execute(statement)
    op.execute(f"ALTER TABLE stock_movement ENABLE TRIGGER {LEDGER_TRIGGER}")
    _assert(
        "(SELECT tgenabled FROM pg_trigger WHERE tgname = 'stock_movement_is_append_only') = 'O'",
        "the append-only ledger trigger was not restored",
    )

    for table in ("inventory", "stock_lot", "stock_movement"):
        op.alter_column(table, "store_id", nullable=False)
        op.create_foreign_key(
            f"fk_{table}_store_id_store", table, "store", ["store_id"], ["id"], ondelete="RESTRICT"
        )
    op.create_foreign_key(
        "fk_inventory_snapshot_store_id_store",
        "inventory_snapshot",
        "store",
        ["store_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    op.create_unique_constraint(
        "uq_inventory_store_variant_size",
        "inventory",
        ["store_id", "product_variant_id", "size_id"],
    )
    op.create_index(
        "ix_stock_lot_store_variant", "stock_lot", ["store_id", "product_variant_id", "size_id"]
    )
    op.create_index(
        "ix_stock_movement_key",
        "stock_movement",
        ["store_id", "product_variant_id", "size_id", "created_at"],
    )

    op.drop_column("refund_item", "destination_location_id")
    op.drop_column("sale_item", "source_location_id")
    op.drop_column("stock_movement", "acting_store_id")
    for table in STOCK_TABLES:
        op.drop_column(table, "location_id")

    # Every remaining location is one this migration created — the guards at
    # the top proved the bijection, and anything else was refused there — so
    # they all go, whatever they have since been renamed to. `0005` leaves the
    # two tables empty, which is exactly where this puts them back.
    op.execute("DELETE FROM store_location_access")
    op.execute("DELETE FROM stock_location")
