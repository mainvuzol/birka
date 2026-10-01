# What to build next

Work the owner asked for, or that waits on the owner, and is not built yet.
None of it blocks the release (see the [release checklist](release-checklist.md)).
Before anything here is built, the owner answers the open questions under it.
Nothing is invented in the meantime.

## Where an order goes — Ukraine or abroad

The owner asked for it on 2026-10-01. Today an order knows only its delivery
status, from «До відправлення» to «Клієнт забрав»
([customer orders](customer-orders-report.md)). It does not record where the
goods go, nor how they were sent.

- **An order says whether it goes within Ukraine or abroad.** Within
  Ukraine is the default.
- **Within Ukraine:**
  - the carrier: «Нова пошта», «Укрпошта» or «Міст» (Meest);
  - a field for the waybill number.
- **Abroad:** one free-text field. City, country and how it was sent are all
  written there together.

Still to ask the owner:
- **When:** is it filled in when the order is made, when it is sent, or
  either?
- **Required:** is it needed before an order can be marked sent?
- **Corrections:** can it be corrected afterwards, by whom, and is the old
  value kept?
- **Who:** who fills it in and who sees it — a seller, a manager, the owner?
- **The waybill:** is the number only written down, or checked — its
  format, or that no two orders share one?
- **Abroad:** is "how it was sent" a carrier picked from a list too, or
  free text only?
- **The recipient:** is a name, phone or address recorded? That is personal
  data, kept like the customers' phones in «Борги».

## The JSON stock import

Existing stock from photos of the notebooks: a separate parser turns them
into JSON, which the app imports into a list for review (owner, 2026-10-01).
It waits for the owner to choose this way, and for the parser's format.

## Settling money between stores

A store records money it paid out for another store's sale (returns at
another store), and payments it took for another store's debt (store
states). Nothing adds these up between stores, or marks them settled. It
waits for the owner's rules.
