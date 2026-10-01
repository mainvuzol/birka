import { useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorText } from "@/shared/api";
import { decimal, kopecks, money } from "@/orders/types";
import type { Store } from "@/orders/types";
import { asInput } from "@/prices/SuggestedPrice";
import {
  resolveInvoiceCommand,
  submitInvoiceCommand,
  useInvoiceCommand,
} from "./invoiceCommands";
import { SupplierPicker, useSuppliers } from "./Picker";
import type {
  Invoice,
  InvoiceBody,
  InvoiceEntry,
  InvoicePage,
  InvoiceStatus,
  ReturnPage,
  SupplierDebts,
} from "./types";

const pageSize = 20;

/** What a command says without its name and the store it was sent from. */
type Command =
  | Omit<Extract<InvoiceBody, { kind: "invoice" }>, "command_id" | "store_id">
  | Omit<Extract<InvoiceBody, { kind: "payment" }>, "command_id" | "store_id">
  | Omit<Extract<InvoiceBody, { kind: "set-off" }>, "command_id" | "store_id">
  | Omit<Extract<InvoiceBody, { kind: "write-off" }>, "command_id" | "store_id">
  | Omit<Extract<InvoiceBody, { kind: "sold" }>, "command_id" | "store_id">;

/**
 * What the store owes its suppliers (owner decisions, 2026-10-01).
 *
 * An invoice is recorded on its own — a supplier from the list, the sum on
 * it, what was paid at once, a note — and each is its own debt, paid in
 * parts with no schedule. Goods returned to that supplier are set off
 * against it for the sum the supplier counted. A payment, a set-off or the
 * invoice itself recorded by mistake is cancelled, saying why; the owner
 * writes off what the supplier forgave. Each store keeps its own; while a
 * store does not trade, any store of the network that trades pays.
 */
