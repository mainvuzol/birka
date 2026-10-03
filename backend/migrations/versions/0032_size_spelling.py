"""One size, one spelling. Owner decision, 2026-10-03; ADR-0009.

A size was stored as typed, inside its size system, so `M` and `m`, or `M`
under two systems, were two sizes with two balances. The owner decided which
spellings are one size, that a size is shown in one spelling, and that the
size system does not separate sizes (business-rules.md, "one size, one
spelling"). This revision gives the schema that:

- **`size.organization_id`**, filled and kept from the size system by the
  trigger `birka_size_organization`, so a key can span every system of an
  organization.
- **Every ordinary size is respelt** with the spelling of this revision (a
  frozen copy of `catalog.sizes.spell_size`, below). Two sizes of one
  organization that would become one refuse the upgrade, naming them:
  joining them would move stock between balances, which no rule decides. So
  does a spelling longer than the column, or one that would be `UNKNOWN`,
  reserved for "size not known".
- **`uq_size_org_spelling`**: one ordinary size per `lower(code)` in an
  organization. "Size not known" stays outside it, kept one per system by
  `uq_size_system_code`.

Offline (`--sql`) there are no rows to respell, so the rendered script
refuses to run over a database holding an ordinary size.

**Downgrade** drops what this adds. Respelt codes stay: they are only the
spelling, and the schema before this revision takes them as they are.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict

import sqlalchemy as sa
from alembic import context, op
from sqlalchemy.dialects import postgresql

revision: str = "0032_size_spelling"
down_revision: str | None = "0031_catalog_correction"
branch_labels: str | None = None
depends_on: str | None = None

# The spelling of this revision, frozen: `catalog.sizes` may change later,
# and history must not change with it.
_CODE_LIMIT = 20
_DASHES = str.maketrans(dict.fromkeys("‐‑‒–—―−", "-"))
_AROUND_SEPARATOR = re.compile(r" ?([-/]) ?")
_WORD = re.compile(r"[^\W_]+(?:['’ʼ][^\W_]+)*")
_CYRILLIC = str.maketrans({"х": "x", "л": "l", "с": "s", "м": "m"})
_LETTER_SIZE = re.compile(r"M|X*[SL]|(?P<count>[1-9][0-9]*)X(?P<end>[SL])")
_LATIN = re.compile(r"[a-z]+")


def _spell_word(word: str) -> str:
    letters = word.casefold().translate(_CYRILLIC).upper()
    match = _LETTER_SIZE.fullmatch(letters)
    if match is None:
        return _LATIN.sub(lambda latin: latin.group().upper(), word)
    if match["count"]:
        return "X" * min(int(match["count"]), _CODE_LIMIT) + match["end"]
    return letters


def _spell(code: str) -> str:
    text = " ".join(unicodedata.normalize("NFKC", code).split())
    text = _AROUND_SEPARATOR.sub(r"\1", text.translate(_DASHES))
    return unicodedata.normalize("NFKC", _WORD.sub(lambda word: _spell_word(word.group()), text))


def _respell() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT size.id, size.organization_id, size.code, size_system.code AS system "
            "FROM size JOIN size_system ON size_system.id = size.size_system_id "
            "WHERE NOT size.is_unknown ORDER BY size.organization_id, size.code"
        )
    ).all()
    spelt = {row.id: _spell(row.code) for row in rows}
    together: dict[tuple[object, str], list[sa.Row]] = defaultdict(list)
    for row in rows:
        together[(row.organization_id, spelt[row.id].lower())].append(row)
    # Named in one order whatever the database's collation.
    problems = [
        "become one size: "
        + ", ".join(
            f"«{row.code}» ({row.system})"
            for row in sorted(group, key=lambda row: (row.code, str(row.system)))
        )
        + f" in organization {group[0].organization_id}"
        for group in together.values()
        if len(group) > 1
    ]
    problems += [
        f"«{row.code}» ({row.system}) is longer than {_CODE_LIMIT} characters written out"
        for row in rows
        if len(spelt[row.id]) > _CODE_LIMIT
    ]
    # Reserved for "size not known", which only a legacy stock list states.
    problems += [
        f"«{row.code}» ({row.system}) would be written UNKNOWN"
        for row in rows
        if spelt[row.id].casefold() == "unknown"
    ]
    if problems:
        raise RuntimeError(
            "Cannot upgrade: these sizes cannot take their one spelling. Joining two sizes "
            "would move stock between their balances, which no rule decides; correct them "
            "by hand first. " + "; ".join(problems)
        )
    for row in rows:
        if spelt[row.id] != row.code:
            bind.execute(
                sa.text("UPDATE size SET code = :code WHERE id = :id"),
                {"code": spelt[row.id], "id": row.id},
            )


def upgrade() -> None:
    op.add_column(
        "size", sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.execute(
        "UPDATE size SET organization_id = size_system.organization_id "
        "FROM size_system WHERE size_system.id = size.size_system_id"
    )
    op.alter_column("size", "organization_id", nullable=False)
    op.create_foreign_key(
        "fk_size_organization_id_organization",
        "size",
        "organization",
        ["organization_id"],
        ["id"],
        ondelete="CASCADE",
    )
    # The size system's organization, whatever a writer says: nothing needs
    # to pass it, and nothing can pass a wrong one.
    op.execute(
        """CREATE FUNCTION birka_size_organization() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE
            system_organization uuid;
        BEGIN
            IF TG_OP = 'UPDATE' AND (
                NEW.size_system_id <> OLD.size_system_id
                OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
            ) THEN
                RAISE EXCEPTION 'A size never moves to another size system or organization'
                    USING ERRCODE = 'check_violation';
            END IF;
            SELECT organization_id INTO system_organization
                FROM size_system WHERE id = NEW.size_system_id;
            IF NEW.organization_id IS NULL THEN
                NEW.organization_id := system_organization;
            ELSIF NEW.organization_id <> system_organization THEN
                RAISE EXCEPTION 'A size belongs to the organization of its size system'
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END $$"""
    )
    op.execute(
        "CREATE TRIGGER size_organization BEFORE INSERT OR UPDATE ON size "
        "FOR EACH ROW EXECUTE FUNCTION birka_size_organization()"
    )

    if context.is_offline_mode():
        op.execute(
            """DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM size WHERE NOT is_unknown) THEN
                RAISE EXCEPTION
                    'Cannot upgrade from a rendered script: sizes are respelt row by row; '
                    'run this revision against the database';
            END IF;
            END $$"""
        )
    else:
        _respell()

    op.execute(
        "CREATE UNIQUE INDEX uq_size_org_spelling ON size (organization_id, lower(code)) "
        "WHERE NOT is_unknown"
    )


def downgrade() -> None:
    op.execute("DROP INDEX uq_size_org_spelling")
    op.execute("DROP TRIGGER size_organization ON size")
    op.execute("DROP FUNCTION birka_size_organization()")
    op.drop_constraint("fk_size_organization_id_organization", "size", type_="foreignkey")
    op.drop_column("size", "organization_id")
