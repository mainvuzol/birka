import { useEffect, useId, useRef, useState } from "react";
import type { JSX, RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import {
  ApiError,
  api,
  errorText,
  inOwnWords,
  unreachable,
} from "@/shared/api";
import { Placeholder } from "@/shared/Placeholder";
import { Unread } from "@/shared/Unread";
import { NoCustomerData } from "@/shared/NoCustomerData";
import type { Location, Store } from "@/orders/types";
import { useBackOnSale } from "@/returns/places";
import { sizeLabel } from "@/returns/types";
import { SupplierPicker, useSuppliers } from "@/suppliers/Picker";
import { shortDay, shortTime, shortWhen } from "@/credits/format";
import { visible } from "@/shared/visible";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { Eyelet } from "@/shared/Eyelet";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Sheet } from "@/shared/Sheet";
import { Stub } from "@/shared/Stub";
import { CARRIED_TAP } from "@/shared/panel";
import { buzz, useMainButton } from "@/shared/telegram";
import { Empty } from "@/shared/Empty";
import type { DamagedStatus, DamagedUnit } from "./types";
import { useDamagedUnits } from "./units";

/** The states a unit is in while it is in «Брак», a segment each. */
type Segment = "AWAITING" | "INSPECTING" | "CONFIRMED";

const segments: readonly { mode: Segment; word: string; none: string }[] = [
  { mode: "AWAITING", word: "Чекають", none: "Нічого не чекає перевірки." },
  { mode: "INSPECTING", word: "На перевірці", none: "Зараз ніхто не оглядає." },
  {
    mode: "CONFIRMED",
    word: "Підтверджений",
    none: "Підтвердженого браку немає.",
  },
];

/** A step the server records, safe to press twice. */
type Step =
  "take" | "return-to-sale" | "confirm" | "write-off" | "return-to-supplier";

/** What was recorded, its stub's words. */
type Said =
  | { kind: "inspecting"; unit: DamagedUnit }
  | { kind: "returned"; unit: DamagedUnit; place: string }
  | { kind: "confirmed"; unit: DamagedUnit }
  | { kind: "written-off"; unit: DamagedUnit }
  | { kind: "supplier"; unit: DamagedUnit; supplier: string };

/** A row gone from the segment shown: its place, held while its stub
 * stands. */
interface Held {
  unit: DamagedUnit;
  segment: Segment;
  at: number;
}

/** «Марсель молочний · M». */
function unitName(unit: DamagedUnit): string {
  return `${visible(unit.display_name)} · ${sizeLabel(unit.size)}`;
}

/** «Повернули 03.11 · продано зі складу «Основний»». */
function whence(unit: DamagedUnit): string {
  return `Повернули ${shortDay(unit.returned_at)} · продано зі складу «${visible(unit.sold_from_location_name)}»`;
}

/** «Оглядає Тетяна з 11:40»; another day's, with its day. */
function inspector(unit: DamagedUnit, now = new Date()): string | null {
  if (unit.status !== "INSPECTING" || !unit.status_by || !unit.status_at)
    return null;
  const at = new Date(unit.status_at);
  const today = at.toDateString() === now.toDateString();
  return `Оглядає ${visible(unit.status_by)} з ${
    today ? shortTime(unit.status_at) : shortWhen(unit.status_at, now)
  }`;
}

function saidText(said: Said): string {
  const name = unitName(said.unit);
  switch (said.kind) {
    case "inspecting":
      return `Ви оглядаєте: ${name}`;
    case "returned":
      return `Повернули в продаж: ${name} → «${visible(said.place)}»`;
    case "confirmed":
      return `Брак підтверджений: ${name}`;
    case "written-off":
      return `Списали: ${name}`;
    case "supplier":
      return `Повернули постачальнику «${visible(said.supplier)}»: ${name}`;
  }
}

/** Why a step was not taken, in this screen's words: pressing again is
 * safe. */
