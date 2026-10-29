import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, CONFLICT_TEXT, errorText, INVALID_TEXT } from "@/shared/api";
import type { ApiError } from "@/shared/api";
import { decimal, kopecks, money } from "@/orders/types";
import type { Location, StockOption, Store } from "@/orders/types";
import type { SizeOption } from "@/inventory/receiptTypes";
import { asInput } from "@/prices/SuggestedPrice";
import { sizeLabel } from "@/returns/types";
import { TermsFields, checkTerms, noTerms } from "@/credits/Terms";
import type { TermsInput } from "@/credits/Terms";
import { methodLabels, tillMethods } from "@/shared/payment";
import type { PaymentMethod, TillMethod } from "@/shared/payment";
import { Eyelet, RecordedMark } from "@/shared/Eyelet";
import { SendingLine } from "@/shared/Sending";
import { Banner } from "@/shared/Banner";
import { Perforation, Stub, WaySticker } from "@/shared/Stub";
import { backNoted, useReach } from "@/shared/reach";
import { buzz } from "@/shared/telegram";
import { usePanelRoom } from "@/shared/panel";
import { Sum } from "@/shared/Sum";
import { visible } from "@/shared/visible";
import { Placeholder } from "@/shared/Placeholder";
import { submitSale, useSaleCommand } from "./commands";
import { StockSearch, useSettled, useStock } from "./StockSearch";
import { PriceHint, priceText } from "./PriceHint";
import { setPaper, setSoldBy, usePaper } from "./paper";
import { forgetBasket, keepBasket, keptBasket } from "./basket";
import type { Basket, Draft } from "./basket";
import {
  PaperKind,
  PaperWhen,
  paperAt,
  paperWhenProblem,
  tooOldText,
} from "./paperMark";
import { FromCatalog } from "./FromCatalog";
import type {
  EmptyShelf,
  OutageBody,
  SaleLine,
  Sale as SaleReceipt,
  Shortfall,
} from "./types";
import { markText, paidDuringOutage, stockKey } from "./types";

/**
 * A sale typed from paper refused for stock (owner decisions, 2026-10-04 and
 * 2026-10-07; ADR-0013 §6): never sold around the shortfall — nobody stands
 * at the shelf now — but after a manager fixes the balance, or, for units
 * reserved for an order, decides about the order.
 */
const paperGone =
  "Цього товару вже немає в обліку — продаж з паперу не записано. Попросіть менеджера спершу виправити залишок, потім внесіть цей продаж ще раз. Кошик збережено — нічого не продано.";
const paperReserved =
  "Частина цих одиниць у резерві замовлення — продаж з паперу не записано. Менеджер має вирішити із замовленням, потім внесіть цей продаж ще раз. Кошик збережено — нічого не продано.";

/** A price as sent: the one typed, once it reads as money; else none. */
function asPrice(typed: string): string {
  const cents = kopecks(typed);
  return cents === null ? "" : decimal(cents);
}

/**
 * The till.
 *
 * Two things make this screen different from reserving an order. It takes
 * money, so the command journal in `./commands` is what decides when a basket
 * may be sent again. And it must let the seller sell what they can *see*: a
 * shelf that disagrees with the ledger is the normal case this whole flow was
 * designed around, so a quantity above the recorded balance is offered to the
 * server rather than blocked here. The server refuses, names the shortfall,
 * and the seller answers it — «товар на місці» or «на місці лише стільько».
 *
 * A third answer exists where a legacy list left the same model here with its
 * size not known (ADR-0005 §11): the coat in hand is one of those, and its
 * label says M. The seller clarifies its size and it is sold as M, as an
 * audited pair of movements. «Товар на місці» is then not offered — the server
 * refuses it, because the coat could be counted twice. A coat held that way
 * whose size is on its label can also be sold with that size from the start,
 * which is how an M the system holds none of is sold at all.
 *
 * A coat is found by a few letters of its name or colour, and a tap on its
 * size puts it in the basket, its price already in the line (redesign P0-2,
 * P0-3). The seller sells with the way the customer pays: «Готівка»,
 * «Картка» or «Переказ» in place of «Продати», so a sale of one priced coat
 * takes three taps and nothing is guessed (owner decision, 2026-10-04;
 * ADR-0012 §B12). The press
 * comes first, then the terminal is charged the sum the receipt shows: it may
 * still change when a coat is not on the shelf.
 *
 * Sales written on paper while the server did not answer are typed here
 * once it does, with «Вношу продаж з паперу» ticked (owner decisions,
 * 2026-10-04 and 2026-10-07; ADR-0013 §7): each is marked «продано під час
 * збою», with who sold and the paper's time when known. Off by default, so a
 * live sale takes no extra tap and its body carries no mark. On, the till
 * offers nothing that describes the shelf now — nobody stands at it — and
 * the pay buttons say the mode, who sold and from which warehouse, since a
 * wrong mark can never be changed.
 */
