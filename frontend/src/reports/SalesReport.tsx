import { useId, useLayoutEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { periods, rangeOf, usePeriodReport } from "@/money/reads";
import type { Period } from "@/money/reads";
import { ApiError, errorText } from "@/shared/api";
import { Back } from "@/shared/Back";
import { Icon } from "@/shared/Icon";
import { BackToMore } from "@/shared/More";
import type { MoreBack } from "@/shared/More";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { ScreenHeader } from "@/shared/ScreenHeader";
import { Sheet } from "@/shared/Sheet";
import { Unread } from "@/shared/Unread";
import { Stamp, staleOf, useNow } from "@/today/age";
import { ageOf } from "@/today/reads";
import { daysText, periodLead } from "./format";
import type { Chosen, Range } from "./format";
import { ReportEntries } from "./ReportEntries";
import { ReportModels } from "./ReportModels";
import { ReportTable, ReportTableWait } from "./ReportTable";
import { StoreSwitch } from "./StoreSwitch";

/** The report's own screens, opened from its rows. */
type View = "table" | "models" | "entries";

/** How the report counts, said once a row is tapped (В5 (а)): the three
 * sentences as they were. */
const howWeCount =
  "Продажі й повернення рахуються магазину, який продав, гроші — магазину, через чию касу пройшли. Повернення — у день, коли його прийняли, виправлення способу оплати — у день, коли його записали.";

/** A way to another screen, a row with its chevron (spec §6.8). */
function WayRow({
  title,
  way,
  open,
}: {
  title: string;
  way: string;
  open: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="sale-row cash-row report-way"
      data-way={way}
      onClick={open}
    >
      <span className="sale-main">
        <span className="cash-row-title">{title}</span>
      </span>
      <Icon name="chevron-right" size={16} />
    </button>
  );
}

/** The longest period the server reads at once, a leap day included
 * (`MAX_DAYS`, backend/app/modules/reports/sales.py): the phone repeats it
 * only to say so before «Показати»; the server still decides. */
const maxDays = 366;

/** A day as the server reads it, «2026-03-10»: a year of five figures or
 * more, which a desktop's date field lets one type, is none (review). */
function isDay(day: string): boolean {
  return /^\d{4}-\d\d-\d\d$/.test(day);
}

/** A day as a count of days, to measure a period. */
function dayCount(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 86_400_000;
}

/** Days the server would refuse, both chosen: one it cannot read, the last
 * before the first, or more than a year — its own bound, `(last − first).days
 * ≥ 366`. */
function refusedDays(from: string, to: string): boolean {
  if (from === "" || to === "") return false;
  if (!isDay(from) || !isDay(to)) return true;
  return to < from || dayCount(to) - dayCount(from) >= maxDays;
}

/** «Інші дні» (spec §6.29): the first and the last day. Days the server
 * would refuse are said under them as they are chosen, in its own words,
 * and «Показати» holds; the dates' own pickers keep the first not after the
 * last — a year is said, never bounded, so days long past are two picks
 * away (audit 2026-11-15, money P2-3 (а); review). */
function OtherDays({
  shown,
  choose,
  close,
}: {
  shown: Range | null;
  choose: (range: Range) => void;
  close: () => void;
}): JSX.Element {
  const [from, setFrom] = useState(shown?.from ?? "");
  const [to, setTo] = useState(shown?.to ?? "");
  const wrong = refusedDays(from, to);
  const wrongLine = useId();
  return (
    <Sheet
      title="Інші дні"
      close={close}
      foot={
        <button
          type="button"
          className="sheet-done primary"
          disabled={!from || !to || wrong}
          onClick={() => {
            choose({ from, to });
            close();
          }}
        >
          Показати
        </button>
      }
    >
      <div className="fields period">
        <label>
          Від
          <input
            type="date"
            value={from}
            max={to || undefined}
            aria-invalid={wrong || undefined}
            aria-describedby={wrong ? wrongLine : undefined}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </label>
        <label>
          До
          <input
            type="date"
            value={to}
            min={from || undefined}
            aria-invalid={wrong || undefined}
            aria-describedby={wrong ? wrongLine : undefined}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </label>
      </div>
      {wrong && (
        <p id={wrongLine} className="field-wrong" role="alert">
          Оберіть період від одного дня до року; перший день — не пізніше
          останнього.
        </p>
      )}
    </Sheet>
  );
}

/**
 * The sales report (owner decisions, 2026-10-02): what each store sold and
 * took back, and the money through its till, for today or any days. The owner
 * and managers read it, each for the stores they hold it in, and the stores
 * together when there are several. Since 2026-10-04 the money is split by the
 * way it was paid, and an order paid off the till has its own lines, outside
 * «Разом» (ADR-0012 §B11, §G24).
 *
 * Since stage 2 (money task list, P1-1): «Гроші»'s periods as one switch,
 * days of one's own in a sheet; one table, a column a store and «Усі
 * разом»; how old it is while today is in it; «Моделі» and «Продажі й
 * повернення» each a screen of its own, with a switch of the store.
 */
export function SalesReport({
  token,
  scopeKey,
  back,
  period = { mode: "today", range: null },
}: {
  token: string;
  scopeKey: string;
  /** «← Гроші» over the heading, or «← Ще» (navigation task list, P0-4;
   * «Усе на бірці» sections task list, P0-7). */
  back?: MoreBack | undefined;
  /** What it opens on: «Надійшло»'s period on «Гроші», and its days. */
  period?: { mode: Period; range: Range | null };
}): JSX.Element {
  // None is today, as the server counts it where the stores are.
  const [range, setRange] = useState<Range | null>(period.range);
  // The period as chosen, never guessed from its days: on a Monday
  // «Тиждень» is one day, today's, and still «Тиждень» (review,
  // 2026-11-08). Its days not known yet on «Гроші», today's are read.
  const [chosen, setChosen] = useState<Chosen>(
    period.range === null ? "today" : period.mode,
  );
  const [view, setView] = useState<View>("table");
  // Whose models and entries: kept between the two screens.
  const [storeId, setStoreId] = useState("");
  const [otherDays, setOtherDays] = useState(false);
  const [how, setHow] = useState(false);
  // «Гроші»'s own read of these days: what one learns, the other shows;
  // read again as it is opened.
  const report = usePeriodReport(token, scopeKey, range, true);
  const data = report.data;
  // The server's today, kept while other days are read: the switch names
  // its periods by it.
  const [today, setToday] = useState<string | undefined>(undefined);
  if (data !== undefined && data.today !== today) setToday(data.today);
  const shown: Range | null = data
    ? { from: data.date_from, to: data.date_to }
    : range;
  const lead = periodLead(shown, chosen, today);
  const now = useNow();
  const age = ageOf([report]);
  const withToday =
    today !== undefined && (shown === null || shown.to >= today);
  const refused =
    report.error instanceof ApiError &&
    report.error.details.reason === "PERIOD";
  // Back from a screen of its own: where the list was read to, and the row
  // that opened it in hand.
  const place = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const opened = useRef<View | null>(null);
  // How far the stores were scrolled across: the same on coming back.
  const across = useRef(0);
  // A screen of its own at its top, the header's; back, the table where it
  // was left, before it is painted (audit after stage 2, frame P1-3).
  useLayoutEffect(() => {
    if (view !== "table") {
      heading.current?.focus();
      return;
    }
    if (opened.current === null) return;
    window.scrollTo(0, place.current);
    document
      .querySelector<HTMLButtonElement>(`[data-way="${opened.current}"]`)
      ?.focus({ preventScroll: true });
  }, [view]);
  const open = (next: View) => (): void => {
    place.current = window.scrollY;
    opened.current = next;
    setView(next);
  };
  const stores = data?.stores ?? [];
  if (view !== "table") {
    const title = view === "models" ? "Моделі" : "Продажі й повернення";
    return (
      <>
        <ScreenHeader
          ref={heading}
          focusable
          title={title}
          lead={lead}
          back={
            <Back
              go={() => {
                setView("table");
                // Back to the table: read again, as on opening — «Оновити» is
                // gone from the title (audit 2026-11-13; review).
                void report.refetch();
              }}
              label="Назад до «Звіт про продажі»"
            >
              <span aria-hidden="true">← </span>Звіт про продажі
            </Back>
          }
        />
        <section className="report report-screen">
          <StoreSwitch stores={stores} current={storeId} choose={setStoreId} />
          {view === "models" ? (
            <ReportModels
              token={token}
              scopeKey={scopeKey}
              range={range}
              storeId={storeId}
            />
          ) : (
            <ReportEntries
              token={token}
              scopeKey={scopeKey}
              range={range}
              today={today}
              storeId={storeId}
              everyStore={storeId === "" && stores.length > 1}
            />
          )}
        </section>
      </>
    );
  }
  return (
    <>
      <ScreenHeader
        title="Звіт про продажі"
        back={back && <BackToMore back={back} />}
        lead={lead}
      />
      {/* Read again while it stands: a reader is told to wait for it
          (decided here, 2026-11-15 — no «Оновити» says it any more). */}
      <section className="report" aria-busy={report.isFetching || undefined}>
        <ModeSwitch<Chosen>
          label="Період"
          modes={periods}
          current={chosen}
          // The days are the server's: held until the report says which day
          // today is. «Сьогодні» is none, the server's own: never held.
          disabled={(mode) => mode !== "today" && today === undefined}
          choose={(mode) => {
            if (mode === "other" || (mode !== "today" && today === undefined))
              return;
            setChosen(mode);
            setRange(today === undefined ? null : rangeOf(mode, today));
          }}
          kind="pressed"
          className="report-periods"
        />
        <button
          type="button"
          className="quiet report-days"
          onClick={() => {
            setOtherDays(true);
          }}
        >
          {chosen === "other" && shown
            ? `${daysText(shown, today)} · Змінити`
            : "Інші дні"}
        </button>
        {withToday && age.at !== undefined && staleOf(age, now) && (
          <p className="report-age">
            <Stamp age={age} now={now} />
          </p>
        )}
        {/* Read again and failed: what was read stands, and it is said. */}
        {data !== undefined && report.isError && (
          <Unread
            error={report.error}
            retry={() => {
              void report.refetch();
            }}
          />
        )}
        {data === undefined ? (
          refused ? (
            // Days refused as chosen: reading them again changes nothing,
            // so no «Спробувати ще раз» (review, 2026-11-05).
            <p role="alert">{errorText(report.error)}</p>
          ) : report.error ? (
            <Unread
              error={report.error}
              retry={() => {
                void report.refetch();
              }}
            />
          ) : (
            <ReportTableWait />
          )
        ) : (
          <ReportTable report={data} across={across} />
        )}
        {/* The report's ways, one white block under the table, «Як
            рахуємо» its last row; the table unread, alone in it (spec
            §6.8; audit 2026-11-13, money P2-4). */}
        <div className="list-block report-ways-block">
          {data !== undefined && (
            <nav aria-label="Звіт про продажі" className="report-ways">
              <WayRow title="Моделі" way="models" open={open("models")} />
              <WayRow
                title="Продажі й повернення"
                way="entries"
                open={open("entries")}
              />
            </nav>
          )}
          <WayRow
            title="Як рахуємо"
            way="how"
            open={() => {
              setHow(true);
            }}
          />
        </div>
      </section>
      {otherDays && (
        <OtherDays
          shown={shown}
          choose={(days) => {
            // Days of one's own stay one's own, whatever period they make.
            setChosen("other");
            setRange(days);
          }}
          close={() => {
            setOtherDays(false);
          }}
        />
      )}
      {how && (
        <Sheet
          title="Як рахуємо"
          close={() => {
            setHow(false);
          }}
        >
          <p className="report-how">{howWeCount}</p>
        </Sheet>
      )}
    </>
  );
}
