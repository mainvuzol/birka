import { useId, useLayoutEffect, useRef } from "react";
import type { JSX, MutableRefObject, ReactNode } from "react";
import { StoreName } from "@/money/Money";
import { methodLabels } from "@/shared/payment";
import { visible } from "@/shared/visible";
import {
  bare,
  correctionsText,
  minus,
  moved,
  nothing,
  signed,
  wayLabels,
} from "./format";
import type { Figures, SalesReport, WayFigures } from "./types";

/** A column: a store, or the stores together. */
interface Column {
  key: string;
  head: ReactNode;
  figures: Figures;
}

/** A row: its words, the figure of each column, and under it what it
 * counts. */
interface Line {
  key: string;
  label: string;
  value: (figures: Figures) => string;
  meta?: (figures: Figures) => string;
  strong?: boolean;
}

/** A way's figures in a column; none, nothing. */
function wayOf(figures: Figures, method: WayFigures["method"]): WayFigures {
  return (
    figures.ways.find((way) => way.method === method) ?? {
      method,
      came_in: "0.00",
      went_out: "0.00",
      corrected: "0.00",
      net: "0.00",
    }
  );
}

/**
 * «Звіт про продажі»'s one table (stage 2, money task list, P1-1; spec S29,
 * §6.21; the sections task list's deviation №2): the rows down, a column a
 * store — marked when it does not trade — and «Усі разом», the server's
 * `total`, when there are several. «грн» is said once, in the corner; a row
 * only some stores have — «Не вказано», a correction across the till, an
 * order's way paid off it — stands only where one of them has it. Wider
 * than the phone, the table alone scrolls, its first column in view.
 */
