# "Фізично відсутній" — recorded requirement and a proposed scenario

Raised by the owner on 2026-09-17, alongside the confirmation that a child-store seller may perform both **«фізично є»** (physically present) and **«фізично відсутній»** (physically absent) at a warehouse they can reach, with appropriate rights.

Status: **requirement recorded; not implemented; one narrow question open.** The owner's own instruction is that this must not be quietly equated with zeroing a balance or writing stock off, so nothing here has been built. M1-029 ships without it, and §5 explains why that is the safe order.

## 1. What exists today, and why the mirror image is not symmetric

`FOUND_DURING_SALE` (business fact F30) is the positive half and is implemented:

- a seller sells 2, the system says 0, the coats are on the rack;
- the correction adds **exactly the shortfall**, inside the sale's own transaction;
- reason code `FOUND_DURING_SALE`, narrow permission `inventory:correct_during_sale`, fully audited;
- invariant I18 caps it: over-correcting is `CORRECTION_EXCEEDS_SHORTFALL`.

The cap is what makes that permission safe to give a seller. The blast radius is "the exact number of units this sale needs", and it can only ever be reached by selling.

The negative half has **no natural cap**. "The shelf is emptier than the system thinks" is a statement about the shelf, not about the sale — and left uncapped, one seller confirming "there is nothing here" against a shared warehouse would remove an entire balance the other store also depends on. That is precisely what the owner warned against, and it is why this cannot be inferred from the positive case.

## 2. Proposed scenario — bounded, inside the sale

**[PROPOSED]** The scenario below is a concrete answer to "what quantity does the seller confirm, how does it affect the books, and who may do it". It is the narrowest shape that is useful, not the most general one.

### What the seller confirms

**The number of units actually present for the line they are selling** — never a delta, and never a whole-shelf count.

A seller taking 2 coats finds only 1. They confirm *"1 is here"*. The system then:

- sells the 1 that is there (the line's quantity is reduced to what was confirmed), and
- writes a **negative** `ADJUSTMENT` of exactly `requested − confirmed` for the same `(location, variant, size)`, with a new reason code `MISSING_AT_SALE`.

Stating the count rather than the shortage matters: a person counting a shelf knows what they see, and asking them to subtract is how off-by-one errors get into a ledger.

### The cap

**The correction may not exceed the quantity of the line being sold.** Sell 2, find 1 → at most 1 unit may be written down. A seller who opens a drawer expecting 50 and finds it empty **cannot** record that here: that is a stocktake, and it belongs to `inventory:adjust`, which stays with a manager or the owner.

This is the deliberate mirror of I18's "exactly the shortfall": both directions are bounded by the sale in front of the seller, and neither gives a seller authority over stock they are not currently handling.

### How it affects the books

- One `ADJUSTMENT` movement, negative, reason `MISSING_AT_SALE`, at the named warehouse, with `acting_store_id` set to the selling store.
- **Not a write-off.** The reason code is deliberately distinct from `DAMAGED` and `LOST`: at the moment of the sale nobody knows whether the coat was stolen, misfiled, already sold, or is in the other warehouse. The reason records *what was observed*, not a conclusion about why.
- The balance falls by the confirmed shortage, the ledger explains it, and invariant I3 still holds.
- Historical sale and refund facts are untouched.
- An audit entry records before/after and the acting store, exactly as `FOUND_DURING_SALE` already does.

### Who may do it

**[PROPOSED]** A new narrow permission, `inventory:report_missing_during_sale`, mirroring `inventory:correct_during_sale`:

- grantable to a seller, and **not implied** by `can_sell` access to a warehouse — reaching a warehouse never confers the right to change what is in it;
- separate from `inventory:adjust`, which remains manager/owner and is the only way to make an unbounded correction;
- the store must additionally hold `can_sell` at the warehouse in question (invariant I23).

Per the owner's instruction, this is **not** added to the default `SELLER` matrix by this proposal: whether every seller gets it is a role decision, and the default should be least privilege until the owner says otherwise.

## 3. The narrow question

Everything above follows from the owner's own framing except one point, and it cannot be defaulted safely:

> **Q-E — When a seller reports that goods are physically absent, should the sale proceed for the quantity that *is* there, or should the whole sale be refused until someone investigates?**
>
> *Proposed:* the sale proceeds for the confirmed quantity. A customer standing at the counter with one coat should be able to buy it, and refusing the sale would push staff back to the notebook — the thing this system exists to beat.
>
> *The alternative:* refuse the line entirely, so that a discrepancy always stops and is looked at before any money moves. Safer for the books, worse at the counter.
>
> Either is defensible; they differ in what a seller experiences several times a week, which is the owner's call and not an engineering one.

Two smaller points ride on the answer and are noted rather than asked, because the proposal above settles them conservatively unless the owner says otherwise: the cap (line quantity, §2), and the fact that `MISSING_AT_SALE` records an observation rather than a disposal.

## 4. What is deliberately *not* proposed

- **Zeroing a balance.** No path here can set a quantity to zero except by coincidence of the numbers.
- **A write-off.** `MISSING_AT_SALE` is not `LOST`, not `DAMAGED`, and creates no financial entry.
- **A standalone "the shelf is wrong" endpoint.** That is a stocktake, needs `inventory:adjust`, and already exists as `POST /inventory/adjustments`.
- **Any change to how refunds, prices or historical facts work.**

## 5. Why M1-029 ships without it

The re-key had to land first, and it is independent of this: `MISSING_AT_SALE` is a movement at a `(location, variant, size)` key, and that key only exists correctly after M1-029. Building the negative correction on the old store-keyed model would have meant writing it twice.

It is also the honest order. The owner asked for this to be recorded and given a concrete shape rather than assumed, and one question is genuinely open. Implementing it now would mean choosing Q-E silently, which is the one thing the instruction ruled out.

## 6. Implementation sketch, once Q-E is answered

Small, and contained by the work M1-029 already did:

1. `MovementReason.MISSING_AT_SALE` and `Permission.INVENTORY_REPORT_MISSING_DURING_SALE`; migration for the enum value only.
2. A `missing_in_store` list on `POST /sales`, shaped exactly like `found_in_store` — a line index and the confirmed quantity — validated in `_resolve_corrections` beside the positive case, capped by the line quantity.
3. Both directions refused together when a line appears in both lists: a seller cannot say a coat is simultaneously present and absent.
4. Tests mirroring the `FOUND_DURING_SALE` set: exact cap, over-report refused, permission required, shared-warehouse blast radius bounded, audit entry present, reconciliation clean, and a concurrency case where one seller reports missing while another sells the same shared row.