function refusalText(error: unknown): string {
  // No answer reads as everywhere else, the owner's words (ADR-0013 §3,
  // G13), and this screen's own: pressing again is safe.
  return error instanceof ApiError && error.code === "DAMAGED_UNIT_CHANGED"
    ? "Цю одиницю щойно змінив хтось інший. Список оновлено — подивіться ще раз."
    : error instanceof ApiError && !unreachable(error)
      ? inOwnWords(
          errorText(error),
          "Не записано. Перевірте дані та спробуйте ще раз.",
          "Не записано: цю одиницю щойно змінили — список оновлено, подивіться ще раз.",
        )
      : `${errorText(error)} Повторне натискання безпечне.`;
}

/** Still in «Брак»: waiting, being looked at, or confirmed. */
function inBin(status: DamagedStatus): status is Segment {
  return (
    status === "AWAITING" || status === "INSPECTING" || status === "CONFIRMED"
  );
}

/**
 * The store's «Брак» (owner decisions, 2026-10-01; stage 2, goods task list,
 * P0-4; В-Г4 (а), В-Г8 (а)).
 *
 * Every unit a return put here, under «Чекають · На перевірці ·
 * Підтверджений», each a row tag — its eyelet dashed while it waits, a ring
 * while someone looks at it, filled in «Брак»'s colour, its edge torn, once
 * confirmed — with one verb. «Взяти на перевірку» records at once — the
 * others see who is looking — and opens the unit's sheet; «Вирішити» opens
 * it. There, under inspection: «Повернути в продаж», to the warehouse it was
 * sold from, named and confirmed — or one of this store's the person picks,
 * for a unit sold from another store's own —, or «Брак підтверджений»;
 * confirmed: «Списати», «Повернути постачальнику» for whoever returns goods
 * to suppliers, or «Перевірити ще раз». Each decision is a second step in
 * the sheet, Telegram's MainButton its yes. Recorded, the sheet goes and a
 * stub over the list names what became of the unit; the row's place is held
 * while the stub stands. Nothing of what was decided is kept after: the
 * server keeps only what is in «Брак» (В-Г8 (а)).
 *
 * It opens on the first segment with something in it: what waits first, as
 * «Сьогодні»'s tag and «Ще»'s row count it, oldest first — the server's
 * order.
 *
 * Every step is safe to press twice: the server answers a step already done
 * with the unit as it is. So no journal is kept here — if an answer is lost,
 * the list is read again and the step pressed again.
 */
