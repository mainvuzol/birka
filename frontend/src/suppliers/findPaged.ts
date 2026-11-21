/** The most a supplier's returns or invoices are given a page. */
const PAGE = 50;
/** The furthest page the server reads (`offset`). */
const LAST_OFFSET = 10000;

/**
 * One return or invoice, which the server has no read of alone, found among
 * its supplier's page by page, fifty a page, newest first (audit
 * 2026-11-20, money Н1, Н2): as «Зарахувати повернення» reads them. `null`
 * once every page is read without it, or past the server's furthest page.
 * A row made between two pages moves the older ones down by one: one read
 * twice, never one missed.
 */
export async function findPaged<T extends { id: string }>(
  read: (page: string) => Promise<{ items: T[]; has_more: boolean }>,
  id: string,
): Promise<T | null> {
  for (let offset = 0; offset <= LAST_OFFSET; offset += PAGE) {
    const page = await read(`&limit=${String(PAGE)}&offset=${String(offset)}`);
    const found = page.items.find((item) => item.id === id);
    if (found) return found;
    if (!page.has_more) return null;
  }
  return null;
}