export function ReportTable({
  report,
  across,
}: {
  report: SalesReport;
  /** How far the stores are scrolled: kept by the report while its other
   * screens are open. */
  across: MutableRefObject<number>;
}): JSX.Element {
  const caption = useId();
  const columns: Column[] = [
    ...report.stores.map((store) => ({
      key: store.store_id,
      head: <StoreName name={store.store_name} state={store.store_state} />,
      figures: store,
    })),
    ...(report.total
      ? [{ key: "total", head: "Усі разом", figures: report.total }]
      : []),
  ];
  const any = (held: (figures: Figures) => boolean): boolean =>
    columns.some((column) => held(column.figures));
  const ways: Line[] = (["CASH", "CARD", "TRANSFER", "NOT_STATED"] as const)
    .filter(
      (method) =>
        method !== "NOT_STATED" ||
        any((figures) => {
          const way = wayOf(figures, method);
          return ![way.came_in, way.went_out, way.corrected].every(nothing);
        }),
    )
    .map((method) => ({
      key: method,
      label: wayLabels[method],
      value: (figures) => bare(signed(wayOf(figures, method).net)),
    }));
  const orders: Line[] = (
    [
      ["prepaid_transfer", methodLabels.PREPAID_TRANSFER],
      ["carrier_cod", methodLabels.CARRIER_COD],
    ] as const
  )
    .filter(([way]) =>
      any(
        (figures) =>
          !nothing(figures.off_till[way].came_in) ||
          !nothing(figures.off_till[way].corrected),
      ),
    )
    .map(([way, label]) => ({
      key: way,
      label,
      value: (figures) => bare(signed(figures.off_till[way].net)),
    }));
  const sections: { title: string; lines: Line[] }[] = [
    {
      title: "Продажі",
      lines: [
        {
          key: "sold",
          label: "Продажі",
          value: (figures) => bare(signed(figures.sold)),
          meta: (figures) =>
            `${String(figures.sales)} · ${String(figures.units)} шт.`,
        },
        {
          key: "returned",
          label: "Повернення",
          value: (figures) => bare(minus(figures.returned)),
          meta: (figures) =>
            `${String(figures.returns)} · ${String(figures.returned_units)} шт.`,
        },
        {
          key: "net",
          label: "З урахуванням повернень",
          value: (figures) => bare(signed(figures.net)),
          strong: true,
        },
      ],
    },
    {
      // «Гроші», not «Гроші в касі»: card and transfer are in it too, and
      // «Каса» is the cash drawer (ADR-0012 §B11, §G24).
      title: "Гроші",
      lines: [
        {
          key: "paid_in_full",
          label: "Оплачено одразу повністю",
          value: (figures) => bare(signed(figures.paid_in_full)),
        },
        {
          key: "debt_payments",
          label: "Внески за борг",
          value: (figures) => bare(signed(figures.debt_payments)),
        },
        {
          key: "paid_back",
          label: "Віддано при поверненнях",
          value: (figures) => bare(minus(figures.paid_back)),
        },
        ...(any((figures) => !nothing(figures.corrected_into_till))
          ? [
              {
                key: "corrected_into_till",
                label: "Виправлення способу оплати",
                value: (figures: Figures) =>
                  nothing(figures.corrected_into_till)
                    ? bare(signed(figures.corrected_into_till))
                    : bare(moved(figures.corrected_into_till)),
              },
            ]
          : []),
        {
          key: "money",
          label: "Разом",
          value: (figures) => bare(signed(figures.money)),
          strong: true,
        },
      ],
    },
    // The till's ways add up to «Разом».
    { title: "За способом оплати", lines: ways },
    // Orders paid off the till stand outside «Разом» (G24).
    { title: "Окремо від «Разом» — замовлення", lines: orders },
  ];
  const corrected = report.stores.filter((store) => correctionsText(store));
  // Wider than the phone, the stores scroll and stop on a whole column
  // beside the rows' words: the last one too, room left after it so it can
  // stand there — never a figure half under them, «250,00» of «12 250,00».
  const wrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = wrap.current;
    if (node === null) return;
    const room = (): void => {
      // Measured with no room after it; scrolled where it was.
      const at = node.scrollLeft;
      node.style.paddingRight = "";
      const table = node.querySelector("table");
      const first = node.querySelector<HTMLElement>(".money-unit");
      const last = node.querySelector<HTMLElement>("thead th:last-child");
      if (!table || !first || !last) return;
      const wide = table.offsetWidth > node.clientWidth;
      const left = node.clientWidth - first.offsetWidth - last.offsetWidth;
      if (wide && left > 0) node.style.paddingRight = `${String(left)}px`;
      // A section's name sticks within the table: scrolled to the end, it
      // keeps in view only as much as the first column and the last.
      if (wide)
        node.style.setProperty(
          "--report-label",
          `${String(first.offsetWidth + last.offsetWidth - 2)}px`,
        );
      else node.style.removeProperty("--report-label");
      node.scrollLeft = at;
    };
    room();
    // Back from «Моделі» or «Продажі й повернення»: where it was left.
    node.scrollLeft = across.current;
    const watch = new ResizeObserver(room);
    watch.observe(node);
    return () => {
      watch.disconnect();
    };
    // Read again with each answer: its figures set the columns' widths.
  }, [report, across]);
  return (
    <>
      <div
        ref={wrap}
        className="money-table-wrap report-table-wrap"
        role="region"
        aria-labelledby={caption}
        tabIndex={0}
        onScroll={(event) => {
          across.current = event.currentTarget.scrollLeft;
        }}
      >
        <table className="money-table report-table">
          <caption id={caption} className="visually-hidden">
            Звіт про продажі, грн
          </caption>
          <thead>
            <tr>
              <td className="money-unit" aria-hidden="true">
                грн
              </td>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.head}
                </th>
              ))}
            </tr>
          </thead>
          {sections
            .filter((section) => section.lines.length > 0)
            .map((section) => (
              <tbody key={section.title}>
                <tr className="report-section">
                  <th scope="rowgroup" colSpan={columns.length + 1}>
                    <span className="t-label">{section.title}</span>
                  </th>
                </tr>
                {section.lines.map((line) => (
                  <tr
                    key={line.key}
                    className={line.strong ? "money-total" : undefined}
                  >
                    <th scope="row">{line.label}</th>
                    {columns.map((column) => (
                      <td key={column.key}>
                        {line.value(column.figures)}
                        {line.meta && (
                          <span className="report-meta">
                            {line.meta(column.figures)}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
        </table>
      </div>
      {corrected.map((store) => (
        <p key={store.store_id} className="t-meta report-note">
          Виправлення способу оплати: {correctionsText(store)} («
          {visible(store.store_name)}»)
        </p>
      ))}
    </>
  );
}