export function Damaged({
  store,
  token,
  blocked,
  readOnly = false,
  back,
}: {
  store: Store;
  token: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
  /** The store does not trade: its «Брак» is read, and nothing is done in it. */
  readOnly?: boolean;
  /** «← Ще» over the heading: «Ще» › «Товар» › «Брак» («Усе на бірці»
   * task list, P0-4). */
  back?: MoreBack | undefined;
}): JSX.Element {
  const cache = useQueryClient();
  const units = useDamagedUnits(store, token);
  // The server's answers since the list was last read: a unit as it is now,
  // drawn at once, until a read newer than the answer comes.
  const [answers, setAnswers] = useState<
    ReadonlyMap<string, { unit: DamagedUnit; at: number }>
  >(() => new Map());
  const all = (units.data?.units ?? []).flatMap((unit) => {
    const answer = answers.get(unit.id);
    const now = answer && answer.at > units.dataUpdatedAt ? answer.unit : unit;
    return inBin(now.status) ? [now] : [];
  });
  const places = useBackOnSale(
    store,
    token,
    !readOnly && all.some((unit) => !unit.back_to_sold_from),
  );
  const [chosen, setChosen] = useState<Segment | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; step: Step } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<{ said: Said; held: Held | null } | null>(
    null,
  );
  const held = blocked || busy !== null;
  const maySupply = store.permissions.includes("supplier:return");

  // Where it opens: the first segment with something in it, fixed once the
  // list is read afresh — so a unit taken never moves the screen to another.
  const first =
    segments.find(({ mode }) => all.some((unit) => unit.status === mode))
      ?.mode ?? "AWAITING";
  const segment = chosen ?? first;
  const settledFirst = units.data !== undefined && !units.isFetching;
  useEffect(() => {
    if (chosen === null && settledFirst) setChosen(first);
  }, [chosen, settledFirst, first]);

  const title = useRef<HTMLHeadingElement>(null);
  const stub = useRef<HTMLParagraphElement>(null);
  // Where the cursor lands once a sheet goes and the button that opened it
  // is gone with its row: the stub's words, or the heading.
  const landing = useRef({
    get current(): HTMLElement | null {
      return stub.current ?? title.current;
    },
  }).current;

  // Oldest first, as «Сьогодні»'s tag names them.
  const listed = all
    .filter((unit) => unit.status === segment)
    .sort((a, b) => Date.parse(a.returned_at) - Date.parse(b.returned_at));
  // Gone from here: its place held among the rest, so none of them jumps;
  // back here, drawn as it is. The last one gone, the segment says it is
  // empty (review, 2026-11-07).
  const ghost =
    said?.held &&
    said.held.segment === segment &&
    listed.length > 0 &&
    !listed.some((unit) => unit.id === said.held?.unit.id)
      ? said.held
      : null;
  const rows: { unit: DamagedUnit; held: boolean }[] = listed.map((unit) => ({
    unit,
    held: false,
  }));
  if (ghost)
    rows.splice(Math.min(ghost.at, rows.length), 0, {
      unit: ghost.unit,
      held: true,
    });

  const sheetUnit =
    opened === null ? undefined : all.find((unit) => unit.id === opened);
  // Gone from «Брак» under its sheet — someone else decided first: the sheet
  // goes, and what was said stays on the screen.
  useEffect(() => {
    if (opened !== null && units.data !== undefined && sheetUnit === undefined)
      setOpened(null);
  }, [opened, units.data, sheetUnit]);

  async function refresh(): Promise<void> {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["damaged-units", store.id] }),
      cache.invalidateQueries({ queryKey: ["inventory-stock"] }),
      cache.invalidateQueries({ queryKey: ["sale-stock"] }),
      cache.invalidateQueries({ queryKey: ["supplier-returns", store.id] }),
    ]);
  }

  /** One step sent: the unit as the server keeps it now, or null — refused,
   * its words said. */
  async function record(
    unit: DamagedUnit,
    step: Step,
    body: Record<string, unknown> = {},
  ): Promise<DamagedUnit | null> {
    setBusy({ id: unit.id, step });
    setProblem(null);
    try {
      const answer = await api<DamagedUnit>(
        `/damaged-units/${unit.id}/${step}`,
        token,
        body,
      );
      setAnswers((now) =>
        new Map(now).set(answer.id, { unit: answer, at: Date.now() }),
      );
      return answer;
    } catch (error) {
      buzz("error");
      setProblem(refusalText(error));
      return null;
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  /** Where the unit stood in the segment shown, its place to hold: none
   * once it is not there. */
  function placeOf(unit: DamagedUnit): Held | null {
    const at = listed.findIndex((one) => one.id === unit.id);
    return at < 0 ? null : { unit, segment, at };
  }

  /** A decision recorded: its stub, the row's place held — or the place a
   * unit just taken left, kept for it. */
  function tell(next: Said, place: Held | null): void {
    setSaid((now) => ({
      said: next,
      held:
        place ??
        (now?.held && now.held.unit.id === next.unit.id ? now.held : null),
    }));
  }

  async function take(unit: DamagedUnit): Promise<void> {
    setChosen(segment);
    const place = placeOf(unit);
    const answer = await record(unit, "take");
    if (answer === null) return;
    // Taken, felt; and its sheet at once (P0-4).
    buzz("light");
    tell({ kind: "inspecting", unit: answer }, place);
    setOpened(answer.id);
  }

  async function decide(
    unit: DamagedUnit,
    step: Step,
    body: Record<string, unknown>,
    words: (answer: DamagedUnit) => Said,
  ): Promise<void> {
    setChosen(segment);
    const place = placeOf(unit);
    const answer = await record(unit, step, body);
    if (answer === null) return;
    if (step === "take") {
      // «Перевірити ще раз»: the sheet stays, the unit under inspection.
      buzz("light");
      tell(words(answer), place);
      return;
    }
    buzz("success");
    setOpened(null);
    tell(words(answer), place);
  }

  const told = said && (
    <div className="notice stub-notice">
      <Stub state="recorded">
        <p ref={stub} tabIndex={-1}>
          {saidText(said.said)}
        </p>
      </Stub>
    </div>
  );

  return (
    <>
      <ScreenHeader
        ref={title}
        title="Брак"
        focusable
        back={back && <BackToMore back={back} />}
        aside={
          <button
            type="button"
            className="quiet"
            disabled={units.isFetching}
            onClick={() => {
              setSaid(null);
              void units.refetch();
            }}
          >
            Оновити
          </button>
        }
      />
      <section className="goods-part damaged">
        {readOnly && (
          <p className="hint">Магазин не торгує: тут лише перегляд.</p>
        )}
        {problem && sheetUnit === undefined && <p role="alert">{problem}</p>}
        {units.data === undefined ? (
          units.isPending ? (
            <>
              <p role="status" className="visually-hidden">
                Завантажуємо «Брак»…
              </p>
              <div className="placeholder order-tags" aria-hidden="true">
                {[0, 1].map((n) => (
                  <div className="order-tag tag-row tag-outline" key={n}>
                    <div className="order-tag-body">
                      <span className="skeleton skeleton-name" />
                      <span className="skeleton skeleton-meta" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Unread
              error={units.error}
              retry={() => {
                void units.refetch();
              }}
            />
          )
        ) : all.length === 0 ? (
          // The last unit decided: what became of it stays said over the
          // empty «Брак» (review, 2026-11-07).
          <>
            {told}
            <Empty title="У «Брак» зараз нічого немає." />
          </>
        ) : (
          <>
            <ModeSwitch
              label="Які речі"
              modes={segments.map(({ mode, word }) => {
                const count = all.filter((unit) => unit.status === mode).length;
                return {
                  mode,
                  label: count > 0 ? `${word} ${String(count)}` : word,
                };
              })}
              current={segment}
              choose={(mode) => {
                setChosen(mode);
                setSaid(null);
                setProblem(null);
              }}
              disabled={false}
              filters
            />
            {/* A read that failed keeps the units already read. */}
            {units.error && (
              <Unread
                error={units.error}
                retry={() => {
                  void units.refetch();
                }}
              />
            )}
            {told}
            {rows.length === 0 ? (
              <Empty
                title={segments.find(({ mode }) => mode === segment)?.none}
              />
            ) : (
              <ul className="order-tags" aria-label="Брак">
                {rows.map(({ unit, held: gone }) => (
                  <UnitTag
                    key={gone ? `held:${unit.id}` : unit.id}
                    unit={unit}
                    held={gone}
                    verb={
                      readOnly || gone
                        ? undefined
                        : unit.status === "AWAITING"
                          ? {
                              words: "Взяти на перевірку",
                              held,
                              pressed:
                                busy?.id === unit.id && busy.step === "take",
                              act: () => {
                                void take(unit);
                              },
                            }
                          : {
                              words: "Вирішити",
                              held,
                              pressed: false,
                              act: () => {
                                setProblem(null);
                                setOpened(unit.id);
                              },
                            }
                    }
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      {!readOnly && sheetUnit && (
        <UnitSheet
          key={sheetUnit.id}
          unit={sheetUnit}
          store={store}
          token={token}
          places={places}
          maySupply={maySupply}
          held={held}
          busy={busy?.id === sheetUnit.id ? busy.step : null}
          problem={problem}
          fallback={landing}
          close={() => {
            setOpened(null);
            setProblem(null);
          }}
          decide={(step, body, words) => {
            void decide(sheetUnit, step, body, words);
          }}
        />
      )}
    </>
  );
}

const looks: Record<Segment, string> = {
  AWAITING: "dashed",
  INSPECTING: "ring",
  CONFIRMED: "filled torn tone-damaged",
};

/**
 * A unit as a row tag (spec §6.9; stage 2, goods task list, P0-4): its
 * eyelet by its state — dashed while it waits, a ring while someone looks
 * at it, filled in «Брак»'s colour, its edge torn, once confirmed —; the
 * goods and size, who looks and since when, when it came back and where it
 * was sold from, its note; one verb bottom right. Held, its place alone:
 * nothing drawn, nothing read.
 */
function UnitTag({
  unit,
  held,
  verb,
}: {
  unit: DamagedUnit;
  held: boolean;
  verb:
    | { words: string; held: boolean; pressed: boolean; act: () => void }
    | undefined;
}): JSX.Element {
  const title = useId();
  const status: Segment = inBin(unit.status) ? unit.status : "CONFIRMED";
  const looking = inspector(unit);
  return (
    <li
      className={held ? "damaged-held" : undefined}
      aria-hidden={held || undefined}
    >
      <article
        className={`order-tag damaged-unit tag-row tag-outline ${looks[status]}`}
        aria-labelledby={title}
        data-status={unit.status}
      >
        <div className="order-tag-body">
          <span className="order-tag-eyelet" aria-hidden="true" />
          <span className="order-tag-title t-row" id={title}>
            {unitName(unit)}
          </span>
          {looking && <span className="order-tag-meta t-meta">{looking}</span>}
          <span className="order-tag-meta t-meta">{whence(unit)}</span>
          {unit.note && (
            <span className="order-tag-meta t-meta">
              Примітка: {visible(unit.note)}
            </span>
          )}
          {verb && (
            <button
              type="button"
              className={verb.pressed ? "tag-verb pressed" : "tag-verb"}
              aria-describedby={title}
              aria-haspopup="dialog"
              disabled={verb.held}
              onClick={verb.act}
            >
              {verb.pressed && <Eyelet state="spin" size={20} />}
              {verb.words}
            </button>
          )}
        </div>
      </article>
    </li>
  );
}

/** A decision's second step, asked in the unit's sheet. */
type Asking = "return" | "confirm" | "write-off" | "supplier";

/**
 * A unit's sheet (stage 2, goods task list, P0-4): what it is, and what may
 * be decided of it as it is now, one under another. Each decision is a
 * second step here — the warehouse it goes back to named, or chosen; a note,
 * if any; the supplier — and Telegram's MainButton its yes, outside Telegram
 * the sheet's own. «Назад» closes the sheet, nothing recorded. Refused, the
 * words say why here.
 */
function UnitSheet({
  unit,
  store,
  token,
  places,
  maySupply,
  held,
  busy,
  problem,
  fallback,
  close,
  decide,
}: {
  unit: DamagedUnit;
  store: Store;
  token: string;
  /** This store's warehouses, for a unit sold from another store's own. */
  places: UseQueryResult<Location[]>;
  /** Whoever returns goods to suppliers (`supplier:return`). */
  maySupply: boolean;
  held: boolean;
  /** The step being sent for this unit. */
  busy: Step | null;
  problem: string | null;
  fallback: RefObject<HTMLElement>;
  close: () => void;
  decide: (
    step: Step,
    body: Record<string, unknown>,
    words: (answer: DamagedUnit) => Said,
  ) => void;
}): JSX.Element {
  const hint = useId();
  // The step asked, for the unit as it was: another state read, the sheet
  // asks afresh.
  const [asked, setAsked] = useState<{
    status: DamagedStatus;
    step: Asking;
    at: number;
  } | null>(null);
  const asking = asked !== null && asked.status === unit.status ? asked : null;
  const [note, setNote] = useState("");
  const [place, setPlace] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const suppliers = useSuppliers(store, token, maySupply);
  const trimmed = note.trim();
  const sending = busy !== null;

  // Its way changed — a step asked, or the unit's state —: the cursor on the
  // sheet again, as it opened, never lost with the button pressed.
  const inside = useRef<HTMLDivElement>(null);
  const way = `${unit.status}:${asking?.step ?? ""}`;
  const wayWas = useRef(way);
  useEffect(() => {
    if (wayWas.current === way) return;
    wayWas.current = way;
    inside.current
      ?.closest<HTMLElement>(".sheet")
      ?.focus({ preventScroll: true });
  }, [way]);

  const ask = (step: Asking): void => {
    setAsked({ status: unit.status, step, at: Date.now() });
    setNote("");
  };

  const placeName = unit.back_to_sold_from
    ? unit.sold_from_location_name
    : places.data?.find((location) => location.id === place)?.name;
  const supplierName = suppliers.data?.find(
    (supplier) => supplier.id === supplierId,
  )?.name;

  const words =
    asking === null
      ? ""
      : asking.step === "return"
        ? placeName === undefined
          ? "Оберіть склад"
          : `Так, повернути на «${visible(placeName)}»`
        : asking.step === "confirm"
          ? "Так, брак підтверджений"
          : asking.step === "write-off"
            ? "Так, списати"
            : "Так, повернути постачальнику";
  const ready =
    asking !== null &&
    !held &&
    (asking.step === "return"
      ? placeName !== undefined
      : asking.step === "supplier"
        ? supplierName !== undefined
        : true);

  // The tap that asked lands on the sheet's own yes, risen in its place:
  // let go for a moment, as the sheet lets its own (review, 2026-10-24). A
  // key's press, or Telegram's button, is never one.
  const askedAt = asking?.at ?? null;
  const [letGo, setLetGo] = useState<number | null>(null);
  useEffect(() => {
    if (askedAt === null) return;
    const wait = window.setTimeout(() => {
      setLetGo(askedAt);
    }, CARRIED_TAP);
    return () => {
      window.clearTimeout(wait);
    };
  }, [askedAt]);
  const settled = askedAt !== null && letGo === askedAt;

  const press = (): void => {
    if (asking === null || !ready) return;
    const note = trimmed ? trimmed : null;
    if (asking.step === "return") {
      const to = placeName ?? "";
      decide(
        "return-to-sale",
        {
          destination_location_id: unit.back_to_sold_from
            ? unit.sold_from_location_id
            : place,
        },
        (answer) => ({ kind: "returned", unit: answer, place: to }),
      );
    } else if (asking.step === "confirm")
      decide("confirm", { note }, (answer) => ({
        kind: "confirmed",
        unit: answer,
      }));
    else if (asking.step === "write-off")
      decide("write-off", { note }, (answer) => ({
        kind: "written-off",
        unit: answer,
      }));
    else {
      const to = supplierName ?? "";
      decide(
        "return-to-supplier",
        { supplier_id: supplierId, note },
        (answer) => ({ kind: "supplier", unit: answer, supplier: to }),
      );
    }
  };
  const main = useMainButton(words, press, {
    shown: asking !== null,
    progress: sending,
    active: ready,
  });

  const again = (): void => {
    decide("take", {}, (answer) => ({ kind: "inspecting", unit: answer }));
  };
  const looking = inspector(unit);

  return (
    <Sheet
      title={unitName(unit)}
      close={() => {
        if (!sending) close();
      }}
      fallback={fallback}
      foot={
        asking === null ? (
          <div className="damaged-ways">
            {unit.status === "AWAITING" && (
              <button
                type="button"
                className={busy === "take" ? "quiet pressed" : "quiet"}
                disabled={held}
                onClick={again}
              >
                {busy === "take" && <Eyelet state="spin" size={20} />}
                Взяти на перевірку
              </button>
            )}
            {unit.status === "INSPECTING" && (
              <>
                <button
                  type="button"
                  className="quiet"
                  disabled={held}
                  onClick={() => {
                    ask("return");
                  }}
                >
                  Повернути в продаж
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={held}
                  onClick={() => {
                    ask("confirm");
                  }}
                >
                  Брак підтверджений
                </button>
              </>
            )}
            {unit.status === "CONFIRMED" && (
              <>
                <button
                  type="button"
                  className="quiet"
                  disabled={held}
                  onClick={() => {
                    ask("write-off");
                  }}
                >
                  Списати
                </button>
                {maySupply && (
                  <button
                    type="button"
                    className="quiet"
                    disabled={held}
                    onClick={() => {
                      ask("supplier");
                    }}
                  >
                    Повернути постачальнику
                  </button>
                )}
                <button
                  type="button"
                  className={busy === "take" ? "quiet pressed" : "quiet"}
                  disabled={held}
                  onClick={again}
                >
                  {busy === "take" && <Eyelet state="spin" size={20} />}
                  Перевірити ще раз
                </button>
              </>
            )}
          </div>
        ) : main ? undefined : (
          // Outside Telegram, its MainButton as the sheet's own.
          <div className="count-foot">
            <button
              type="button"
              className="sheet-done main-mimic"
              disabled={!ready && !sending}
              aria-disabled={sending || undefined}
              data-ready={settled ? "" : undefined}
              onClick={(event) => {
                if (event.detail !== 0 && !settled) return;
                press();
              }}
            >
              {sending ? (
                <>
                  <Eyelet state="spin" size={20} />
                  <span className="visually-hidden">{words}</span>
                </>
              ) : (
                words
              )}
            </button>
          </div>
        )
      }
    >
      <div ref={inside} className="damaged-sheet">
        {looking && <p className="t-meta">{looking}</p>}
        <p className="t-meta">{whence(unit)}</p>
        {unit.note && <p className="t-meta">Примітка: {visible(unit.note)}</p>}
        {asking?.step === "return" &&
          (unit.back_to_sold_from ? (
            <p className="t-row damaged-ask">
              Повернути в продаж на склад «
              {visible(unit.sold_from_location_name)}», звідки його продали?
            </p>
          ) : (
            <>
              <p className="t-row damaged-ask">
                Його продали з власного складу іншого магазину. Оберіть склад
                вашого магазину.
              </p>
              {places.data === undefined ? (
                places.isPending ? (
                  // Grey choices where the warehouses come (audit after
                  // stage 2, frame P1-4).
                  <Placeholder
                    said="Завантажуємо склади…"
                    chips={2}
                    className="damaged-place"
                  />
                ) : (
                  <Unread
                    error={places.error}
                    retry={() => {
                      void places.refetch();
                    }}
                  />
                )
              ) : places.data.length === 0 ? (
                <p>Тут немає складу, куди повернути в продаж.</p>
              ) : (
                <div
                  className="chips damaged-place"
                  role="group"
                  aria-label="Склад вашого магазину"
                >
                  {places.data.map((location) => (
                    <button
                      type="button"
                      className="chip"
                      key={location.id}
                      aria-pressed={location.id === place}
                      disabled={sending}
                      onClick={() => {
                        buzz("selection");
                        setPlace(location.id);
                      }}
                    >
                      {visible(location.name)}
                    </button>
                  ))}
                </div>
              )}
            </>
          ))}
        {asking?.step === "supplier" && (
          <SupplierPicker
            store={store}
            token={token}
            value={supplierId}
            change={setSupplierId}
            disabled={sending}
            // In a sheet already: no sheet over a sheet (stage 2, money task
            // list, P0-3).
            inPlace
          />
        )}
        {asking !== null && asking.step !== "return" && (
          <label>
            {asking.step === "confirm"
              ? "Що з товаром (необов’язково)"
              : asking.step === "write-off"
                ? "Чому списуємо (необов’язково)"
                : "Примітка для постачальника (необов’язково)"}
            <textarea
              value={note}
              maxLength={1000}
              aria-describedby={hint}
              disabled={sending}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <NoCustomerData id={hint} />
          </label>
        )}
        {problem && <p role="alert">{problem}</p>}
      </div>
    </Sheet>
  );
}
