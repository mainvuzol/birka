import { useEffect, useRef, useState } from "react";
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
import { Stamp, Waiting, staleOf, useNow } from "@/today/age";
import { ageOf } from "@/today/reads";
import { daysText, periodLead } from "./format";
import type { Chosen, Range } from "./format";
import { ReportEntries } from "./ReportEntries";
import { ReportModels } from "./ReportModels";
import { ReportTable } from "./ReportTable";
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

/** «Інші дні» (spec §6.29): the first and the last day, shown once
 * «Показати» is pressed; the server says whether they make a period. */
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
  return (
    <Sheet
      title="Інші дні"
      close={close}
      foot={
        <button
          type="button"
          className="sheet-done"
          disabled={!from || !to}
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
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </label>
      </div>
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
  useEffect(() => {
    if (view !== "table") {
      window.scrollTo(0, 0);
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
        aside={
          <button
            className="quiet"
            disabled={report.isFetching}
            onClick={() => {
              void report.refetch();
            }}
          >
            Оновити
          </button>
        }
      />
      <section className="report">
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
          filters
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
            <div className="money-table-wait" role="status">
              <span className="visually-hidden">Рахуємо…</span>
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <Waiting key={row} width="100%" />
              ))}
            </div>
          )
        ) : (
          <>
            <ReportTable report={data} across={across} />
            <nav aria-label="Звіт про продажі" className="report-ways">
              <WayRow title="Моделі" way="models" open={open("models")} />
              <WayRow
                title="Продажі й повернення"
                way="entries"
                open={open("entries")}
              />
            </nav>
          </>
        )}
        <WayRow
          title="Як рахуємо"
          way="how"
          open={() => {
            setHow(true);
          }}
        />
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