export function Invoices({
  store,
  token,
  journalKey,
  blocked,
  readOnly = false,
  networkOwner = false,
}: {
  store: Store;
  token: string;
  journalKey: string;
  /** Another command's outcome is unknown: nothing new until it is settled. */
  blocked: boolean;
  /** This store does not trade: its invoices are read, and paid elsewhere. */
  readOnly?: boolean;
  /** The owner of the network, who writes off an invoice of a store that does not trade. */
  networkOwner?: boolean;
}): JSX.Element {
  const cache = useQueryClient();
  const { busy, pending, error } = useInvoiceCommand();
  const [making, setMaking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [owedOnly, setOwedOnly] = useState(true);
  // Whose invoices: this store's, or those of the stores that do not trade.
  const [elsewhere, setElsewhere] = useState(false);
  const [shown, setShown] = useState(pageSize);
  const suppliers = useSuppliers(store, token);
  const invoices = useQuery({
    queryKey: [
      "supplier-invoices",
      store.id,
      elsewhere,
      supplierId,
      owedOnly,
      shown,
    ],
    queryFn: () =>
      api<InvoicePage>(
        `/supplier-invoices?store_id=${store.id}&limit=${String(shown)}${
          owedOnly ? "&status=OPEN" : ""
        }${supplierId ? `&supplier_id=${supplierId}` : ""}${
          elsewhere ? "&elsewhere=true" : ""
        }`,
        token,
      ),
    retry: false,
  });
  const summary = useQuery({
    queryKey: ["supplier-invoices", store.id, "summary"],
    queryFn: () =>
      api<SupplierDebts>(
        `/supplier-invoices/summary?store_id=${store.id}`,
        token,
      ),
    retry: false,
  });
  const working = busy || pending !== null;

  async function settled(invoice: Invoice, command: Command): Promise<void> {
    setMaking(false);
    setDone(doneText(invoice, command));
    setSelected(invoice);
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["supplier-invoices", store.id] }),
      cache.invalidateQueries({ queryKey: ["supplier-returns", store.id] }),
    ]);
  }

  /** Send one command that records money, through the journal. */
  async function send(command: Command): Promise<string | null> {
    setDone(null);
    const outcome = await submitInvoiceCommand(journalKey, token, {
      // A new transport key per attempt; the command's identity is
      // `command_id`, made here once: a resend after a lost answer comes
      // from the journal, which keeps it.
      key: crypto.randomUUID(),
      body: {
        ...command,
        command_id: crypto.randomUUID(),
        store_id: store.id,
      },
    });
    if (outcome.kind === "done") {
      await settled(outcome.result, command);
      return null;
    }
    if (outcome.kind === "refused") return refusalText(outcome.error);
    return null;
  }

  const notice = pending && (
    <section className="notice">
      <h3>
        {busy ? "Перевіряємо операцію…" : "Незавершена операція з накладною"}
      </h3>
      <p>
        Невідомо, чи записано{" "}
        {pending.body.kind === "invoice"
          ? "накладну"
          : pending.body.kind === "payment"
            ? "оплату"
            : pending.body.kind === "set-off"
              ? "залік"
              : pending.body.kind === "sold"
                ? "продаж позиченого"
                : "списання"}
        . Перевірте результат — та сама операція не запишеться двічі.
      </p>
      <button
        disabled={busy}
        onClick={() => {
          void resolveInvoiceCommand(journalKey, token, pending).then(
            (outcome) => {
              if (outcome.kind === "done")
                void settled(outcome.result, pending.body);
              else if (outcome.kind === "refused")
                setDone(refusalText(outcome.error));
            },
          );
        }}
      >
        Перевірити результат операції
      </button>
    </section>
  );

  if (selected)
    return (
      <>
        {notice}
        <InvoiceDetail
          store={store}
          token={token}
          blocked={blocked || working}
          readOnly={readOnly}
          networkOwner={networkOwner}
          invoice={selected}
          done={done}
          send={send}
          changed={(invoice) => {
            setSelected(invoice);
            void cache.invalidateQueries({
              queryKey: ["supplier-invoices", store.id],
            });
            void cache.invalidateQueries({
              queryKey: ["supplier-returns", store.id],
            });
          }}
          back={() => {
            setDone(null);
            setSelected(null);
          }}
        />
      </>
    );

  return (
    <section>
      <div className="toolbar">
        <h2>Накладні</h2>
        <button
          className="quiet"
          disabled={invoices.isFetching}
          onClick={() => {
            void invoices.refetch();
            void summary.refetch();
          }}
        >
          Оновити
        </button>
      </div>
      <p className="hint">
        {readOnly
          ? "Магазин не торгує: його накладні тут лише для перегляду. Сплачує будь-який магазин мережі, що працює."
          : "Що магазин винен постачальникам. Кожна накладна — окремий борг: сплачують частинами, без графіка, а повернений постачальнику товар зараховують заліком."}
      </p>
      {notice}
      {error instanceof Error && !(error instanceof ApiError) && (
        <p role="alert">{error.message}</p>
      )}
      {done && <p role="status">{done}</p>}
      {!readOnly && (
        <label>
          Чиї накладні
          <select
            value={elsewhere ? "ELSEWHERE" : "HERE"}
            onChange={(event) => {
              setElsewhere(event.target.value === "ELSEWHERE");
              setShown(pageSize);
            }}
          >
            <option value="HERE">Цього магазину</option>
            <option value="ELSEWHERE">
              Магазинів, що заблоковані чи закриті
            </option>
          </select>
        </label>
      )}
      {!elsewhere && summary.data && (
        <div
          className="section-block"
          aria-label="Скільки магазин винен постачальникам"
        >
          <p className="total">
            Магазин винен постачальникам{" "}
            <strong>{money(summary.data.owed)}</strong>
          </p>
          {summary.data.suppliers.length > 0 && (
            <ul aria-label="Борги за постачальниками">
              {summary.data.suppliers.map((debt) => (
                <li key={debt.supplier.id}>
                  {debt.supplier.name} — {money(debt.owed)}
                  {debt.invoices > 1 &&
                    ` · накладних: ${String(debt.invoices)}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!readOnly &&
        !elsewhere &&
        (making ? (
          <NewInvoice
            store={store}
            token={token}
            disabled={blocked || working}
            cancel={() => {
              setMaking(false);
            }}
            send={send}
          />
        ) : (
          <button
            disabled={blocked || working}
            onClick={() => {
              setDone(null);
              setMaking(true);
            }}
          >
            + Записати накладну
          </button>
        ))}
      <label>
        Постачальник
        <select
          value={supplierId}
          onChange={(event) => {
            setSupplierId(event.target.value);
            setShown(pageSize);
          }}
        >
          <option value="">Усі постачальники</option>
          {(suppliers.data ?? []).map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Показати
        <select
          value={owedOnly ? "OPEN" : "ALL"}
          onChange={(event) => {
            setOwedOnly(event.target.value === "OPEN");
            setShown(pageSize);
          }}
        >
          <option value="OPEN">Ще не сплачені</option>
          <option value="ALL">Усі, разом зі сплаченими й скасованими</option>
        </select>
      </label>
      {invoices.isPending ? (
        <p role="status">Завантажуємо накладні…</p>
      ) : invoices.error ? (
        <p role="alert">{errorText(invoices.error)}</p>
      ) : invoices.data.items.length === 0 ? (
        <p>
          {elsewhere
            ? "Магазини, що не працюють, нічого не винні постачальникам."
            : owedOnly
              ? "Зараз магазин нічого не винен постачальникам."
              : "У цьому магазині ще не записували накладних."}
        </p>
      ) : (
        <>
          {invoices.data.items.map((invoice) => (
            <article
              className="order-card"
              key={invoice.id}
              aria-label={`Накладна ${invoice.supplier.name} від ${when(invoice.at)}`}
            >
              <strong>{invoice.supplier.name}</strong>
              <small>
                {when(invoice.at)} · {invoice.by}
                {invoice.store_id !== store.id &&
                  ` · магазин «${invoice.store_name}»`}
              </small>
              <p>
                {invoice.status === "OPEN"
                  ? `Винні ${money(invoice.owed)} з ${money(invoice.amount)}`
                  : `${statusLabels[invoice.status]} · ${money(invoice.amount)}`}
              </p>
              {invoice.note && <p className="hint">{invoice.note}</p>}
              {invoice.sold && (
                <p className="hint">
                  За продане позичене: {invoice.sold.label} ×{" "}
                  {invoice.sold.quantity}
                </p>
              )}
              <button
                className="quiet"
                onClick={() => {
                  setDone(null);
                  setSelected(invoice);
                }}
              >
                Відкрити накладну {invoice.supplier.name} від {when(invoice.at)}
              </button>
            </article>
          ))}
          {invoices.data.has_more && (
            <button
              className="quiet"
              disabled={invoices.isFetching}
              onClick={() => {
                setShown(shown + pageSize);
              }}
            >
              Показати ще
            </button>
          )}
        </>
      )}
    </section>
  );
}

function NewInvoice({
  store,
  token,
  disabled,
  cancel,
  send,
}: {
  store: Store;
  token: string;
  disabled: boolean;
  cancel: () => void;
  send: (command: Command) => Promise<string | null>;
}): JSX.Element {
  const [supplier, setSupplier] = useState("");
  const [amount, setAmount] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function submit(): void {
    setProblem(null);
    const total = kopecks(amount);
    // Nothing paid at once is a choice too (owner decision, 2026-10-01).
    const paid = paidNow.trim() === "" ? 0n : kopecks(paidNow);
    if (!supplier) {
      setProblem("Оберіть постачальника.");
      return;
    }
    if (total === null || total <= 0n) {
      setProblem("Вкажіть суму за накладною з точністю до копійок.");
      return;
    }
    if (paid === null) {
      setProblem("Вкажіть, скільки сплачено одразу, з точністю до копійок.");
      return;
    }
    if (paid > total) {
      setProblem("Сплачено одразу не може бути більше, ніж сума накладної.");
      return;
    }
    void send({
      kind: "invoice",
      supplier_id: supplier,
      amount: decimal(total),
      paid_now: decimal(paid),
      note: note.trim() || null,
    }).then((refusal) => {
      if (refusal) setProblem(refusal);
    });
  }

  return (
    <fieldset disabled={disabled}>
      <legend>Нова накладна</legend>
      <SupplierPicker
        store={store}
        token={token}
        value={supplier}
        change={setSupplier}
        disabled={disabled}
      />
      <label>
        Сума за накладною, грн
        <input
          inputMode="decimal"
          placeholder="0,00"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </label>
      <label>
        Сплачено одразу, грн
        <input
          inputMode="decimal"
          placeholder="0,00"
          value={paidNow}
          onChange={(event) => {
            setPaidNow(event.target.value);
          }}
        />
      </label>
      <label>
        Примітка (необов’язково)
        <textarea
          value={note}
          maxLength={1000}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </label>
      {problem && <p role="alert">{problem}</p>}
      <div className="actions">
        <button type="button" onClick={submit}>
          Записати накладну
        </button>
        <button type="button" className="quiet" onClick={cancel}>
          Скасувати
        </button>
      </div>
    </fieldset>
  );
}

function InvoiceDetail({
  store,
  token,
  blocked,
  readOnly,
  networkOwner,
  invoice,
  done,
  send,
  changed,
  back,
}: {
  store: Store;
  token: string;
  blocked: boolean;
  readOnly: boolean;
  networkOwner: boolean;
  invoice: Invoice;
  done: string | null;
  send: (command: Command) => Promise<string | null>;
  changed: (invoice: Invoice) => void;
  back: () => void;
}): JSX.Element {
  const [amount, setAmount] = useState("");
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // Another store's invoice, paid here because that one does not trade.
  const elsewhere = invoice.store_id !== store.id;
  const open = invoice.status === "OPEN";
  // The owner writes off; for a store that does not trade, the network's.
  const mayWriteOff =
    invoice.store_state === "ACTIVE"
      ? !readOnly && store.permissions.includes("supplier:write_off")
      : networkOwner;
  const owed = kopecks(invoice.owed) ?? 0n;
  const standing = invoice.entries.filter(
    (entry) => entry.cancelled === null && entry.kind !== "WRITE_OFF",
  );

  async function refusedThen(refusal: string | null): Promise<void> {
    if (!refusal) return;
    setProblem(refusal);
    // Refused because the invoice moved on: show it as it is now.
    try {
      const [current] = (
        await api<InvoicePage>(
          `/supplier-invoices?store_id=${store.id}&supplier_id=${invoice.supplier.id}${
            elsewhere ? "&elsewhere=true" : ""
          }&limit=50`,
          token,
        )
      ).items.filter((item) => item.id === invoice.id);
      if (current) changed(current);
    } catch {
      // What was shown stays; the refusal says what to do.
    }
  }

  function pay(): void {
    setProblem(null);
    const cents = kopecks(amount);
    if (cents === null || cents <= 0n) {
      setProblem("Вкажіть суму оплати з точністю до копійок.");
      return;
    }
    if (cents > owed) {
      setProblem(
        `Це більше, ніж винні: залишок ${money(invoice.owed)}. Сплатіть не більше.`,
      );
      return;
    }
    void send({
      kind: "payment",
      invoice_id: invoice.id,
      amount: decimal(cents),
      ...(elsewhere ? { elsewhere: true } : {}),
    }).then((refusal) => {
      setAmount("");
      void refusedThen(refusal);
    });
  }

  return (
    <section>
      <div className="toolbar">
        <h2>Накладна</h2>
        <button className="quiet" onClick={back}>
          До списку накладних
        </button>
      </div>
      <h3>{invoice.supplier.name}</h3>
      <p className="hint">
        Записано {when(invoice.at)} · {invoice.by}
        {invoice.note && ` · ${invoice.note}`}
      </p>
      {invoice.sold && (
        <p>
          За продане позичене: {invoice.sold.label} × {invoice.sold.quantity}.
          Якщо позначили помилково — скасуйте накладну, і товар знову буде «на
          руках».
        </p>
      )}
      {elsewhere && (
        <p className="notice">
          Накладна магазину «{invoice.store_name}», який зараз{" "}
          {invoice.store_state === "ARCHIVED" ? "закрито" : "заблоковано"}.
          Сплачує цей магазин; борг лишається за «{invoice.store_name}».
        </p>
      )}
      <dl className="debt">
        <dt>Сума за накладною</dt>
        <dd>{money(invoice.amount)}</dd>
        <dt>Сплачено</dt>
        <dd>{money(invoice.paid)}</dd>
        {(kopecks(invoice.set_off) ?? 0n) > 0n && (
          <>
            <dt>Зараховано за повернений товар</dt>
            <dd>{money(invoice.set_off)}</dd>
          </>
        )}
        {(kopecks(invoice.written_off) ?? 0n) > 0n && (
          <>
            <dt>Списано</dt>
            <dd>{money(invoice.written_off)}</dd>
          </>
        )}
        <dt>Залишок</dt>
        <dd>
          <strong>{money(invoice.owed)}</strong>
        </dd>
      </dl>
      {!open && (
        <p className="badge">
          {statusLabels[invoice.status]}
          {invoice.cancelled &&
            ` ${when(invoice.cancelled.at)} · ${invoice.cancelled.reason} · ${invoice.cancelled.by}`}
        </p>
      )}
      {done && <p role="status">{done}</p>}
      {problem && <p role="alert">{problem}</p>}
      {open && !readOnly && (
        <fieldset disabled={blocked}>
          <legend>Оплата</legend>
          <label>
            Сума оплати, грн
            <input
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
              }}
            />
          </label>
          <div className="actions">
            <button type="button" onClick={pay}>
              Сплатити
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setAmount(asInput(invoice.owed));
              }}
            >
              Увесь залишок
            </button>
          </div>
        </fieldset>
      )}
      {open && !readOnly && !elsewhere && (
        <SetOffForm
          store={store}
          token={token}
          invoice={invoice}
          disabled={blocked}
          send={(supplierReturnId, cents) => {
            setProblem(null);
            return send({
              kind: "set-off",
              invoice_id: invoice.id,
              supplier_return_id: supplierReturnId,
              amount: decimal(cents),
            }).then((refusal) => {
              void refusedThen(refusal);
              return refusal;
            });
          }}
        />
      )}
      {open && mayWriteOff && (
        <fieldset disabled={blocked}>
          <legend>Списання</legend>
          {asking ? (
            <div className="notice">
              <p>
                Залишок {money(invoice.owed)} закриється без оплати. Скасувати
                це потім не можна.
              </p>
              <label>
                Чому списуємо
                <textarea
                  value={reason}
                  maxLength={1000}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
              </label>
              <div className="actions">
                <button
                  type="button"
                  disabled={reason.trim() === ""}
                  onClick={() => {
                    setProblem(null);
                    void send({
                      kind: "write-off",
                      invoice_id: invoice.id,
                      reason: reason.trim(),
                    }).then((refusal) => {
                      setAsking(false);
                      setReason("");
                      void refusedThen(refusal);
                    });
                  }}
                >
                  Так, списати {money(invoice.owed)}
                </button>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setAsking(false);
                  }}
                >
                  Скасувати
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setProblem(null);
                setAsking(true);
              }}
            >
              Списати залишок
            </button>
          )}
        </fieldset>
      )}
      <h3>Історія</h3>
      {invoice.entries.length === 0 ? (
        <p>Оплат і заліків ще не було.</p>
      ) : (
        <ul aria-label="Історія накладної">
          {invoice.entries.map((entry) => (
            <EntryRow
              key={entry.id}
              store={store}
              token={token}
              invoice={invoice}
              entry={entry}
              // A payment is cancelled where it may be made now; a set-off
              // in the store that owes. A write-off is final.
              cancellable={
                !readOnly &&
                entry.cancelled === null &&
                (invoice.status === "OPEN" || invoice.status === "SETTLED") &&
                (entry.kind === "PAYMENT" ||
                  (entry.kind === "SET_OFF" && !elsewhere))
              }
              disabled={blocked}
              changed={changed}
            />
          ))}
        </ul>
      )}
      {open &&
        !readOnly &&
        !elsewhere &&
        (standing.length > 0 ? (
          <p className="hint">
            Щоб скасувати накладну, спершу скасуйте її оплати й заліки.
          </p>
        ) : (
          <Reasoned
            label="Скасувати накладну"
            question="Накладну записано помилково? Вона лишиться в історії як скасована."
            confirm="Так, скасувати накладну"
            disabled={blocked}
            run={(why) =>
              api<Invoice>(`/supplier-invoices/${invoice.id}/cancel`, token, {
                reason: why,
              })
            }
            changed={changed}
          />
        ))}
    </section>
  );
}

function SetOffForm({
  store,
  token,
  invoice,
  disabled,
  send,
}: {
  store: Store;
  token: string;
  invoice: Invoice;
  disabled: boolean;
  send: (supplierReturnId: string, cents: bigint) => Promise<string | null>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("");
  const [amount, setAmount] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const returns = useQuery({
    queryKey: ["supplier-returns", store.id, invoice.supplier.id, "set-off"],
    queryFn: () =>
      api<ReturnPage>(
        `/supplier-returns?store_id=${store.id}&supplier_id=${invoice.supplier.id}&limit=50`,
        token,
      ),
    enabled: open,
    retry: false,
  });
  // Only what still stands: a cancelled return's goods came back.
  const standing = (returns.data?.items ?? []).filter(
    (item) => item.cancelled === null,
  );

  function submit(): void {
    setProblem(null);
    const cents = kopecks(amount);
    if (!chosen) {
      setProblem("Оберіть повернення.");
      return;
    }
    if (cents === null || cents <= 0n) {
      setProblem("Вкажіть суму заліку з точністю до копійок.");
      return;
    }
    if (cents > (kopecks(invoice.owed) ?? 0n)) {
      setProblem(
        `Це більше, ніж винні: залишок ${money(invoice.owed)}. Решту зарахуйте на іншу накладну.`,
      );
      return;
    }
    void send(chosen, cents).then((refusal) => {
      if (!refusal) {
        setOpen(false);
        setChosen("");
        setAmount("");
      }
    });
  }

  if (!open)
    return (
      <button
        className="quiet"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
      >
        Залік за повернений товар
      </button>
    );

  return (
    <fieldset disabled={disabled}>
      <legend>Залік за повернений товар</legend>
      {returns.isPending ? (
        <p role="status">Завантажуємо повернення…</p>
      ) : returns.error ? (
        <p role="alert">{errorText(returns.error)}</p>
      ) : standing.length === 0 ? (
        <p>
          Цей магазин нічого не повертав постачальнику «{invoice.supplier.name}
          ».
        </p>
      ) : (
        <label>
          Повернення
          <select
            value={chosen}
            onChange={(event) => {
              setChosen(event.target.value);
            }}
          >
            <option value="">Оберіть повернення</option>
            {standing.map((item) => {
              const counted = item.set_offs.reduce(
                (sum, setOff) => sum + (kopecks(setOff.amount) ?? 0n),
                0n,
              );
              return (
                <option key={item.id} value={item.id}>
                  {when(item.at)} ·{" "}
                  {item.lines.reduce((units, line) => units + line.quantity, 0)}{" "}
                  од.
                  {counted > 0n &&
                    ` · уже зараховано ${money(decimal(counted))}`}
                </option>
              );
            })}
          </select>
        </label>
      )}
      <label>
        Скільки зарахував постачальник, грн
        <input
          inputMode="decimal"
          placeholder="0,00"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </label>
      {problem && <p role="alert">{problem}</p>}
      <div className="actions">
        <button type="button" onClick={submit}>
          Зарахувати
        </button>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            setOpen(false);
          }}
        >
          Скасувати
        </button>
      </div>
    </fieldset>
  );
}

function EntryRow({
  store,
  token,
  invoice,
  entry,
  cancellable,
  disabled,
  changed,
}: {
  store: Store;
  token: string;
  invoice: Invoice;
  entry: InvoiceEntry;
  cancellable: boolean;
  disabled: boolean;
  changed: (invoice: Invoice) => void;
}): JSX.Element {
  const elsewhere = invoice.store_id !== store.id;
  return (
    <li>
      {when(entry.at)} · {entryLabels[entry.kind]} {money(entry.amount)} ·{" "}
      {entry.by}
      {entry.paid_at && ` · сплатив магазин «${entry.paid_at}»`}
      {entry.note && ` · ${entry.note}`}
      {entry.cancelled ? (
        <p className="badge">
          Скасовано {when(entry.cancelled.at)} · {entry.cancelled.reason} ·{" "}
          {entry.cancelled.by}
        </p>
      ) : (
        cancellable && (
          <Reasoned
            label={`Скасувати: ${entryLabels[entry.kind].toLowerCase()} ${money(entry.amount)}`}
            question={`${entryLabels[entry.kind]} ${money(entry.amount)} записано помилково? Борг зросте на цю суму.`}
            confirm="Так, скасувати"
            disabled={disabled}
            run={(why) =>
              api<Invoice>(
                `/supplier-invoices/${invoice.id}/entries/${entry.id}/cancel`,
                token,
                {
                  reason: why,
                  // A payment made here for a store that does not trade.
                  ...(elsewhere ? { store_id: store.id } : {}),
                },
              )
            }
            changed={changed}
          />
        )
      )}
    </li>
  );
}

/** A cancellation, saying why. Pressed twice, it is answered as it is. */
function Reasoned({
  label,
  question,
  confirm,
  disabled,
  run,
  changed,
}: {
  label: string;
  question: string;
  confirm: string;
  disabled: boolean;
  run: (reason: string) => Promise<Invoice>;
  changed: (invoice: Invoice) => void;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function undo(): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      const invoice = await run(reason.trim());
      setAsking(false);
      setReason("");
      changed(invoice);
    } catch (error) {
      setProblem(
        error instanceof ApiError
          ? refusalText(error)
          : "Немає відповіді сервера. Натисніть ще раз — повторне натискання безпечне.",
      );
    } finally {
      setBusy(false);
    }
  }

  return asking ? (
    <div className="notice">
      <p>{question}</p>
      <label>
        Чому скасовуємо
        <textarea
          value={reason}
          maxLength={1000}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </label>
      <div className="actions">
        <button
          disabled={disabled || busy || reason.trim() === ""}
          onClick={() => {
            void undo();
          }}
        >
          {confirm}
        </button>
        <button
          className="quiet"
          onClick={() => {
            setAsking(false);
          }}
        >
          Не скасовувати
        </button>
      </div>
      {problem && <p role="alert">{problem}</p>}
    </div>
  ) : (
    <button
      className="quiet"
      disabled={disabled}
      onClick={() => {
        setProblem(null);
        setAsking(true);
      }}
    >
      {label}
    </button>
  );
}

const statusLabels: Record<InvoiceStatus, string> = {
  OPEN: "Винні",
  SETTLED: "Сплачено повністю",
  WRITTEN_OFF: "Залишок списано",
  CANCELLED: "Скасовано",
};

const entryLabels: Record<InvoiceEntry["kind"], string> = {
  PAYMENT: "Оплата",
  SET_OFF: "Залік за повернення",
  WRITE_OFF: "Списано",
};

function doneText(invoice: Invoice, command: Command): string {
  const rest =
    invoice.status === "SETTLED"
      ? "Накладну сплачено повністю."
      : `Залишок ${money(invoice.owed)}.`;
  switch (command.kind) {
    case "invoice":
      return `Накладну «${invoice.supplier.name}» на ${money(invoice.amount)} записано. ${rest}`;
    case "payment":
      return `Оплату ${money(command.amount)} записано. ${rest}`;
    case "set-off":
      return `Залік ${money(command.amount)} записано. ${rest}`;
    case "write-off":
      return `Списано ${money(invoice.written_off)}.`;
    case "sold":
      return `Продано з позиченого: ${invoice.sold?.label ?? ""} × ${String(command.quantity)}. Борг «${invoice.supplier.name}» ${money(invoice.amount)} — у «Накладних».`;
  }
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function refusalText(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.details.reason) {
      case "MORE_THAN_OWED":
        return `Це більше, ніж винні: залишок ${money(String(error.details.owed))}.`;
      case "NOT_OWED":
        return "За цією накладною вже нічого не винні.";
      case "NO_REASON":
        return "Вкажіть, чому.";
      case "PAID_WHERE_OWED":
        return "Магазин, чия це накладна, знову працює — сплачує він.";
      case "OTHER_SUPPLIER":
        return "Це повернення іншому постачальнику.";
      case "RETURN_CANCELLED":
        return "Це повернення скасовано: товар повернувся на склад.";
      case "ENTRIES_STAND":
        return "Спершу скасуйте оплати й заліки цієї накладної.";
      case "WRITTEN_OFF":
        return "Списане лишається списаним.";
    }
  }
  return errorText(error);
}
