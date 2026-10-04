"""The drawer: how each payment was made, and the day's close (ADR-0012).

One drawer per store, closed once a day by counting it blind; cash taken out
or put in, with who and why; and a wrong way of paying corrected by a new
row, never by rewriting the sale, the payment or the refund (owner
decisions, 2026-10-04).

It reads the money rows of `sales`, `credit` and `refunds` and moves no
goods. None of those modules imports it: a money row is placed in its
drawer's period by the database (revision 0035), and the API merges the
current way of paying into their answers. Only the API, the sales report and
the watcher depend on it.
"""