export function Sale({
  store,
  token,
  userId,
  journalKey,
  blocked,
  fixMethod,
  returnSale,
  searchFirst = false,
  mode = null,
  keptAt,
}: {
  store: Store;
  token: string;
  /** Who is signed in: a sale typed from paper for someone else adds
   * nothing to their «Сьогодні ви продали» (owner decision, 2026-10-17). */
  userId: string;
  journalKey: string;
  blocked: boolean;
  /**
   * Opens «Каса»'s step that changes how this one sale was paid. Given, the
   * receipt offers «Змінити спосіб оплати»: a card the terminal refused, and
   * the customer paid another way (owner decision, 2026-10-04; ADR-0012
   * §B6.4).
   */
  fixMethod?: (sale: SaleReceipt) => void;
  /**
   * Opens «Повернення» on this sale, for whoever may take returns: a sale is
   * never changed, a mistake is returned and sold again (I8; redesign P1-2).
   */
  returnSale?: (sale: SaleReceipt) => void;
  /**
   * Opened by a return's «Новий продаж»: the cursor goes to the search once
   * it is there (returns task list, P0-5).
   */
  searchFirst?: boolean;
  /**
   * «Продати | Повернути» under the heading, for whoever does both
   * (navigation task list, P0-1); none for anyone else.
   */
  mode?: JSX.Element | null;
  /**
   * Where this till's basket is kept while the till is left: the store and
   * how many kept sales have settled (navigation task list, P0-5).
   */
  keptAt: string;
}): JSX.Element {
  // Paper mode: the switch and «Хто продав» outlive this screen (`./paper`);
  // the paper's time is this sale's alone.
  const paper = usePaper((state) => state.storeId === store.id);
  const moved = usePaper((state) => state.moved);
  // The basket kept while the till was left (navigation task list, P0-5).
  // Empty, nothing is kept: paying in parts was the last customer's (review,
  // 2026-10-27). The switch moved meanwhile, on another screen, however
  // often: as the till's own would leave it — one built from paper, or any
  // once the paper is off, is gone, never sent unmarked; one built unmarked,
  // the paper now on, keeps its lines, not its shelf's answers
  // (`turnPaper`).
  const [kept] = useState<Basket | null>(() => {
    const basket = keptBasket(keptAt);
    if (basket === null || basket.draft.length === 0) return null;
    if (basket.moved === moved) return basket;
    return basket.paper || !paper
      ? null
      : {
          ...basket,
          paper,
          moved,
          found: {},
          missing: {},
          clarified: {},
          shortfall: null,
          present: "",
          method: null,
        };
  });
  const [locationId, setLocationId] = useState(kept?.locationId ?? "");
  // What the seller types to find a model (redesign P0-2).
  const [text, setText] = useState("");
  const query = useSettled(text);
  const searchRef = useRef<HTMLInputElement>(null);
  // A line put in the basket with no price to start from: its price field
  // takes the cursor (P0-3).
  const priceRefs = useRef(new Map<string, HTMLInputElement>());
  const [focusPrice, setFocusPrice] = useState<string | null>(null);
  // «Новий продаж» puts the cursor in the search (P0-3).
  const [focusSearch, setFocusSearch] = useState(searchFirst);
  const [draft, setDraft] = useState<Draft[]>(kept?.draft ?? []);
  const [commandId, setCommandId] = useState(
    () => kept?.commandId ?? crypto.randomUUID(),
  );
  const [found, setFound] = useState<Record<number, number>>(kept?.found ?? {});
  const [missing, setMissing] = useState<Record<number, number>>(
    kept?.missing ?? {},
  );
  const [clarified, setClarified] = useState<Record<number, number>>(
    kept?.clarified ?? {},
  );
  // `location:variant` keys this till has learned hold the model with its
  // size not known — from the server refusing «товар на місці» because of it.
  const [heldUnknown, setHeldUnknown] = useState<ReadonlySet<string>>(
    () => kept?.heldUnknown ?? new Set(),
  );
  const [shortfall, setShortfall] = useState<Shortfall | null>(
    kept?.shortfall ?? null,
  );
  const [refusal, setRefusal] = useState<unknown>(null);
  const [present, setPresent] = useState(kept?.present ?? "");
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  // Lines dropped from the receipt's sale because nothing was on the shelf.
  const [dropped, setDropped] = useState<string[]>([]);
  // Each line's size as the basket said it: the receipt's, for an answer
  // stored before the server named the size (redesign P1-1).
  const [sentSizes, setSentSizes] = useState<Record<string, string>>({});
  const [nothingSold, setNothingSold] = useState<EmptyShelf | null>(null);
  const [validation, setValidation] = useState("");
  // Paying in parts (owner decisions, 2026-10-01): the customer takes the
  // goods now, pays part and owes the rest to this store.
  const [credit, setCredit] = useState<TermsInput>(kept?.credit ?? noTerms);
  // The way the seller pressed. A shortfall's answers resend the same sale,
  // so they keep it and say it (ADR-0012 §B12); a changed basket forgets it.
  const [method, setMethod] = useState<TillMethod | null>(kept?.method ?? null);
  // Kept as it changes: whatever the till is left by, the basket is there.
  useEffect(() => {
    keepBasket(keptAt, {
      paper,
      moved,
      locationId,
      draft,
      commandId,
      found,
      missing,
      clarified,
      heldUnknown,
      shortfall,
      present,
      credit,
      method,
    });
  }, [
    keptAt,
    paper,
    moved,
    locationId,
    draft,
    commandId,
    found,
    missing,
    clarified,
    heldUnknown,
    shortfall,
    present,
    credit,
    method,
  ]);
  const soldBy = usePaper((state) =>
    state.storeId === store.id ? state.soldBy : null,
  );
  // Which paper the series is: the first days' or an outage's, said once
  // (owner decision, 2026-10-16); null until said, and nothing is sold.
  const firstDays = usePaper((state) =>
    state.storeId === store.id ? state.firstDays : null,
  );
  const [paperDate, setPaperDate] = useState("");
  const [paperTime, setPaperTime] = useState("");
  const [yesterday, setYesterday] = useState(false);
  const paperProblem = paperWhenProblem(firstDays, paperDate, paperTime);
  // Another kind of paper: its day and time are asked anew, never carried
  // over from the other's (review, 2026-10-16).
  useEffect(() => {
    setPaperDate("");
    setPaperTime("");
    setYesterday(false);
  }, [firstDays]);
  // This phone saw the server come back (redesign P1-7): the paper written
  // meanwhile is typed before the drawer closes, or it reads as a surplus and
  // a shortage. Said once, until answered or the next time it comes back;
  // never with the paper mode on, which answers it (`./paper`).
  const back = useReach((state) => state.back);
  const { busy, pending, firstSend } = useSaleCommand();
  const cache = useQueryClient();

  const mayCorrect = store.permissions.includes(
    "inventory:correct_during_sale",
  );
  const mayReportMissing = store.permissions.includes(
    "inventory:report_missing_during_sale",
  );
  // The organization's sizes come from the receiving endpoint, which asks
  // for `inventory:receive`; the default seller holds both.
  const mayReadLabel =
    mayCorrect && store.permissions.includes("inventory:receive");
  // A coat in hand the list does not show, found in the catalogue and sold
  // through «Товар на місці» (owner decision, 2026-10-14, В1 (а)): the same
  // two rights, and never from paper (ADR-0013 §6).
  const [fromCatalog, setFromCatalog] = useState(false);
  const mayCredit = store.permissions.includes("sale:credit");

  const locations = useQuery({
    queryKey: ["sale-locations", journalKey, store.id],
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
    retry: false,
  });
  // The warehouse sold from, named, and whether nothing has been recorded
  // there yet: nothing is sold or read there until its opening list or its
  // first delivery (owner decisions, 2026-10-02 and 2026-10-16; P1-5).
  const chosen = locations.data?.find((location) => location.id === locationId);
  const warehouse = chosen?.name ?? "";
  const waiting = chosen?.awaiting_first_stock === true;
  const sellable = (locations.data ?? []).filter(
    (location) => location.is_active && location.can_sell,
  );
  const onlyWarehouse = sellable.length === 1 ? sellable[0] : undefined;
  // A store that sells from two or more lists them all at once, unless the
  // seller narrows it to one; each chip says its warehouse and sells from
  // there (sale-slice TZ, P2-5; owner decision, 2026-10-17).
  const searchAll = sellable.length >= 2 && locationId === "";
  // Those still waiting for their opening list sell on paper meanwhile;
  // the others are listed (owner decision, 2026-10-17).
  const ready = sellable.filter((location) => !location.awaiting_first_stock);
  const stillWaiting = sellable.filter(
    (location) => location.awaiting_first_stock === true,
  );
  const places = useMemo(
    () =>
      searchAll
        ? new Map(
            (locations.data ?? [])
              .filter((location) => location.is_active && location.can_sell)
              .map((location) => [location.id, location.name]),
          )
        : null,
    [searchAll, locations.data],
  );
  // From the catalogue, with every warehouse listed: which one the coat in
  // hand is from, said by the seller, never guessed (owner decision,
  // 2026-09-17).
  const [catalogAt, setCatalogAt] = useState("");
  const catalogPlace = ready.find((location) => location.id === catalogAt);
  const stock = useStock({
    store,
    token,
    journalKey,
    locationId: searchAll ? null : locationId,
    query,
    enabled: !locations.isError && !waiting && (!searchAll || ready.length > 0),
  });
  const listed = (stock.data?.pages ?? []).flatMap((page) => page.items);
  const mayFindInCatalog = mayReadLabel && !paper;
  const sizes = useQuery({
    queryKey: ["sale-sizes", journalKey, store.id],
    queryFn: () =>
      api<SizeOption[]>(`/catalog/sizes?store_id=${store.id}`, token),
    enabled: mayReadLabel && !paper && draft.some((d) => d.unknownStock),
    retry: false,
  });
  // Who may be named as having sold: read only while the switch is on
  // (ADR-0013 §5.7). Only someone this list shows is ever sent.
  const sellers = useQuery({
    queryKey: ["sale-sellers", journalKey, store.id],
    queryFn: () =>
      api<{ sellers: { user_id: string; display_name: string }[] }>(
        `/stores/${store.id}/sellers`,
        token,
      ),
    enabled: paper,
    retry: false,
  });
  const named =
    soldBy === null
      ? undefined
      : sellers.data?.sellers.find((seller) => seller.user_id === soldBy);

  // A basket that changed is a different business operation, and any answer
  // given about the old one no longer applies to it.
  function replaceDraft(next: Draft[]): void {
    setDraft(next);
    setCommandId(crypto.randomUUID());
    setFound({});
    setMissing({});
    setClarified({});
    setShortfall(null);
    setPresent("");
    setMethod(null);
  }

  /**
   * The switch (G20). Ticked, the basket stays, and any answer about the
   * shelf already given goes: a marked sale may not carry one (§5.3).
   * Unticked, a basket built from paper goes, with its answers and its
   * `command_id`: sent unmarked, its shortfall would offer «Товар на місці»
   * and record a coat found that never was.
   */
  function turnPaper(on: boolean, firstDaysPaper: boolean | null = null): void {
    setPaper(store.id, on, firstDaysPaper);
    // From paper nobody stands at the shelf: no coat is found in hand.
    setFromCatalog(false);
    setPaperDate("");
    setPaperTime("");
    setYesterday(false);
    setRefusal(null);
    setValidation("");
    if (on) {
      setFound({});
      setMissing({});
      setClarified({});
      setShortfall(null);
      setPresent("");
      setMethod(null);
    } else if (draft.length > 0) replaceDraft([]);
  }

  useEffect(() => {
    if (locationId && locations.isSuccess) {
      // Paused, or no longer sold from: not the till's any more, though
      // still listed (review, 2026-10-15).
      const sellableHere = locations.data.some(
        (location) =>
          location.id === locationId && location.is_active && location.can_sell,
      );
      if (!sellableHere) setLocationId("");
    }
  }, [locationId, locations.isSuccess, locations.data]);

  // A line says its warehouse while every one is listed, or the basket holds
  // more than one (review, 2026-10-17): two «Лоран шоколад · M» are then
  // told apart, and a shortfall says which shelf to look at.
  const spans = new Set(draft.map((d) => d.line.source_location_id)).size > 1;
  const placeOf = (id: string): string =>
    searchAll || spans
      ? ` · ${visible(locations.data?.find((location) => location.id === id)?.name ?? "")}`
      : "";
  // Where the goods leave from, named on a paper sale's press: a store may
  // sell from two warehouses, and the paper says which (G21).
  const from = [
    ...new Set(
      (draft.length > 0
        ? draft.map((d) => d.line.source_location_id)
        : [locationId]
      )
        .map(
          (id) => locations.data?.find((location) => location.id === id)?.name,
        )
        .filter((name): name is string => name !== undefined),
    ),
  ];

  useEffect(() => {
    // Explicitly permitted: "the client may prefill it when the store reaches
    // only one warehouse, but the server never chooses" (sale API, owner
    // decision 2026-09-17). Two taps out of a measured eight, and the seller
    // is choosing nothing they had an alternative to.
    if (!locationId && onlyWarehouse) setLocationId(onlyWarehouse.id);
  }, [locationId, onlyWarehouse]);

  /**
   * A size chip tapped (redesign P0-3): the coat goes in the basket at its
   * price, or one more of it if it is there already. The agreed price is the
   * one sold at, so it stays editable in the line (owner decisions,
   * 2026-09-15 and 2026-10-01); a model with none leaves it empty, never a
   * previous one's, and its field takes the cursor.
   */
  function put(item: StockOption): void {
    // A chip's own warehouse; an answer from a server before it said one
    // is the warehouse chosen; and never none (the server never chooses).
    const place = item.location_id || locationId;
    if (!place) return;
    const line: SaleLine = {
      product_variant_id: item.product_variant_id,
      size_id: item.size_id,
      source_location_id: place,
      quantity: 1,
      unit_price: item.suggested_price ? asPrice(item.suggested_price) : "",
      discount_amount: "0.00",
    };
    const at = draft.findIndex((d) => stockKey(d.line) === stockKey(line));
    setValidation("");
    if (at >= 0) {
      const held = draft[at];
      if (held && held.line.quantity < 1000)
        change(at, { quantity: held.line.quantity + 1 });
      return;
    }
    if (draft.length >= 100) return;
    const id = crypto.randomUUID();
    replaceDraft([
      ...draft,
      {
        id,
        line,
        price: item.suggested_price ? asInput(item.suggested_price) : "",
        suggested: item.suggested_price,
        name: item.display_name,
        size: item.size_is_unknown ? "розмір невідомий" : item.size_label,
        stockSizeId: item.size_id,
        unknownStock: item.size_is_unknown,
        unknownNearby: listed.some(
          (other) =>
            (other.location_id || locationId) === place &&
            other.product_variant_id === item.product_variant_id &&
            other.size_is_unknown &&
            other.available_quantity > 0,
        ),
        unknownSize: item.size_is_unknown,
        fromUnknown: false,
      },
    ]);
    if (!item.suggested_price) setFocusPrice(id);
  }

  /** A line's quantity or price changed: a different basket (`replaceDraft`). */
  function change(
    index: number,
    edit: { quantity?: number; price?: string },
  ): void {
    replaceDraft(
      draft.map((d, i) => {
        if (i !== index) return d;
        const price = edit.price ?? d.price;
        return {
          ...d,
          price,
          line: {
            ...d.line,
            quantity: edit.quantity ?? d.line.quantity,
            unit_price: asPrice(price),
          },
        };
      }),
    );
  }

  /**
   * The size read off a coat held with its size not known: it is sold with
   * that size (ADR-0005 §11). "" takes the reading back.
   */
  function relabel(index: number, sizeId: string): void {
    const d = draft[index];
    if (!d) return;
    const label = sizes.data?.find((size) => size.size_id === sizeId);
    const line = { ...d.line, size_id: label ? label.size_id : d.stockSizeId };
    if (
      draft.some(
        (other, i) => i !== index && stockKey(other.line) === stockKey(line),
      )
    ) {
      setValidation("Такий рядок уже є в кошику — змініть кількість у ньому.");
      return;
    }
    setValidation("");
    replaceDraft(
      draft.map((other, i) =>
        i === index
          ? {
              ...other,
              line,
              size: label ? label.code : "розмір невідомий",
              unknownSize: !label,
              fromUnknown: label !== undefined,
            }
          : other,
      ),
    );
  }

  async function send(
    way: TillMethod,
    nextFound: Record<number, number>,
    nextMissing: Record<number, number>,
    nextClarified: Record<number, number>,
  ): Promise<void> {
    // From paper, nothing is sent until the series says which paper it is,
    // and the first days' day and time go together (owner decision,
    // 2026-10-16): the buttons wait, and so does this.
    if (paper && (firstDays === null || paperProblem !== null)) return;
    // The buttons wait for every price; a sale is never sent without one.
    if (draft.some((d) => d.line.unit_price === "")) {
      setValidation(priceText);
      return;
    }
    // Nothing on the shelf of a line drops it from the sale (owner decision,
    // 2026-10-01; Q-G). Nothing on the shelf of any line leaves no sale to
    // make, and the basket records an empty shelf instead.
    const empty = draft.filter((_, index) => nextMissing[index] === 0);
    const emptyShelf = draft.length > 0 && empty.length === draft.length;
    // What will be sold: a line answered «на місці лише N» sells N.
    const sold = draft.reduce(
      (sum, d, index) =>
        sum +
        (kopecks(d.line.unit_price) ?? 0n) *
          BigInt(nextMissing[index] ?? d.line.quantity),
      0n,
    );
    const terms =
      credit.inParts && !emptyShelf ? checkTerms(credit, sold) : null;
    if (typeof terms === "string") {
      setValidation(terms);
      return;
    }
    // The paper's time as its day and hour, the store's wall clock (G1);
    // the first days' paper says so (ADR-0013 §5.8).
    const mark: OutageBody | null = paper
      ? {
          sold_by_user_id: named?.user_id ?? null,
          sold_at: paperAt(firstDays, paperDate, paperTime, yesterday),
          ...(firstDays === true ? { first_days: true as const } : {}),
        }
      : null;
    let key: string;
    try {
      // A new key per payload: one key then always answers one payload, and
      // a replay of it is unambiguous. `command_id` is what keeps the
      // corrected attempt from selling twice.
      key = crypto.randomUUID();
    } catch (error) {
      // The phone's own failure, before anything was sent: said as such,
      // never as the server's (ADR-0013 §3).
      setRefusal(error);
      return;
    }
    const asked = shortfall;
    setMethod(way);
    setShortfall(null);
    setRefusal(null);
    setValidation("");
    const outcome = await submitSale(journalKey, token, {
      key,
      emptyShelf,
      body: {
        store_id: store.id,
        command_id: commandId,
        lines: draft.map((d) => d.line),
        found_in_store: Object.entries(nextFound).map(([index, value]) => ({
          line_index: Number(index),
          quantity: value,
        })),
        missing_in_store: Object.entries(nextMissing).map(([index, value]) => ({
          line_index: Number(index),
          quantity: value,
        })),
        size_clarified: Object.entries(nextClarified).map(([index, value]) => ({
          line_index: Number(index),
          quantity: value,
        })),
        ...(terms ? { credit: terms } : {}),
        payment_method: way,
        // Only in paper mode: an ordinary sale has no such key (§7).
        ...(mark ? { outage: mark } : {}),
      },
    });
    if (outcome.kind === "sold" || outcome.kind === "nothing-sold") {
      // Answered: the basket kept is this sale's no more, whether or not the
      // till is still open to say so (review, 2026-10-27).
      forgetBasket();
      if (outcome.kind === "sold") {
        setReceipt(outcome.sale);
        setSentSizes(
          Object.fromEntries(draft.map((d) => [stockKey(d.line), d.size])),
        );
        buzz("success");
        setDropped(empty.map((d) => `${visible(d.name)} · ${visible(d.size)}`));
      } else {
        setNothingSold(outcome.shelf);
      }
      setDraft([]);
      setFound({});
      setMissing({});
      setClarified({});
      setCommandId(crypto.randomUUID());
      setPresent("");
      setMethod(null);
      // A paper's time is one sale's: left, it would go on the next one,
      // and a wrong time is permanent (§7). The switch, which paper it is
      // and who sold stay for the series.
      setPaperDate("");
      setPaperTime("");
      setYesterday(false);
      // The next customer is someone else, and looks for something else.
      // Sold in parts, «Борги» — and what a number owes, said here — are
      // read again (review, 2026-10-19).
      if (outcome.kind === "sold" && credit.inParts)
        void cache.invalidateQueries({ queryKey: ["credits", store.id] });
      setCredit(noTerms);
      // The shelf is read again: the whole list, once the search is cleared.
      if (query) {
        setText("");
        await cache.invalidateQueries({
          queryKey: ["sale-stock", journalKey, store.id],
          refetchType: "none",
        });
      } else {
        setText("");
        await stock.refetch();
      }
    } else if (outcome.kind === "refused") {
      const { error, shortfall: short } = outcome;
      const { details } = error;
      if (
        error.code === "UNKNOWN_SIZE_STOCK" &&
        asked !== null &&
        details.product_variant_id === asked.product_variant_id &&
        details.location_id === asked.location_id
      ) {
        // «Товар на місці» was refused because this model is held here with
        // its size not known. Nothing was sold, the same shortfall stands,
        // and now the till knows which answer fits it.
        setHeldUnknown(
          (known) =>
            new Set([
              ...known,
              `${asked.location_id}:${asked.product_variant_id}`,
            ]),
        );
        const index = indexOf(asked);
        setFound(
          Object.fromEntries(
            Object.entries(nextFound).filter(([key]) => Number(key) !== index),
          ),
        );
        setShortfall(asked);
      } else if (short && details.reason === undefined) {
        setShortfall(short);
      } else {
        // A clarification refused for its own reason is withdrawn, so the
        // seller answers afresh rather than resending what cannot pass.
        setClarified({});
        setRefusal(error);
        // A refusal buzzes; the shelf's question above does not: it asks,
        // it does not fail (redesign P1-1).
        buzz("error");
      }
      setPresent("");
    }
  }

  /** A shortfall's answer: the same sale, the same way, one answer more. */
  function answer(
    nextFound: Record<number, number>,
    nextMissing: Record<number, number>,
    nextClarified: Record<number, number>,
  ): void {
    if (method) void send(method, nextFound, nextMissing, nextClarified);
  }

  function indexOf(short: Shortfall): number {
    return draft.findIndex(
      (d) =>
        stockKey(d.line) ===
        stockKey({
          source_location_id: short.location_id,
          product_variant_id: short.product_variant_id,
          size_id: short.size_id,
        }),
    );
  }

  const total = draft.reduce(
    (sum, d) =>
      sum + (kopecks(d.line.unit_price) ?? 0n) * BigInt(d.line.quantity),
    0n,
  );
  const shortIndex = shortfall ? indexOf(shortfall) : -1;
  const shortDraft = shortIndex >= 0 ? draft[shortIndex] : undefined;
  // Whether the short line's model is held at its warehouse with its size not
  // known — and so whether the coat in hand may be one of those.
  const unknownHere =
    shortDraft !== undefined &&
    !shortDraft.unknownSize &&
    (shortDraft.fromUnknown ||
      shortDraft.unknownNearby ||
      heldUnknown.has(
        `${shortDraft.line.source_location_id}:${shortDraft.line.product_variant_id}`,
      ) ||
      listed.some(
        (item) =>
          (item.location_id || locationId) ===
            shortDraft.line.source_location_id &&
          item.product_variant_id === shortDraft.line.product_variant_id &&
          item.size_is_unknown &&
          item.available_quantity > 0,
      ));
  const working = busy || pending !== null;
  // The way of the sale sent for the first time (spec §6.5; «Усе на бірці»
  // task list, P0-2): its ring turns, the others step back. A kept sale
  // checked again is its stub's to say, not the dock's.
  const pressing = busy && firstSend ? method : null;
  // The server's answer to a shortage opens above the panel, in view and
  // focused, so it is never past the edge of the screen (redesign P0-4).
  const shortRef = useRef<HTMLElement>(null);
  // The panel's height is kept clear wherever the page scrolls to — the
  // shortage answer, a field in focus — so nothing ends under it (review,
  // 2026-10-15).
  const panelRef = useRef<HTMLDivElement>(null);
  usePanelRoom(panelRef, draft.length > 0);
  useEffect(() => {
    if (!shortfall) return;
    shortRef.current?.scrollIntoView({ block: "nearest" });
    shortRef.current?.focus({ preventScroll: true });
  }, [shortfall]);
  useEffect(() => {
    if (focusPrice === null) return;
    priceRefs.current.get(focusPrice)?.focus();
    setFocusPrice(null);
  }, [focusPrice]);
  useEffect(() => {
    if (!focusSearch || receipt) return;
    // The search may still be on its way, behind the warehouses being read:
    // the cursor waits for it.
    if (!searchRef.current) return;
    searchRef.current.focus();
    setFocusSearch(false);
  }, [focusSearch, receipt, locations.isPending, locationId]);
  // The ways wait until every line has its price (redesign P0-3).
  const priced = draft.every((d) => d.line.unit_price !== "");
  // From paper, no size is read off a label (G3): a line read so before
  // the switch was ticked holds the ways until it is taken out.
  const labelledOnPaper = paper && draft.some((d) => d.fromUnknown);
  // Paid in parts: what is paid now and what is left, as typed so far. The
  // receipt's figures are the server's.
  const paidNow = mayCredit && credit.inParts ? kopecks(credit.paid) : null;
  const owing =
    paidNow !== null && paidNow > 0n && paidNow < total
      ? { now: paidNow, left: total - paidNow }
      : null;
  // Named on every answer that sells: «… · Картка».
  const how = method ? ` · ${methodLabels[method]}` : "";

  if (nothingSold)
    return (
      <NothingSold
        shelf={nothingSold}
        next={() => {
          setNothingSold(null);
          setFocusSearch(true);
        }}
      />
    );

  if (receipt)
    return (
      <Receipt
        receipt={receipt}
        placeOf={(id) =>
          searchAll ||
          new Set(receipt.items.map((item) => item.source_location_id)).size > 1
            ? ` · ${visible(locations.data?.find((location) => location.id === id)?.name ?? "")}`
            : ""
        }
        storeId={store.id}
        token={token}
        userId={userId}
        dropped={dropped}
        next={() => {
          setReceipt(null);
          setDropped([]);
          setFocusSearch(true);
        }}
        fixMethod={fixMethod}
        returnSale={returnSale}
        sizes={sentSizes}
      />
    );

  return (
    <section>
      <h2>Продаж</h2>
      {mode}
      {back && (
        <Banner kind="back" label="Сервер знову відповідає">
          <p>
            Сервер знову відповідає: продажі з паперу можна вносити. Внесіть їх
            до закриття каси.
          </p>
          <div className="actions">
            <button
              disabled={blocked || working}
              onClick={() => {
                // The paper of an outage the phone saw: said so, and still
                // changeable below (owner decision, 2026-10-16).
                turnPaper(true, false);
              }}
            >
              Вношу продаж з паперу
            </button>
            <button className="quiet" onClick={backNoted}>
              Пізніше
            </button>
          </div>
        </Banner>
      )}
      {paper && (
        <Banner kind="paper" label="Режим: продаж з паперу">
          <h3>Режим: продаж з паперу</h3>
          {/* The seller does not see «Звіт» (owner decision, 2026-10-15, В5). */}
          {firstDays !== null && (
            <p>
              {firstDays
                ? "Продаж позначать «з паперу». Він увійде в сьогоднішні продажі й у касу до наступного закриття."
                : "Продаж позначать «продано під час збою». Він увійде в сьогоднішні продажі й у касу до наступного закриття."}
            </p>
          )}
        </Banner>
      )}
      <fieldset disabled={blocked || working}>
        <label className="check">
          <input
            type="checkbox"
            checked={paper}
            onChange={(event) => {
              turnPaper(event.target.checked);
            }}
          />
          Вношу продаж з паперу
        </label>
        {paper && (
          <>
            <PaperKind storeId={store.id} firstDays={firstDays} />
            <label>
              Хто продав
              <select
                value={named?.user_id ?? ""}
                onChange={(event) => {
                  setSoldBy(store.id, event.target.value || null);
                }}
              >
                <option value="">Не вказано</option>
                {(sellers.data?.sellers ?? []).map((seller) => (
                  <option key={seller.user_id} value={seller.user_id}>
                    {visible(seller.display_name)}
                  </option>
                ))}
              </select>
            </label>
            {sellers.error && (
              <Failure
                error={sellers.error}
                retry={() => {
                  void sellers.refetch();
                }}
              />
            )}
            <PaperWhen
              firstDays={firstDays}
              day={paperDate}
              time={paperTime}
              yesterday={yesterday}
              onDay={setPaperDate}
              onTime={(value) => {
                setPaperTime(value);
                if (!value) setYesterday(false);
              }}
              onYesterday={setYesterday}
            />
          </>
        )}
        {locations.isPending ? (
          <Placeholder said="Завантажуємо склади…" field />
        ) : locations.error ? (
          <Failure
            error={locations.error}
            retry={() => {
              void locations.refetch();
            }}
          />
        ) : onlyWarehouse ? (
          // One warehouse to sell from: nothing to choose (redesign P0-2).
          <p className="warehouse">Склад: {visible(onlyWarehouse.name)}</p>
        ) : (
          <label>
            Склад
            <select
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                setFromCatalog(false);
              }}
            >
              <option value="">
                {sellable.length >= 2
                  ? "Усі склади"
                  : "З якого складу віддаєте?"}
              </option>
              {locations.data.map((location) => (
                <option
                  key={location.id}
                  value={location.id}
                  disabled={!location.is_active || !location.can_sell}
                >
                  {visible(location.name)}
                  {!location.is_active
                    ? " — на паузі"
                    : !location.can_sell
                      ? " — без права продажу"
                      : ""}
                </option>
              ))}
            </select>
            {locations.data.length === 0 && (
              <span>Доступних складів немає. Зверніться до менеджера.</span>
            )}
          </label>
        )}
        {locationId && waiting ? (
          // Nothing is sold there until the list is approved (owner
          // decision, 2026-10-02): the shop sells on paper meanwhile, and
          // the paper is typed in once it is (redesign P1-5).
          <p className="empty">
            На складі «{visible(warehouse)}» зараз немає товару в обліку. Поки
            власник не затвердить початкові залишки, продавайте на папері.
          </p>
        ) : searchAll && ready.length === 0 ? (
          <p className="empty">
            На складах магазину зараз немає товару в обліку. Поки власник не
            затвердить початкові залишки, продавайте на папері.
          </p>
        ) : fromCatalog && searchAll ? (
          <>
            <label>
              З якого складу віддаєте?
              <select
                value={catalogAt}
                onChange={(event) => {
                  setCatalogAt(event.target.value);
                }}
              >
                <option value="">Оберіть склад</option>
                {ready.map((location) => (
                  <option key={location.id} value={location.id}>
                    {visible(location.name)}
                  </option>
                ))}
              </select>
            </label>
            {catalogPlace ? (
              <FromCatalog
                store={store}
                token={token}
                scopeKey={journalKey}
                warehouse={catalogPlace.name}
                locationId={catalogPlace.id}
                pick={put}
                close={() => {
                  setFromCatalog(false);
                }}
              />
            ) : (
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  setFromCatalog(false);
                }}
              >
                Назад до списку
              </button>
            )}
          </>
        ) : locationId && fromCatalog ? (
          <FromCatalog
            store={store}
            token={token}
            scopeKey={journalKey}
            warehouse={warehouse}
            locationId={locationId}
            pick={put}
            close={() => {
              setFromCatalog(false);
            }}
          />
        ) : (
          (locationId || searchAll) && (
            <>
              {searchAll && stillWaiting.length > 0 && (
                // Owner decision, 2026-10-17: the others listed, these on
                // paper meanwhile (P1-5).
                <p className="hint">
                  {stillWaiting.length === 1
                    ? `Склад «${visible(stillWaiting[0]?.name ?? "")}» ще чекає початкових залишків: його товар продавайте на папері.`
                    : `Склади ${stillWaiting.map((location) => `«${visible(location.name)}»`).join(", ")} ще чекають початкових залишків: їхній товар продавайте на папері.`}
                </p>
              )}
              <StockSearch
                text={text}
                type={setText}
                query={query}
                stock={stock}
                warehouse={warehouse}
                places={places}
                pick={put}
                canAdd={(item) =>
                  draft.length < 100 ||
                  draft.some(
                    (d) =>
                      stockKey(d.line) ===
                      stockKey({
                        source_location_id: item.location_id || locationId,
                        product_variant_id: item.product_variant_id,
                        size_id: item.size_id,
                      }),
                  )
                }
                offerHeld={paper}
                searchRef={searchRef}
                failure={
                  stock.error ? (
                    <Failure
                      error={stock.error}
                      retry={() => {
                        void stock.refetch();
                      }}
                    />
                  ) : null
                }
                offer={
                  mayFindInCatalog ? (
                    <p className="hint">
                      Товар у руках, а в списку його немає?{" "}
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => {
                          setCatalogAt("");
                          setFromCatalog(true);
                        }}
                      >
                        Знайти в каталозі
                      </button>
                    </p>
                  ) : null
                }
              />
            </>
          )
        )}
        {validation && <p role="alert">{validation}</p>}
        {draft.length === 0 &&
          (locationId || (searchAll && ready.length > 0)) &&
          !waiting &&
          !fromCatalog && (
            <p className="hint">Кошик порожній — знайдіть модель угорі.</p>
          )}
        {draft.length > 0 && (
          // «Кошик» names the lines to pay, and nothing else (P2-2).
          <div role="group" aria-label="Кошик">
            {draft.map((d, index) => (
              <div
                className={index === shortIndex ? "line short" : "line"}
                key={d.id}
              >
                <strong>
                  {visible(d.name)} · {visible(d.size)}
                  {placeOf(d.line.source_location_id)}
                </strong>
                <div className="line-edit">
                  <div
                    className="stepper"
                    role="group"
                    aria-label={`Кількість: ${visible(d.name)} · ${visible(d.size)}${placeOf(d.line.source_location_id)}`}
                  >
                    <button
                      type="button"
                      aria-label="Менше"
                      disabled={d.line.quantity <= 1}
                      onClick={() => {
                        change(index, { quantity: d.line.quantity - 1 });
                      }}
                    >
                      −
                    </button>
                    <output>{d.line.quantity}</output>
                    <button
                      type="button"
                      aria-label="Більше"
                      disabled={d.line.quantity >= 1000}
                      onClick={() => {
                        change(index, { quantity: d.line.quantity + 1 });
                      }}
                    >
                      +
                    </button>
                  </div>
                  <label>
                    Ціна, грн
                    <input
                      ref={(input) => {
                        if (input) priceRefs.current.set(d.id, input);
                        else priceRefs.current.delete(d.id);
                      }}
                      inputMode="decimal"
                      placeholder="0,00"
                      value={d.price}
                      onChange={(event) => {
                        change(index, { price: event.target.value });
                      }}
                    />
                  </label>
                </div>
                <PriceHint
                  typed={d.price}
                  price={d.line.unit_price}
                  suggested={d.suggested}
                />
                {found[index] !== undefined && (
                  <span>Підтверджено на місці: +{found[index]}</span>
                )}
                {missing[index] === 0 ? (
                  <span>На полиці немає — не продається</span>
                ) : (
                  missing[index] !== undefined && (
                    <span>На місці лише {missing[index]}</span>
                  )
                )}
                {d.unknownStock && paper && (
                  // A size read off a coat in hand: on paper nobody holds it (G3;
                  // owner decision, 2026-10-15, В5).
                  <span className="hint">
                    Товар з невідомим розміром вносьте як «розмір невідомий».
                  </span>
                )}
                {d.unknownStock && mayReadLabel && !paper && (
                  <label>
                    Розмір з етикетки
                    <select
                      value={d.fromUnknown ? d.line.size_id : ""}
                      onChange={(event) => {
                        relabel(index, event.target.value);
                      }}
                    >
                      <option value="">
                        Не читали — продати як «розмір невідомий»
                      </option>
                      {(sizes.data ?? []).map((size) => (
                        <option key={size.size_id} value={size.size_id}>
                          {visible(size.code)}
                        </option>
                      ))}
                    </select>
                    <span className="hint">
                      Прочитали розмір на етикетці — оберіть його, і товар
                      продасться з цим розміром.
                    </span>
                  </label>
                )}
                {d.fromUnknown && (
                  <span className="hint">
                    Розмір з етикетки; в обліку — «розмір невідомий»
                  </span>
                )}
                {clarified[index] !== undefined && (
                  <span>
                    Розмір уточнено: {clarified[index]} шт. з «розмір невідомий»
                  </span>
                )}
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    replaceDraft(draft.filter((_, i) => i !== index));
                  }}
                >
                  Прибрати {visible(d.name)}
                  {placeOf(d.line.source_location_id)}
                </button>
              </div>
            ))}
          </div>
        )}
        {sizes.error && (
          <Failure
            error={sizes.error}
            retry={() => {
              void sizes.refetch();
            }}
          />
        )}
        {mayCredit && (
          <TermsFields
            value={credit}
            change={setCredit}
            total={total}
            // One line at 360 px (credits task list, P1-5): the task list's
            // «Решту покупець доплачує в «Боргах» цього магазину.» takes two.
            hint="Решту — у «Боргах» цього магазину."
            storeId={store.id}
            token={token}
          />
        )}
        <p className="hint">
          {paper
            ? firstDays === null
              ? "Оберіть угорі, що вносите з паперу."
              : firstDays
                ? // The card was charged before the app (owner, 2026-10-16).
                  "Оплату вже взяли: натисніть, як оплатили. На терміналі нічого не проводьте."
                : // The card was charged during the outage (G19).
                  "Оплату взяли під час збою: натисніть, як оплатили. На терміналі нічого не проводьте."
            : "Спершу натисніть, як платить покупець, потім проведіть на терміналі суму з чека: вона може змінитися, якщо товару не виявиться на полиці."}
        </p>
      </fieldset>
      {refusal !== null && (
        <p role="alert">
          {refusalText(refusal)} Кошик збережено — нічого не продано.
        </p>
      )}
      {shortfall && (
        <section
          className="notice"
          role="alert"
          ref={shortRef}
          tabIndex={-1}
          aria-label="Залишку не вистачає"
        >
          <h3>Залишку не вистачає</h3>
          {shortDraft === undefined || shortIndex < 0 ? (
            <p>
              Сервер відмовив через товар, якого немає в цьому кошику. Оновіть
              залишки й складіть кошик заново.
            </p>
          ) : (
            <>
              <p>
                {visible(shortDraft.name)} · {visible(shortDraft.size)}
                {placeOf(shortDraft.line.source_location_id)}: у кошику{" "}
                {shortfall.requested} шт., в обліку {shortfall.available} шт.
                {shortfall.reserved === true && " поза резервом замовлення."}
              </p>
              {paper ? (
                // Nothing that describes the shelf now (§6, §7).
                <p>{shortfall.reserved === true ? paperReserved : paperGone}</p>
              ) : !shortfall.correctable ? (
                <p>
                  Цей залишок неможливо виправити під час продажу — частина
                  одиниць у резерві замовлення. Зменшіть кількість або продайте
                  інший товар.
                </p>
              ) : (
                <>
                  {mayCorrect && unknownHere && (
                    <>
                      <p>
                        Ця модель є на складі з невідомим розміром. Якщо у вас
                        одна з тих одиниць, уточніть її розмір — вона продасться
                        як {visible(shortDraft.size)}.
                      </p>
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => {
                          const next = {
                            ...clarified,
                            [shortIndex]:
                              shortfall.requested - shortfall.available,
                          };
                          setClarified(next);
                          answer(found, missing, next);
                        }}
                      >
                        Розмір з етикетки — продати як{" "}
                        {visible(shortDraft.size)}
                        {how}
                      </button>
                    </>
                  )}
                  {mayCorrect && !unknownHere && !shortDraft.unknownSize && (
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => {
                        const next = {
                          ...found,
                          [shortIndex]:
                            shortfall.requested - shortfall.available,
                        };
                        setFound(next);
                        answer(next, missing, clarified);
                      }}
                    >
                      Товар на місці — продати {shortfall.requested}
                      {how}
                    </button>
                  )}
                  {mayReportMissing && (
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => {
                        const next = { ...missing, [shortIndex]: 0 };
                        setMissing(next);
                        answer(found, next, clarified);
                      }}
                    >
                      {/* Recording an empty shelf takes no money: no way. */}
                      {draft.every(
                        (_, index) =>
                          index === shortIndex || missing[index] === 0,
                      )
                        ? "На полиці немає жодної — записати нестачу"
                        : `На полиці немає жодної — продати решту${how}`}
                    </button>
                  )}
                  {mayReportMissing && shortfall.requested > 1 && (
                    <>
                      <label>
                        На місці фактично є, шт.
                        <input
                          inputMode="numeric"
                          value={present}
                          onChange={(event) => {
                            setPresent(event.target.value);
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => {
                          const count = Number(present);
                          if (
                            !/^\d+$/.test(present) ||
                            count < 1 ||
                            count >= shortfall.requested
                          ) {
                            setValidation(
                              `Вкажіть від 1 до ${String(shortfall.requested - 1)} шт. Якщо немає жодної — натисніть «На полиці немає жодної».`,
                            );
                            return;
                          }
                          const next = { ...missing, [shortIndex]: count };
                          setMissing(next);
                          answer(found, next, clarified);
                        }}
                      >
                        Продати стільки, скільки є{how}
                      </button>
                    </>
                  )}
                  {/* The next step alone, never the rule («Усе на бірці»
                      task list, P2-1). */}
                  {!mayCorrect && !mayReportMissing && (
                    <p>Покличте менеджера або зменшіть кількість.</p>
                  )}
                  {mayCorrect && !mayReportMissing && (
                    <p>
                      Немає на полиці? Приберіть рядок і попросіть менеджера
                      виправити залишок.
                    </p>
                  )}
                </>
              )}
              <button
                type="button"
                className="quiet"
                onClick={() => {
                  replaceDraft(draft.filter((_, i) => i !== shortIndex));
                }}
              >
                Прибрати з кошика
              </button>
            </>
          )}
        </section>
      )}
      {/* Under the thumb (redesign P0-4): what is sold and what is paid,
          and the three ways, which sell when pressed (owner decision,
          2026-10-04). It shows once the basket holds something (direction
          §5). */}
      {draft.length > 0 && (
        <div
          className="pay-panel"
          role="group"
          aria-label="Продати — як платить покупець"
          ref={panelRef}
        >
          <p className="pay-what">
            {draft.length === 1 && draft[0]
              ? `${visible(draft[0].name)} · ${visible(draft[0].size)}${placeOf(draft[0].line.source_location_id)}${draft[0].line.quantity > 1 ? ` × ${String(draft[0].line.quantity)}` : ""}`
              : `У кошику: ${String(draft.reduce((n, d) => n + d.line.quantity, 0))} шт.`}
          </p>
          <p className="pay-total">
            {!priced ? (
              // A sum without a line's price is no sum to say (review,
              // 2026-10-15).
              <>
                Разом <strong className="sum">—</strong>
              </>
            ) : owing ? (
              <>
                Зараз <Sum value={money(decimal(owing.now))} /> · винен{" "}
                <Sum value={money(decimal(owing.left))} />
              </>
            ) : (
              <>
                Разом <Sum value={money(decimal(total))} />
              </>
            )}
          </p>
          <SendingLine busy={pressing !== null} />
          <div className="pay-ways">
            {tillMethods.map((way) => (
              <button
                key={way}
                type="button"
                className={
                  pressing === null
                    ? undefined
                    : pressing === way
                      ? "pressed"
                      : "stepped-back"
                }
                disabled={
                  blocked ||
                  working ||
                  !priced ||
                  labelledOnPaper ||
                  (paper && (firstDays === null || paperProblem !== null))
                }
                onClick={() => {
                  void send(way, found, missing, clarified);
                }}
              >
                {pressing === way && <Eyelet state="spin" size={20} />}
                {paper ? `З паперу · ${methodLabels[way]}` : methodLabels[way]}
              </button>
            ))}
          </div>
          {paper && (
            // Seen before the press: a forgotten switch marks a live sale for
            // good, with a colleague's name (G6).
            <p className="pay-seller">
              Продавець: {named ? visible(named.display_name) : "не вказано"}
              {from.length > 0 &&
                ` · ${from.length > 1 ? "склади" : "склад"}: ${from.map((name) => visible(name)).join(", ")}`}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * «Сьогодні ви продали N шт.» under the receipt's heading (owner decisions,
 * 2026-10-16, В8, and 2026-10-17): the seller's own units today, less those
 * returned, as the server counts them, read once for each receipt. Never a
 * sum or a way (G32). Its line is there from the start, so nothing moves
 * under the finger when the figure comes; it stays empty if the server does
 * not answer, and the receipt is the same.
 */
function SoldToday({
  storeId,
  token,
  saleId,
}: {
  storeId: string;
  token: string;
  saleId: string;
}): JSX.Element {
  const sold = useQuery({
    queryKey: ["sold-today", storeId, saleId],
    queryFn: () =>
      api<{ business_day: string; units: number }>(
        `/sales/sold-today?store_id=${encodeURIComponent(storeId)}`,
        token,
      ),
    staleTime: Infinity,
  });
  return (
    <p className="sold-today" role="status">
      {sold.data ? `Сьогодні ви продали ${String(sold.data.units)} шт.` : ""}
    </p>
  );
}

/** What the stub says to do with the money, by its way (spec S11). */
const waySays: Partial<Record<PaymentMethod, string>> = {
  CASH: "У касу",
  CARD: "Проведіть на терміналі",
  TRANSFER: "Перевірте, що переказ надійшов, перш ніж віддати товар",
};

function Receipt({
  receipt,
  placeOf,
  storeId,
  token,
  userId,
  dropped,
  next,
  fixMethod,
  returnSale,
  sizes,
}: {
  receipt: SaleReceipt;
  /** « · Свій» after a line, where the sale's warehouses need telling apart. */
  placeOf: (id: string) => string;
  storeId: string;
  token: string;
  userId: string;
  dropped: string[];
  next: () => void;
  fixMethod: ((sale: SaleReceipt) => void) | undefined;
  returnSale: ((sale: SaleReceipt) => void) | undefined;
  /** The basket's sizes by stock key, for an answer that names none. */
  sizes: Record<string, string>;
}): JSX.Element {
  // An answer recorded before the way was asked names none (ADR-0012 §B12).
  const way = receipt.payment_method ?? null;
  // A sale typed from paper (ADR-0013 §5.6): its mark, and money taken
  // during the outage is never charged again.
  const mark = receipt.outage ?? null;
  const paid =
    mark !== null && way !== null
      ? paidDuringOutage(way, mark.first_days === true)
      : null;
  // What to do with the money (spec S11; «Усе на бірці» task list, P0-2):
  // the terminal for a card, the drawer for cash, a transfer checked before
  // the goods go (ADR-0012 G38). Typed from paper, the money was taken
  // already: only what the paper says of it, and nothing of cash.
  const say =
    way === null
      ? null
      : mark !== null
        ? paid && `${paid.charAt(0).toUpperCase()}${paid.slice(1)}.`
        : (waySays[way] ?? null);
  return (
    <section className="receipt">
      <h2 className="result-title t-sheet">
        <RecordedMark />
        Продаж записано
      </h2>
      {/* A sale typed from paper for someone else is theirs, and says
          nothing of the seller's own day (owner decision, 2026-10-17). */}
      {(mark === null ||
        mark.sold_by_user_id === null ||
        mark.sold_by_user_id === userId) && (
        <SoldToday storeId={storeId} token={token} saleId={receipt.id} />
      )}
      <Stub state="recorded">
        {(way !== null || mark) && (
          <p className="stub-head">
            {way !== null && <WaySticker way={way} />}
            {mark && <span className="badge warn">{markText(mark)}</span>}
          </p>
        )}
        {say !== null && <p className="stub-say">{say}</p>}
        {/* Paid in parts, the terminal takes only what is paid now: that
            sum first (redesign P0-6). From the answer, never worked out. */}
        <p className="stub-sum">
          {(receipt.credit || way === null) && (
            <span className="stub-sum-what">
              {receipt.credit ? "Зараз" : "Разом"}{" "}
            </span>
          )}
          <Sum
            value={money(
              receipt.credit ? receipt.credit.paid_now : receipt.total,
            )}
          />
        </p>
        {receipt.credit && (
          <>
            <p className="stub-line">
              Разом за товар <strong>{money(receipt.total)}</strong>
            </p>
            <p className="stub-line">
              Покупець винен <strong>{money(receipt.credit.owed)}</strong>
            </p>
            {/* Where the next payments are taken: the sections' task list's
                В5 (а), one word with it («Усе на бірці» task list, P0-4),
                to ask the owner. */}
            <p className="stub-line">Наступні внески — у «Продажі» › «Внесок».</p>
          </>
        )}
        <Perforation />
        {/* Each line: the model, its size, how many at what price
            (redesign P1-1), and its warehouse where they differ. */}
        {receipt.items.map((item) => {
          const sent = sizes[stockKey(item)];
          const size =
            item.size !== undefined && item.size !== null
              ? sizeLabel(item.size)
              : sent !== undefined
                ? visible(sent)
                : null;
          return (
            <div className="line" key={item.id}>
              <strong>
                {visible(item.display_name)}
                {size !== null && ` · ${size}`}
                {placeOf(item.source_location_id)}
              </strong>
              <span>
                {item.quantity} × {money(item.final_unit_price)}
              </span>
            </div>
          );
        })}
      </Stub>
      {/* What the sale did to the books, in coats, as the server counted
          them; an answer stored before it counted says it without. */}
      {(receipt.found_quantity ?? receipt.corrections.length) > 0 && (
        <p className="hint">
          Знайдене на полиці додано в облік
          {typeof receipt.found_quantity === "number"
            ? `: ${String(receipt.found_quantity)} шт.`
            : "."}
        </p>
      )}
      {dropped.length > 0 && (
        <p>Не продано — на полиці не було: {dropped.join(", ")}.</p>
      )}
      {(receipt.missing_quantity ?? receipt.shortages.length) > 0 && (
        <p className="hint">
          На полиці не знайшли — з обліку знято
          {typeof receipt.missing_quantity === "number"
            ? `: ${String(receipt.missing_quantity)} шт.`
            : "."}{" "}
          Перевірте склад із менеджером.
        </p>
      )}
      {receipt.clarified
        ? receipt.clarified.map((clarified) => (
            <p className="hint" key={clarified.size}>
              Розмір з етикетки записано: {clarified.quantity} шт. як{" "}
              {sizeLabel(clarified.size)}.
            </p>
          ))
        : receipt.size_reclassifications.length > 0 && (
            <p className="hint">Розмір з етикетки записано.</p>
          )}
      {fixMethod && way !== null && (
        <button
          type="button"
          className="quiet"
          onClick={() => {
            fixMethod(receipt);
          }}
        >
          Змінити спосіб оплати
        </button>
      )}
      {returnSale && (
        // A sale is never changed: a mistake is returned, then sold again
        // (I8; redesign P1-2).
        <p className="hint return-offer">
          Помилилися з товаром чи ціною?{" "}
          <button
            type="button"
            className="quiet"
            onClick={() => {
              returnSale(receipt);
            }}
          >
            Оформити повернення
          </button>
        </p>
      )}
      {/* Under the thumb, as the pay ways were (spec §6.5). */}
      <div className="result-dock">
        <button type="button" onClick={next}>
          Новий продаж
        </button>
      </div>
    </section>
  );
}

/** Nothing in the basket was on the shelf: no sale, and the shortage recorded. */
function NothingSold({
  shelf,
  next,
}: {
  shelf: EmptyShelf;
  next: () => void;
}): JSX.Element {
  return (
    <section>
      <h2>Продажу немає</h2>
      <p>Нічого з кошика не було на полиці. Нестачу записано.</p>
      {shelf.lines.map((line) => (
        <div
          className="line"
          key={`${line.source_location_id}:${line.product_variant_id}:${line.size_id}`}
        >
          <strong>
            {visible(line.display_name)} · {sizeLabel(line.size)}
          </strong>
          <span>
            {line.removed > 0
              ? `Знято з обліку: ${String(line.removed)} шт.`
              : "Облік і так не мав цих одиниць — нічого не знято."}
          </span>
        </div>
      ))}
      <p className="hint">Перевірте склад із менеджером.</p>
      <button type="button" onClick={next}>
        Новий продаж
      </button>
    </section>
  );
}

/**
 * What the till can say about a refusal it knows the cause of. A kept sale
 * refused on resend says it too (`@/cash/errors`, ADR-0013 §8).
 */
/** A conflict the till knows nothing more of (sale-slice TZ, P2-4). */
export const TILL_CONFLICT_TEXT =
  "Дані змінилися, поки ви працювали. Спробуйте ще раз.";

export function refusalText(error: unknown): string {
  const details = (error as Partial<ApiError> | null)?.details ?? {};
  switch (details.reason) {
    case "SIZE_NOT_KNOWN_SHORT":
      return `Одиниць цієї моделі з невідомим розміром на складі менше, ніж треба уточнити (є ${String(details.available)} шт.). Зменшіть кількість або продайте як «розмір невідомий».`;
    case "SIZE_CLARIFIED":
      return "Облік змінився, поки ви відповідали. Натисніть «Готівка», «Картка» або «Переказ» ще раз, щоб побачити, чого бракує тепер.";
    case "SIZE_NOT_KNOWN_AMBIGUOUS":
      return "Ця модель записана на складі під кількома невідомими розмірами, тож уточнити розмір не можна. Зверніться до менеджера.";
    case "NOTHING_TO_SELL":
      return "У кошику не лишилося нічого, що є на полиці.";
    case "PAID_IN_FULL":
      return `Покупець сплачує все одразу (${money(String(details.total))}) — це звичайний продаж. Зніміть «Оплата частинами» або змініть суму.`;
    case "CUSTOMER_NAME":
      return "Вкажіть ім’я покупця, який платить частинами.";
    case "CUSTOMER_PHONE":
      return "Телефон покупця має містити від 10 до 15 цифр.";
    case "NOTHING_PAID":
      return "Покупець має сплатити зараз більше нуля.";
    case "RESERVED":
      return "Частина цих одиниць у резерві замовлення, тому під час продажу облік не виправити. Зменшіть кількість або продайте інший товар.";
    // A sale typed from paper, refused for its mark (ADR-0013 §5.3).
    case "OUTAGE_SHELF_REPORT":
      return "Продаж з паперу не виправляє залишок. Попросіть менеджера спершу виправити залишок, потім внесіть продаж ще раз.";
    case "OUTAGE_SELLER_UNKNOWN":
      return "Цієї людини немає серед продавців магазину. Оберіть іншу або залиште «не вказано».";
    case "OUTAGE_TIME_FUTURE":
      return "Цей час ще не настав. Перевірте час і день з паперу.";
    case "OUTAGE_TIME_TOO_OLD":
      return typeof details.days === "number" && details.days > 1
        ? tooOldText(true)
        : "Час з паперу можна вказати лише за сьогодні або вчора. Для давнішого продажу залиште час порожнім.";
    default: {
      // The till's own words where any screen would speak of an order:
      // the seller sells (sale-slice TZ, P2-4).
      const text = errorText(error);
      if (text === CONFLICT_TEXT) return TILL_CONFLICT_TEXT;
      if (text === INVALID_TEXT) return "Перевірте товар, кількість і ціну.";
      return text;
    }
  }
}

function Failure({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}): JSX.Element {
  return (
    <div role="alert">
      <p>{errorText(error)}</p>
      <button type="button" onClick={retry}>
        Спробувати ще раз
      </button>
    </div>
  );
}
