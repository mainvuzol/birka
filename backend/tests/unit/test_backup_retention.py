"""The owner's retention (2026-09-30): every daily backup 7 days, the first
backup of each calendar month 3 months, and nothing else."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from scripts.nightly_backup import (
    Backup,
    backups_in,
    months_before,
    prune,
    recipients_from,
    to_keep,
)

NIGHT = timedelta(days=1)


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def night(moment: datetime, *, verified: bool = True) -> Backup:
    return Backup(taken_at=moment, files=(), verified=verified)


def write_night(directory: Path, moment: datetime, *, ok: bool = True) -> None:
    stem = f"birka-{moment:%Y%m%dT%H%M%SZ}"
    (directory / f"{stem}.dump.age").write_bytes(b"sealed")
    (directory / f"{stem}.json").write_text("{}")
    (directory / f"{stem}.drill.json").write_text(json.dumps({"ok": ok}))


@pytest.mark.parametrize(
    ("moment", "expected"),
    [
        ("2026-09-30T03:00:00", "2026-06-30T03:00:00"),
        ("2026-05-31T03:00:00", "2026-02-28T03:00:00"),
        ("2028-05-31T03:00:00", "2028-02-29T03:00:00"),
        ("2026-02-15T03:00:00", "2025-11-15T03:00:00"),
        ("2026-01-01T00:00:00", "2025-10-01T00:00:00"),
    ],
)
def test_three_months_back_is_a_calendar_step(moment, expected):
    assert months_before(at(moment), 3) == at(expected)


def test_the_last_seven_days_are_all_kept():
    now = at("2026-09-30T03:30:00")
    nights = [night(now - NIGHT * days) for days in range(10, -1, -1)]
    kept = to_keep(nights, now)
    assert {now - NIGHT * days for days in range(7)} <= kept
    assert now - NIGHT * 8 not in kept


def test_the_first_of_each_month_is_kept_three_months():
    now = at("2026-09-30T03:30:00")
    nights = [
        night(at("2026-06-01T03:00:00")),  # older than 3 months on the 30th of September
        night(at("2026-07-01T03:00:00")),
        night(at("2026-07-02T03:00:00")),
        night(at("2026-08-01T03:00:00")),
        night(at("2026-09-01T03:00:00")),
        night(at("2026-09-15T03:00:00")),
        night(now),
    ]
    assert to_keep(nights, now) == {
        at("2026-07-01T03:00:00"),
        at("2026-08-01T03:00:00"),
        at("2026-09-01T03:00:00"),
        now,
    }


def test_a_month_keeps_its_first_proven_backup_over_its_first():
    now = at("2026-09-30T03:30:00")
    failed = night(at("2026-08-01T03:00:00"), verified=False)
    proven = night(at("2026-08-02T03:00:00"))
    assert to_keep([failed, proven, night(now)], now) == {proven.taken_at, now}
    # With nothing proven in the month, its first night is still better than none.
    assert failed.taken_at in to_keep([failed, night(now)], now)


def test_the_newest_backup_is_never_deleted_however_old():
    now = at("2026-09-30T03:30:00")
    lone = night(at("2025-01-10T03:00:00"))
    assert to_keep([lone], now) == {lone.taken_at}
    assert to_keep([], now) == set()


def test_a_year_of_nights_keeps_at_most_ten_copies_and_every_promise():
    """Night after night for a year: at most 7 daily and 3 monthly copies;
    every night of the last week; each month's first night for 3 months."""
    now = at("2026-01-01T03:00:00")
    taken: list[datetime] = []
    history: list[Backup] = []
    for _ in range(366):
        taken.append(now)
        history.append(night(now))
        kept = to_keep(history, now)
        history = [b for b in history if b.taken_at in kept]
        held = {b.taken_at for b in history}

        assert len(history) <= 10
        assert {t for t in taken if t > now - 7 * NIGHT} <= held
        firsts: dict[tuple[int, int], datetime] = {}
        for moment in taken:
            firsts.setdefault((moment.year, moment.month), moment)
        assert {f for f in firsts.values() if f > months_before(now, 3)} <= held
        now += NIGHT


def test_prune_deletes_only_this_scripts_files(tmp_path):
    now = at("2026-09-30T03:30:00")
    write_night(tmp_path, at("2026-01-05T03:00:00"))
    write_night(tmp_path, now)
    foreign = [tmp_path / "notes.txt", tmp_path / "birka-latest.dump", tmp_path / "last-run.json"]
    for path in foreign:
        path.write_text("keep me")

    removed = prune(tmp_path, now)

    assert sorted(removed) == [
        "birka-20260105T030000Z.drill.json",
        "birka-20260105T030000Z.dump.age",
        "birka-20260105T030000Z.json",
    ]
    assert all(path.exists() for path in foreign)
    assert [b.taken_at for b in backups_in(tmp_path)] == [now]


def test_a_night_reads_as_proven_only_from_its_own_drill_report(tmp_path):
    write_night(tmp_path, at("2026-09-01T03:00:00"), ok=False)
    write_night(tmp_path, at("2026-09-02T03:00:00"))
    (tmp_path / "birka-20260903T030000Z.dump.age").write_bytes(b"no report")
    assert [b.verified for b in backups_in(tmp_path)] == [False, True, False]


def test_only_age_public_keys_are_accepted_as_recipients():
    key = "age1" + "q" * 58
    assert recipients_from(f" {key},{key} ") == [key, key]
    assert recipients_from(None) == []
    for wrong in ["age1short", "ssh-ed25519 AAAA", "AGE1" + "Q" * 58, "age1" + "b" * 58]:
        with pytest.raises(ValueError, match="Not an age public key"):
            recipients_from(wrong)
