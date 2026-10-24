import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ComponentProps, JSX } from "react";
import { flushSync } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorText } from "@/shared/api";
import { isTillMethod, methodHow, methodLabels } from "@/shared/payment";
import type { PaymentMethod, TillMethod } from "@/shared/payment";
import { keptText, useAutoCheck } from "@/shared/reach";
import { setScreen } from "@/shared/report";
import { visible } from "@/shared/visible";
import { Placeholder } from "@/shared/Placeholder";
import {
  buzz,
  connectTelegram,
  telegramInitData,
  telegramUserId,
} from "@/shared/telegram";
import { loadPending, submitPending, useCommand } from "@/orders/commands";
import type { Pending } from "@/orders/commands";
import {
  DestinationFields,
  OrderDetail,
  actionLabels,
  stepDone,
} from "@/orders/Order";
import { chargeOnce } from "@/orders/Collected";
import { Orders, freshOrdersView } from "@/orders/Orders";
import type { OrdersView } from "@/orders/Orders";
import { asShown, decimal, kopecks, money, stateText } from "@/orders/types";
import type {
  Me,
  Store,
  Location,
  StockOption,
  Line,
  Order,
  Carrier,
  Destination,
} from "@/orders/types";
import { Stock } from "@/inventory/Stock";
import { Catalog } from "@/catalog/Catalog";
import { loadCatalogCommand, useCatalogCommand } from "@/catalog/commands";
import { Sale } from "@/sales/Sale";
import {
  attemptSum,
  loadSale,
  resolve,
  useSaleCommand,
} from "@/sales/commands";
import type { SaleAttempt } from "@/sales/commands";
import { clearPaper } from "@/sales/paper";
import type { PaperView } from "@/sales/paperMark";
import { markText, paidDuringOutage } from "@/sales/types";
import { Receive } from "@/inventory/Receive";
import {
  loadReceipt,
  resolveReceipt,
  useReceiptCommand,
} from "@/inventory/receiptCommands";
import {
  loadAdjustment,
  resolveAdjustment,
  useAdjustmentCommand,
} from "@/inventory/adjustmentCommands";
import type { Adjustment } from "@/inventory/adjustmentTypes";
import {
  loadCount,
  resolveCount,
  useCountCommand,
} from "@/inventory/stocktakeCommands";
import type { CountResult } from "@/inventory/stocktakeTypes";
import { countErrorText } from "@/inventory/Stocktake";
import { Backups, useBackups } from "@/backups/Backups";
import { Returns } from "@/returns/Returns";
import { Result as ReturnResult, keptReturnText } from "@/returns/Result";
import type { Refund, ReturnPart } from "@/returns/types";
import { Credits } from "@/credits/Credits";
import {
  loadCreditCommand,
  resolveCreditCommand,
  useCreditCommand,
} from "@/credits/commands";
import { erasedCustomer } from "@/credits/types";
import type { Credit, CreditBody } from "@/credits/types";
import { Paid } from "@/credits/Paid";
import { Damaged } from "@/damaged/Damaged";
import { Openings } from "@/openings/Openings";
import { Stores } from "@/stores/Stores";
import { Invoices } from "@/suppliers/Invoices";
import { Models } from "@/catalog/Models";
import {
  loadCorrectionCommand,
  useCorrectionCommand,
} from "@/catalog/modelCommands";
import { SalesReport } from "@/reports/SalesReport";
import {
  loadInvoiceCommand,
  useInvoiceCommand,
} from "@/suppliers/invoiceCommands";
import { Suppliers } from "@/suppliers/Suppliers";
import {
  loadReturnToSupplier,
  useReturnToSupplier,
} from "@/suppliers/commands";
import { loadStateCommand, useStateCommand } from "@/stores/commands";
import {
  loadReturn,
  resolveReturn,
  useReturnCommand,
} from "@/returns/commands";
import type { Sale as SaleReceipt } from "@/sales/types";
import { Cash, useDrawer } from "@/cash/Cash";
import type { FixTarget } from "@/cash/Cash";
import { loadCashCommand, useCashCommand } from "@/cash/commands";
import {
  adjustmentErrorText,
  creditErrorText,
  orderErrorText,
  receiptErrorText,
  returnErrorText,
  saleErrorText,
} from "@/cash/errors";
import "./styles.css";

type Tab =
  | "list"
  | "new"
  | "catalog"
  | "stock"
  | "sale"
  | "receive"
  | "returns"
  | "damaged"
  | "openings"
  | "credits"
  | "backups"
  | "stores"
  | "suppliers"
  | "invoices"
  | "report"
  | "models"
  | "cash";

/**
 * The counter's work (redesign P1-6): these sections stand in the row,
 * each for whoever may do it; every other is under «Ще».
 */
const counter: ReadonlySet<Tab> = new Set([
  "sale",
  "returns",
  "credits",
  "cash",
]);

/**
 * The workspace's one line (redesign P1-6): the store and who works in it,
 * and «Змінити магазин» for whoever has two or more stores. The app's name
 * stands on the screens before a store opens, and in the title.
 */
function StoreLine({
  store,
  person,
  changeStore,
  blocked = false,
}: {
  store: string;
  person: string;
  changeStore: (() => void) | undefined;
  blocked?: boolean;
}): JSX.Element {
  return (
    <header className="store-line">
      <h1>
        {visible(store)}
        <span> · {visible(person)}</span>
      </h1>
      {changeStore && (
        <button className="quiet" disabled={blocked} onClick={changeStore}>
          Змінити магазин
        </button>
      )}
    </header>
  );
}

/**
 * Signs in with the launch data Telegram signed, once. The token it gives is
 * what every later request carries: a seller stays signed in for 12 hours
 * after opening the app (owner decision, 2026-10-03). The launch data itself
 * is taken for an hour only, so sending it again later would end a session
 * that still has hours to run.
 */
async function signIn(): Promise<string> {
  const initData = telegramInitData();
  if (!initData) throw new Error("TELEGRAM_REQUIRED");
  const auth = await api<{ access_token: string }>(
    "/auth/telegram",
    undefined,
    { init_data: initData },
  );
  return auth.access_token;
}
/**
 * Someone the shop has not added yet (redesign P1-3). People are added on
 * the server, by their Telegram ID, on the owner's word (owner decision,
 * 2026-10-01); the ID is often taken for a phone number, so it says it is
 * not, and is copied with one tap where the phone lets the app copy, or
 * selected whole where it does not.
 */
function NoAccess({ readAgain }: { readAgain: () => void }): JSX.Element {
  const id = telegramUserId();
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  // Absent outside a secure page, whatever the types say.
  const clipboard = (navigator as { clipboard?: Partial<Clipboard> }).clipboard;
  const write = clipboard?.writeText?.bind(clipboard);
  const copy =
    id !== null && write !== undefined
      ? () => {
          try {
            write(String(id)).then(
              () => {
                setCopied("yes");
              },
              () => {
                setCopied("no");
              },
            );
          } catch {
            setCopied("no");
          }
        }
      : null;
  return (
    <main>
      <h1>Бірка</h1>
      <h2>Доступу ще немає</h2>
      <p role="alert">
        Цей акаунт Telegram не має доступу до жодного магазину.
      </p>
      {id !== null ? (
        <p>
          Ваш Telegram ID: <strong className="telegram-id">{id}</strong> — це не
          номер телефону. Надішліть його власнику магазину. Коли вас додадуть,
          закрийте застосунок і відкрийте його знову кнопкою в боті.
        </p>
      ) : (
        <p>
          Не вдалося прочитати ваш Telegram ID. Відкрийте застосунок кнопкою в
          боті вашого магазину.
        </p>
      )}
      {copy && (
        <button className="quiet" onClick={copy}>
          Скопіювати ID
        </button>
      )}
      {/* Present from the start, so a reader hears it filled. */}
      <p role="status">
        {copied === "yes"
          ? "ID скопійовано."
          : copied === "no"
            ? "Не вдалося скопіювати — виділіть ID і скопіюйте його."
            : ""}
      </p>
      <button onClick={readAgain}>Спробувати ще раз</button>
    </main>
  );
}

export function App(): JSX.Element {
  useEffect(connectTelegram, []);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: signIn,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const token = session.data;
  // Who this person is, and what each store lets them do: read with the
  // token, and read again whenever that may have changed.
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/me", token),
    enabled: token !== undefined,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const [storeId, setStoreId] = useState("");
  /**
   * Read again what the app knows of this person. Once there is a token, that
   * is /me with it. The launch data is sent again only while there is no
   * token yet — the sign-in failed, or found no access. A token the server no
   * longer takes is never replaced by it: the administrator may have ended
   * this person's sign-ins (owner decision, 2026-10-03). A new launch from
   * Telegram signs them in again, and so does reloading the page within its
   * launch data's hour; ending the lost phone's Telegram session stops both.
   */
  function readAgain(): void {
    void (token === undefined ? session.refetch() : me.refetch());
  }
  const failure = session.error ?? me.error;
  // Named while drawn, before anything below can throw: a note of a broken
  // screen says which. A store's own screens name themselves.
  setScreen(me.data === undefined ? "sign-in" : "store-choice");
  if (failure instanceof ApiError && failure.code === "NO_ACCESS")
    return <NoAccess readAgain={readAgain} />;
  if (failure)
    return (
      <main>
        <h1>Бірка</h1>
        <h2>Вхід через Telegram</h2>
        <p role="alert">
          {failure.message === "TELEGRAM_REQUIRED"
            ? "Відкрийте застосунок кнопкою в Telegram-боті вашого магазину."
            : token === undefined &&
                failure instanceof ApiError &&
                failure.status === 401
              ? // Launch data refused — taken for an hour only, or not
                // signed by the shop's bot — is answered by opening the app
                // from the bot again, which also finds any command kept
                // from an earlier opening (redesign P1-3).
                "Відкрийте застосунок знову кнопкою в боті вашого магазину."
              : errorText(failure)}
        </p>
        <button onClick={readAgain}>Спробувати ще раз</button>
      </main>
    );
  if (token === undefined || me.data === undefined)
    return (
      <main>
        <h1>Бірка</h1>
        <Placeholder said="Входимо в магазин…" field />
      </main>
    );
  // One store needs no choice: the app opens on it (redesign, P0-1). With
  // two or more, the person chooses each time, nothing chosen beforehand: a
  // sale is written to the store chosen (owner decision, 2026-10-14).
  const chosen = me.data.stores.find((s) => s.id === storeId);
  const only = me.data.stores.length === 1 ? me.data.stores[0] : undefined;
  const store = chosen ?? only;
  const changeStore =
    only === undefined
      ? () => {
          setStoreId("");
        }
      : undefined;
  return (
    <main>
      {!store ? (
        <header>
          <h1>Бірка</h1>
          <span>{visible(me.data.display_name)}</span>
        </header>
      ) : (
        store.state !== "ACTIVE" &&
        store.permissions.length === 0 && (
          <StoreLine
            store={store.name}
            person={me.data.display_name}
            changeStore={changeStore}
          />
        )
      )}
      {!store ? (
        <section>
          <h2>Оберіть магазин</h2>
          <p>Продажі запишуться на той магазин, у якому ви зараз.</p>
          {me.data.stores.length === 0 ? (
            <p>Доступних магазинів немає. Зверніться до адміністратора.</p>
          ) : (
            me.data.stores.map((s) => (
              <button
                className="store"
                key={s.id}
                onClick={() => {
                  setStoreId(s.id);
                }}
              >
                {visible(s.name)}
                <small>{visible(s.code)}</small>
                {s.state !== "ACTIVE" && <small>{stateText(s)}</small>}
              </button>
            ))
          )}
        </section>
      ) : store.state !== "ACTIVE" && store.permissions.length === 0 ? (
        // Its own people learn the state and since when, never why (owner
        // decision, 2026-10-01).
        <section>
          <h2>{stateText(store)}</h2>
          <p role="alert">
            Роботу в цьому магазині зупинено: продажі, приймання, повернення й
            оплати в ньому не проводяться. Зверніться до власника.
          </p>
          <button onClick={readAgain}>Оновити</button>
        </section>
      ) : (
        <Workspace
          key={store.id}
          store={asShown(store)}
          token={token}
          me={me.data}
          changeStore={changeStore}
          storesChanged={readAgain}
        />
      )}
    </main>
  );
}
function Workspace({
  store,
  token,
  me,
  changeStore,
  storesChanged,
}: {
  store: Store;
  token: string;
  me: Me;
  /** Absent when the person has one store: there is nothing to change to. */
  changeStore: (() => void) | undefined;
  /** The owner changed a store's state: what the app knows is read again. */
  storesChanged: () => void;
}): JSX.Element {
  const cache = useQueryClient();
  // Journals whose attempt was read from the phone's storage when this store
  // opened: each is checked once by itself (ADR-0013 §4.3, Trigger 2).
  const [fromDisk, setFromDisk] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const loadedFromDisk = useCallback((journal: string) => {
    setFromDisk((known) =>
      known.has(journal) ? known : new Set([...known, journal]),
    );
  }, []);
  // A series of paper sales is this store's: another store, or leaving,
  // ends it (ADR-0013 §7).
  useEffect(() => clearPaper, []);
  const [tab, setTab] = useState<Tab>(
    // The till first, for whoever sells there (redesign, P0-1): the book is
    // opened at the page of the day's work. Kept operations still turn to
    // their own tab, below.
    store.state === "ACTIVE" && store.permissions.includes("sale:create")
      ? "sale"
      : "list",
  );
  // «Ще» is open on the section it was opened on (redesign P1-6): the app
  // turning to another by itself closes it, and a section chosen forgets it,
  // so coming back to that section does not open it again (review,
  // 2026-10-16).
  const [moreAt, setMoreAt] = useState<Tab | null>(null);
  const moreId = useId();
  const moreButton = useRef<HTMLButtonElement>(null);
  // A store that does not trade is read, and nothing else is done in it
  // (owner decisions, 2026-10-01). `store` already shows only what reads.
  const trading = store.state === "ACTIVE";
  // Blocking, archiving and reopening a store: the network's owner only.
  const canManageStores = me.organization_permissions.includes("store:manage");
  const storesKey = `birka:store-state-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [storesStorageError, setStoresStorageError] = useState(false);
  const stateCommand = useStateCommand();
  // Goods back to a supplier: the owner's and managers' (owner decision,
  // 2026-10-01).
  const canReturnToSupplier = store.permissions.includes("supplier:return");
  const supplierKey = `birka:supplier-return-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [supplierStorageError, setSupplierStorageError] = useState(false);
  const supplierCommand = useReturnToSupplier();
  useEffect(() => {
    if (!canReturnToSupplier) return;
    try {
      const saved = loadReturnToSupplier(supplierKey);
      useReturnToSupplier.setState({
        pending: saved,
        error: null,
        // Its own count, kept beside it (owner decision, 2026-10-21).
        misses: saved?.misses ?? 0,
      });
      if (saved) setTab("suppliers");
    } catch {
      setSupplierStorageError(true);
    }
  }, [supplierKey, canReturnToSupplier]);
  // The sales report: the owner's and managers' (owner decisions,
  // 2026-10-02). It reads every store they hold it in, whichever is open.
  const canSeeReport = store.permissions.includes("report:view_financial");
  const reportKey = `${me.organization_id}:${me.user_id}`;
  // Correcting the catalogue: the owner's and managers' (owner decision,
  // 2026-10-03). Whether this person may merge, which needs the right in
  // every store, the server says on each model's card.
  const canCorrect = store.permissions.includes("catalog:merge");
  const correctionKey = `birka:catalog-correction-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [correctionStorageError, setCorrectionStorageError] = useState(false);
  const correctionCommand = useCorrectionCommand();
  useEffect(() => {
    if (!canCorrect) return;
    try {
      const saved = loadCorrectionCommand(correctionKey);
      useCorrectionCommand.setState({
        pending: saved,
        error: null,
        // Its own count, kept beside it (owner decision, 2026-10-21).
        misses: saved?.misses ?? 0,
      });
      if (saved) setTab("models");
    } catch {
      setCorrectionStorageError(true);
    }
  }, [correctionKey, canCorrect]);
  // What the store owes its suppliers: the owner's and managers' (owner
  // decision, 2026-10-01); a seller never sees it.
  const canSeeInvoices = store.permissions.includes("supplier:debt");
  const invoiceKey = `birka:supplier-invoice-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [invoiceStorageError, setInvoiceStorageError] = useState(false);
  const invoiceCommand = useInvoiceCommand();
  useEffect(() => {
    if (!canSeeInvoices) return;
    try {
      const saved = loadInvoiceCommand(invoiceKey);
      useInvoiceCommand.setState({
        pending: saved,
        error: null,
        // Its own count, kept beside it (owner decision, 2026-10-21).
        misses: saved?.misses ?? 0,
      });
      if (saved) setTab("invoices");
    } catch {
      setInvoiceStorageError(true);
    }
  }, [invoiceKey, canSeeInvoices]);
  useEffect(() => {
    if (!canManageStores) return;
    try {
      const saved = loadStateCommand(storesKey);
      useStateCommand.setState({
        pending: saved,
        error: null,
        // Its own count, kept beside it (owner decision, 2026-10-21).
        misses: saved?.misses ?? 0,
      });
      if (saved) setTab("stores");
    } catch {
      setStoresStorageError(true);
    }
  }, [storesKey, canManageStores]);
  // The owner's section. A backup is of the whole server, so only a grant
  // held organization-wide opens it, never one for a store.
  const canSeeBackups = me.organization_permissions.includes("backup:view");
  // Existing stock, entered as a list: whoever imports lists or approves them.
  const canSeeOpenings =
    store.permissions.includes("snapshot:import") ||
    store.permissions.includes("snapshot:approve");
  const backupsKey = `${me.organization_id}:${me.user_id}`;
  const backups = useBackups(token, backupsKey, canSeeBackups);
  // Trouble on the server is shown here as the backups are (owner decision,
  // 2026-10-03).
  const backupsNeedYou =
    backups.data !== undefined &&
    (backups.data.state !== "OK" ||
      (backups.data.server?.open.length ?? 0) > 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // «Замовлення» as it was left: what was typed, the closed shown (review,
  // 2026-10-23); afresh when «Замовлення» is chosen again.
  const [ordersView, setOrdersView] = useState<OrdersView>(freshOrdersView);
  const [storageError, setStorageError] = useState(false);
  const key = `birka:pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const catalogKey = `birka:catalog-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const saleKey = `birka:sale-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [catalogStorageError, setCatalogStorageError] = useState(false);
  const [saleStorageError, setSaleStorageError] = useState(false);
  const receiptKey = `birka:receipt-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [receiptStorageError, setReceiptStorageError] = useState(false);
  const receiptCommand = useReceiptCommand();
  useEffect(() => {
    try {
      const saved = loadReceipt(receiptKey);
      useReceiptCommand.setState({
        pending: saved,
        error: null,
        // Its own count, kept beside it (owner decision, 2026-10-21).
        misses: saved?.misses ?? 0,
      });
      if (saved) {
        setTab("receive");
        loadedFromDisk("receipt");
      }
    } catch {
      setReceiptStorageError(true);
    }
  }, [receiptKey, loadedFromDisk]);
  const adjustmentKey = `birka:adjustment-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [adjustmentStorageError, setAdjustmentStorageError] = useState(false);
  const [adjustmentSettled, setAdjustmentSettled] = useState<Adjustment | null>(
    null,
  );
  const adjustmentCommand = useAdjustmentCommand();
  useEffect(() => {
    try {
      const saved = loadAdjustment(adjustmentKey);
      useAdjustmentCommand.setState({
        pending: saved,
        error: null,
        // Its own count, kept beside it (owner decision, 2026-10-21).
        misses: saved?.misses ?? 0,
      });
      if (saved) {
        setTab("stock");
        loadedFromDisk("adjustment");
      }
    } catch {
      setAdjustmentStorageError(true);
    }
  }, [adjustmentKey, loadedFromDisk]);
  // A stocktake's count (ADR-0022): the stock screen's own, as a correction.
  const countKey = `birka:stocktake-count-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [countStorageError, setCountStorageError] = useState(false);
  const [countSettled, setCountSettled] = useState<CountResult | null>(null);
  const countCommand = useCountCommand();
  useEffect(() => {
    try {
      const saved = loadCount(countKey);
      useCountCommand.setState({
        pending: saved,
        error: null,
        // Its own count, kept beside it (owner decision, 2026-10-21).
        misses: saved?.misses ?? 0,
      });
      if (saved) {
        setTab("stock");
        loadedFromDisk("count");
      }
    } catch {
      setCountStorageError(true);
    }
  }, [countKey, loadedFromDisk]);
  const returnKey = `birka:return-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [returnStorageError, setReturnStorageError] = useState(false);
  const returnCommand = useReturnCommand();
  // A return is looked up in the store's sales, so it needs both.
  const canReturn =
    store.permissions.includes("sale:refund") &&
    store.permissions.includes("sale:view");
  // Read, not watched: a right changed later (a store blocked and opened
  // again) loads nothing again, nor wipes what is said (review, 2026-10-18).
  const canReturnNow = useRef(canReturn);
  canReturnNow.current = canReturn;
  useEffect(() => {
    try {
      const saved = loadReturn(returnKey);
      useReturnCommand.setState({
        pending: saved,
        error: null,
        // Its own count, kept beside it (owner decision, 2026-10-21).
        misses: saved?.misses ?? 0,
      });
      if (saved) {
        // Its banner shows over any tab; «Повернення» is turned to only for
        // whoever may take returns, never to say they may not (returns task
        // list, P2-1).
        if (canReturnNow.current) setTab("returns");
        loadedFromDisk("return");
      }
    } catch {
      setReturnStorageError(true);
    }
  }, [returnKey, loadedFromDisk]);
  // A return whose outcome was unknown, settled: what to give back, unless
  // it was given back while the server did not answer; and the lines its
  // attempt sent, which say where the seller put intact goods.
  const [returnSettled, setReturnSettled] = useState<{
    refund: Refund;
    sent: ReturnPart[];
  } | null>(null);
  // «Повернення» is mounted afresh once a kept return settles, as the till is
  // after a kept sale: its form would otherwise keep that return's command,
  // and pressed again would answer it once more without saying it may have
  // been paid out already.
  const [returnsEpoch, setReturnsEpoch] = useState(0);
  // A sale whose receipt offered its own return: «Повернення» opens on it
  // (redesign P1-2).
  const [returnOf, setReturnOf] = useState<string | null>(null);
  const returnOpened = useCallback(() => {
    setReturnOf(null);
  }, []);
  // Left before «Повернення» opened it: never opened later, for another
  // customer (review, 2026-10-15).
  useEffect(() => {
    if (tab !== "returns") setReturnOf(null);
  }, [tab]);
  // «Новий продаж» on a return's result opens the till with its cursor in
  // the search (returns task list, P0-5). The till takes it as it mounts,
  // once: the next tab change clears it, so neither the till opened any
  // other way nor one mounted afresh on that visit takes the cursor
  // (review, 2026-10-17).
  const [searchFirst, setSearchFirst] = useState(false);
  useEffect(() => {
    setSearchFirst(false);
  }, [tab]);
  // Sales paid in parts: whoever sells that way takes the payments.
  const canSeeCredits = store.permissions.includes("sale:credit");
  // Read, not watched, as `canReturnNow` (credits task list, P2-1).
  const canSeeCreditsNow = useRef(canSeeCredits);
  canSeeCreditsNow.current = canSeeCredits;
  const creditKey = `birka:credit-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [creditStorageError, setCreditStorageError] = useState(false);
  const creditCommand = useCreditCommand();
  // A payment or write-off whose outcome was unknown, settled; a payment
  // with its sum and way as sent, so a card is still charged on the
  // terminal — never the debt's paid in all in its place.
  const [creditSettled, setCreditSettled] = useState<
    | {
        kind: "payment";
        credit: Credit;
        amount: string;
        way: PaymentMethod | null;
        // Typed from paper: the card was charged during the outage
        // (ADR-0021), or before the app, from the first days' paper (owner,
        // 2026-10-16); the mark as sent, its taker by id alone.
        paper: PaperView | null;
      }
    | { kind: "write-off"; credit: Credit }
    | null
  >(null);
  // Which command a resent attempt refused as recording nothing was, and
  // how a payment was pressed: what to give back says it (ADR-0013 §8).
  const [creditRefused, setCreditRefused] = useState<{
    kind: "payment" | "write-off";
    way: TillMethod | null;
  }>({ kind: "payment", way: null });
  // Bumped to remount «Борги» once such a command settles, so no screen
  // keeps showing the debt as it was before it.
  const [creditEpoch, setCreditEpoch] = useState(0);
  useEffect(() => {
    try {
      const saved = loadCreditCommand(creditKey);
      useCreditCommand.setState({
        pending: saved,
        error: null,
        // Its own count, kept beside it (owner decision, 2026-10-21).
        misses: saved?.misses ?? 0,
      });
      if (saved) {
        // Its banner shows over any tab; «Борги» is turned to only for
        // whoever may take payments, never to say they may not (credits
        // task list, P2-1).
        if (canSeeCreditsNow.current) setTab("credits");
        loadedFromDisk("credit");
      }
    } catch {
      setCreditStorageError(true);
    }
  }, [creditKey, loadedFromDisk]);
  // The drawer (owner decisions, 2026-10-04; ADR-0012, B12): whoever closes
  // it or takes cash out for expenses, and the owner and managers, who read
  // the closes. In a store that does not trade only the network's owner,
  // who may still count and close its day (B9): the store's own grants give
  // nothing there, so it is read from what they hold network-wide.
  const canSeeCash = trading
    ? ["cash:close", "cash:expense", "report:view_financial"].some(
        (permission) => store.permissions.includes(permission),
      )
    : me.organization_permissions.includes("store:manage") &&
      me.organization_permissions.includes("cash:close");
  const cashKey = `birka:cash-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [cashStorageError, setCashStorageError] = useState(false);
  const cashCommand = useCashCommand();
  useEffect(() => {
    if (!canSeeCash) return;
    try {
      const saved = loadCashCommand(cashKey);
      useCashCommand.setState({
        pending: saved,
        error: null,
        // Its own count, kept beside it (owner decision, 2026-10-21).
        misses: saved?.misses ?? 0,
      });
      if (saved) setTab("cash");
    } catch {
      // The journal outlives the store: another store's refusal must not
      // show in this one's «Каса», whose own kept command cannot be read.
      useCashCommand.setState({ error: null });
      setCashStorageError(true);
    }
  }, [cashKey, canSeeCash]);
  // Until whoever counted writes the reason for their close's difference,
  // only «Каса» stays open on their phone (owner decision, 2026-10-04; G12).
  // Read from the server, so a reload or a dead battery does not lose it.
  const drawer = useDrawer(store.id, token, canSeeCash);
  const reasonOwed = (drawer.data?.reason_owed ?? null) !== null;
  useEffect(() => {
    if (reasonOwed) setTab("cash");
  }, [reasonOwed]);
  // The receipt's «Змінити спосіб оплати»: «Каса» opens on that sale. A
  // wrong way pressed — a card the terminal refused, say — is fixed from
  // the receipt before the close (owner decision, 2026-10-04; ADR-0012,
  // B6.4). Offered only to whoever opens «Каса».
  const [cashFix, setCashFix] = useState<FixTarget | null>(null);
  const fixSeen = useCallback(() => {
    setCashFix(null);
  }, []);
  const fixFromReceipt: Pick<
    ComponentProps<typeof Sale>,
    "fixMethod"
  > = canSeeCash
    ? {
        fixMethod: (sale) => {
          setCashFix({ target: "SALE", id: sale.id });
          setTab("cash");
        },
      }
    : {};
  const catalogCommand = useCatalogCommand();
  const saleCommand = useSaleCommand();
  const [settled, setSettled] = useState<SaleReceipt | null>(null);
  // A basket that turned out to have been recorded as an empty shelf.
  const [shelfSettled, setShelfSettled] = useState(false);
  // Bumped to remount the till after a settled sale, so its basket and its
  // `command_id` do not survive an operation that turned out to be complete.
  const [saleEpoch, setSaleEpoch] = useState(0);
  useEffect(() => {
    try {
      const saved = loadSale(saleKey);
      useSaleCommand.setState({
        pending: saved,
        error: null,
        // Its own count, kept beside it (owner decision, 2026-10-21).
        misses: saved?.misses ?? 0,
      });
      if (saved) {
        setTab("sale");
        loadedFromDisk("sale");
      }
    } catch {
      setSaleStorageError(true);
    }
  }, [saleKey, loadedFromDisk]);
  useEffect(() => {
    try {
      const saved = loadCatalogCommand(catalogKey);
      useCatalogCommand.setState({ pending: saved, error: null });
      if (saved) setTab("catalog");
    } catch {
      setCatalogStorageError(true);
    }
  }, [catalogKey]);
  const { pending, busy, error, misses: orderMisses } = useCommand();
  useEffect(() => {
    try {
      const saved = loadPending(key);
      useCommand.getState().set(saved);
      if (saved) {
        // Its own tab, as every kept operation: the till opens first now.
        setTab("list");
        loadedFromDisk("orders");
      }
    } catch {
      setStorageError(true);
    }
  }, [key, loadedFromDisk]);
  const detail = useQuery({
    queryKey: ["order", store.id, selectedId],
    queryFn: () => api<Order>(`/orders/${selectedId ?? ""}`, token),
    enabled: selectedId !== null,
  });
  // The order command last sent, when it was a saved one resent: refused
  // for want of a way, it was an old «Клієнт забрав» (ADR-0012, B12), and
  // refused as having recorded nothing, it says which (ADR-0013 §1).
  const [orderResent, setOrderResent] = useState<string | null>(null);
  // What a step did, said on the order it was taken on (orders task list,
  // P0-2, P0-4): sent, arrived, cancelled.
  const [orderDone, setOrderDone] = useState<{
    id: string;
    text: string;
  } | null>(null);
  // The order «Клієнт забрав» was just recorded on: its sale said large
  // (orders task list, P0-3) — kept and confirmed later, said so.
  const [collected, setCollected] = useState<{
    id: string;
    kept: boolean;
  } | null>(null);
  // An order's step refused: why, at the screen's top, brought to the
  // finger from where it was pressed (review, 2026-10-23; orders task
  // list, P0-2).
  const orderAlert = useRef<HTMLParagraphElement>(null);
  const [stepRefused, setStepRefused] = useState(0);
  useEffect(() => {
    if (stepRefused > 0) orderAlert.current?.focus();
  }, [stepRefused]);
  async function run(command: Pending, resent = false): Promise<void> {
    setOrderResent(resent ? command.label : null);
    setOrderDone(null);
    setCollected(null);
    const order = await submitPending(key, token, command);
    const settled = useCommand.getState();
    // A step on an order, by its path's last word: «dispatch», «cancel».
    const step = command.orderId ? (command.path.split("/").at(-1) ?? "") : "";
    if (
      !order &&
      step !== "" &&
      settled.pending === null &&
      settled.error !== null
    ) {
      // Refused, recorded nowhere: the order as it is now.
      buzz("error");
      setStepRefused((count) => count + 1);
      void cache.invalidateQueries({
        queryKey: ["order", store.id, command.orderId],
      });
    }
    if (order) {
      // Sent, arrived or cancelled: a buzz, and what it did on the order
      // (orders task list, P0-2, P0-4).
      const text = step === "" ? null : stepDone(step, order);
      if (text !== null) {
        buzz("success");
        setOrderDone({ id: order.id, text });
      }
      // Collected: a sale, said as the till says one (orders task list,
      // P0-3).
      if (step === "collect") {
        buzz("success");
        setCollected({ id: order.id, kept: resent });
      }
      cache.setQueryData(["order", store.id, order.id], order);
      setSelectedId(order.id);
      setTab("list");
      await Promise.all([
        // Read now, though the list is not shown: back on it, the order is
        // where it is now (review, 2026-10-23).
        cache.invalidateQueries({
          queryKey: ["orders", store.id],
          refetchType: "all",
        }),
        cache.invalidateQueries({ queryKey: ["stock", store.id] }),
        // Collected in parts, a debt: «Борги» read again (review,
        // 2026-10-19).
        cache.invalidateQueries({ queryKey: ["credits", store.id] }),
      ]);
    }
  }
  /*
   * Each kept operation's check: what its banner's button does, and what the
   * phone does by itself when the server is back or the app was reopened
   * (ADR-0013 §4.3). The identical attempt resent under its own key, never a
   * new command.
   */
  function checkSale(): void {
    const attempt = saleCommand.pending;
    if (!attempt) return;
    void resolve(saleKey, token, attempt).then((outcome) => {
      if (outcome.kind === "sold") {
        setSettled(outcome.sale);
        setSaleEpoch((epoch) => epoch + 1);
        setTab("sale");
      } else if (outcome.kind === "nothing-sold") {
        setShelfSettled(true);
        setSaleEpoch((epoch) => epoch + 1);
        setTab("sale");
      } else if (outcome.kind === "refused") {
        // Proven to have recorded nothing (ADR-0013 §1): the basket is
        // the seller's again, and the refusal says why and what to do.
        useSaleCommand.setState({ error: outcome.error });
        setSaleEpoch((epoch) => epoch + 1);
        setTab("sale");
      }
    });
  }
  function checkReceipt(): void {
    const attempt = receiptCommand.pending;
    if (!attempt) return;
    void resolveReceipt(receiptKey, token, attempt).then((outcome) => {
      // Proven to have recorded nothing (a model merged or retired since,
      // an opening list now waiting, the store blocked or the warehouse
      // closed while the resend ran): say it was not taken, and why. A
      // store blocked, or a warehouse closed, before the resend is refused
      // before the lookup, without `recorded: false`: the phone keeps the
      // attempt, and that store's screens wait, until it trades again or
      // the warehouse reopens (owner, 2026-10-08).
      if (outcome.kind === "refused")
        useReceiptCommand.setState({ error: outcome.error });
    });
  }
  function checkReturn(): void {
    const attempt = returnCommand.pending;
    if (!attempt) return;
    void resolveReturn(returnKey, token, attempt).then((outcome) => {
      if (outcome.kind === "done") {
        // The attempt's own lines, as the phone kept them: the form that
        // chose a warehouse is gone after a reopen.
        setReturnSettled({ refund: outcome.result, sent: attempt.body.lines });
        setReturnsEpoch((epoch) => epoch + 1);
        // What a live return reads again: the sales, debts, stock and «Брак».
        void cache.invalidateQueries({
          queryKey: ["store-sales", store.id],
        });
        void cache.invalidateQueries({
          queryKey: ["credits", store.id],
        });
        void cache.invalidateQueries({ queryKey: ["inventory-stock"] });
        void cache.invalidateQueries({
          queryKey: ["damaged-units", store.id],
        });
      } else if (outcome.kind === "refused") {
        // Proven to have recorded nothing — an attempt saved before the
        // way was asked, say: settled, and it says so rather than
        // vanishing (ADR-0012, B12).
        useReturnCommand.setState({ error: outcome.error });
        setReturnsEpoch((epoch) => epoch + 1);
      }
    });
  }
  function checkCredit(): void {
    const attempt = creditCommand.pending;
    if (!attempt) return;
    void resolveCreditCommand(creditKey, token, attempt).then((outcome) => {
      if (outcome.kind === "done") {
        const body = attempt.body;
        setCreditSettled(
          body.kind === "payment"
            ? {
                kind: "payment",
                credit: outcome.result,
                amount: body.amount,
                way: body.payment_method ?? null,
                paper: body.outage
                  ? {
                      by_user_id: body.outage.by_user_id,
                      by: null,
                      at: body.outage.at,
                      first_days: body.outage.first_days === true,
                    }
                  : null,
              }
            : { kind: "write-off", credit: outcome.result },
        );
        setCreditEpoch((epoch) => epoch + 1);
        void cache.invalidateQueries({
          queryKey: ["credits", store.id],
        });
      } else if (outcome.kind === "refused") {
        // Proven to have recorded nothing: settled, and said, with what to
        // do with money already taken. Which command it was is drawn before
        // its words: the store's error renders first, and a write-off read
        // as «Внесок не записано» for a moment, aloud (review, 2026-10-18).
        flushSync(() => {
          setCreditRefused({
            kind: attempt.body.kind,
            way:
              attempt.body.kind === "payment"
                ? (attempt.body.payment_method ?? null)
                : null,
          });
        });
        useCreditCommand.setState({ error: outcome.error });
      }
    });
  }
  function checkAdjustment(): void {
    const attempt = adjustmentCommand.pending;
    if (!attempt) return;
    void resolveAdjustment(adjustmentKey, token, attempt).then((outcome) => {
      if (outcome.kind === "done") {
        setAdjustmentSettled(outcome.result);
        void cache.invalidateQueries({
          queryKey: ["inventory-stock"],
        });
      } else if (outcome.kind === "refused") {
        // Proven to have recorded nothing — the balance moved since the
        // count, say: settled, and it says so rather than vanishing, with
        // the balances read again to count against (ADR-0013 §1).
        useAdjustmentCommand.setState({ error: outcome.error });
        void cache.invalidateQueries({
          queryKey: ["inventory-stock"],
        });
      }
    });
  }
  function checkCount(): void {
    const attempt = countCommand.pending;
    if (!attempt) return;
    void resolveCount(countKey, token, attempt).then((outcome) => {
      if (outcome.kind === "done") {
        setCountSettled(outcome.result);
      } else if (outcome.kind === "refused") {
        // Proven to have recorded nothing — the balance moved since the
        // count, or the stocktake was finished: settled, and it says so,
        // with the positions read again (ADR-0013 §1).
        useCountCommand.setState({ error: outcome.error });
      }
      if (outcome.kind !== "unknown") {
        void cache.invalidateQueries({ queryKey: ["stocktake"] });
        void cache.invalidateQueries({ queryKey: ["stocktake-positions"] });
        void cache.invalidateQueries({ queryKey: ["stocktakes"] });
        void cache.invalidateQueries({ queryKey: ["inventory-stock"] });
      }
    });
  }
  function checkOrder(): void {
    if (pending) void run(pending, true);
  }
  const returnUnsettled =
    returnStorageError || returnCommand.busy || returnCommand.pending !== null;
  const creditUnsettled =
    creditStorageError || creditCommand.busy || creditCommand.pending !== null;
  const storesUnsettled =
    storesStorageError || stateCommand.busy || stateCommand.pending !== null;
  const supplierUnsettled =
    supplierStorageError ||
    supplierCommand.busy ||
    supplierCommand.pending !== null;
  const invoiceUnsettled =
    invoiceStorageError ||
    invoiceCommand.busy ||
    invoiceCommand.pending !== null;
  // The drawer's journal, and a reason owed for the closer's own close:
  // either holds every tab but «Каса» (ADR-0012, B12).
  const cashUnsettled =
    cashStorageError ||
    cashCommand.busy ||
    cashCommand.pending !== null ||
    reasonOwed;
  // Every journal but the stock correction's and the store states' own,
  // which their screens read themselves.
  const correctionUnsettled =
    correctionStorageError ||
    correctionCommand.busy ||
    correctionCommand.pending !== null;
  const othersExceptCorrectionsAndCash =
    busy ||
    pending !== null ||
    storageError ||
    catalogStorageError ||
    saleStorageError ||
    catalogCommand.busy ||
    catalogCommand.pending !== null ||
    saleCommand.busy ||
    saleCommand.pending !== null ||
    receiptStorageError ||
    receiptCommand.busy ||
    receiptCommand.pending !== null ||
    returnUnsettled ||
    creditUnsettled;
  const othersExceptCorrections =
    othersExceptCorrectionsAndCash || cashUnsettled;
  const othersUnsettled = othersExceptCorrections || correctionUnsettled;
  const otherThanAdjustment =
    othersUnsettled || storesUnsettled || supplierUnsettled || invoiceUnsettled;
  // A correction and a stocktake's count are both the stock screen's: either
  // unsettled holds every other screen, and that screen holds the other.
  const adjustmentUnsettled =
    adjustmentStorageError ||
    adjustmentCommand.busy ||
    adjustmentCommand.pending !== null ||
    countStorageError ||
    countCommand.busy ||
    countCommand.pending !== null;
  const otherThanStores =
    othersUnsettled ||
    adjustmentUnsettled ||
    supplierUnsettled ||
    invoiceUnsettled;
  const otherThanSuppliers =
    othersUnsettled ||
    adjustmentUnsettled ||
    storesUnsettled ||
    invoiceUnsettled;
  const otherThanInvoices =
    othersUnsettled ||
    adjustmentUnsettled ||
    storesUnsettled ||
    supplierUnsettled;
  const otherThanCorrections =
    othersExceptCorrections ||
    adjustmentUnsettled ||
    storesUnsettled ||
    supplierUnsettled ||
    invoiceUnsettled;
  const otherThanCash =
    othersExceptCorrectionsAndCash ||
    correctionUnsettled ||
    adjustmentUnsettled ||
    storesUnsettled ||
    supplierUnsettled ||
    invoiceUnsettled;
  const blocked = otherThanAdjustment || adjustmentUnsettled;
  // The seller's kept operations, checked by themselves (G11). «Каса» and
  // the catalogue check their own, on their screens.
  useAutoCheck([
    {
      pending: saleCommand.pending !== null,
      busy: saleCommand.busy,
      loaded: fromDisk.has("sale"),
      run: checkSale,
    },
    {
      pending: receiptCommand.pending !== null,
      busy: receiptCommand.busy,
      loaded: fromDisk.has("receipt"),
      run: checkReceipt,
    },
    {
      pending: returnCommand.pending !== null,
      busy: returnCommand.busy,
      loaded: fromDisk.has("return"),
      run: checkReturn,
    },
    {
      pending: creditCommand.pending !== null,
      busy: creditCommand.busy,
      loaded: fromDisk.has("credit"),
      run: checkCredit,
    },
    {
      pending: adjustmentCommand.pending !== null,
      busy: adjustmentCommand.busy,
      loaded: fromDisk.has("adjustment"),
      run: checkAdjustment,
    },
    {
      pending: countCommand.pending !== null,
      busy: countCommand.busy,
      loaded: fromDisk.has("count"),
      run: checkCount,
    },
    {
      pending: pending !== null,
      busy,
      loaded: fromDisk.has("orders"),
      run: checkOrder,
    },
  ]);
  // A sale typed from paper and confirmed later shows the money line of
  // its receipt (ADR-0013 §5.6).
  const settledPaid =
    settled?.outage && settled.payment_method
      ? paidDuringOutage(
          settled.payment_method,
          settled.outage.first_days === true,
        )
      : null;
  // The sections (redesign P1-6), each by the same right as before: the
  // counter's work in the row, and every other under «Ще», two taps away.
  // An order left open is forgotten by the sections that always were.
  const sections: {
    tab: Tab;
    label: string;
    shown: boolean;
    disabled: boolean;
    forgetsOrder?: true;
  }[] = [
    {
      tab: "sale",
      label: "Продаж",
      shown: store.permissions.includes("sale:create"),
      disabled: blocked,
      forgetsOrder: true,
    },
    {
      tab: "returns",
      label: "Повернення",
      shown: canReturn,
      disabled: blocked,
    },
    { tab: "credits", label: "Борги", shown: canSeeCredits, disabled: blocked },
    {
      tab: "cash",
      label: "Каса",
      shown: canSeeCash,
      disabled: otherThanCash,
      forgetsOrder: true,
    },
    {
      tab: "list",
      label: "Замовлення",
      shown: true,
      disabled: blocked,
      forgetsOrder: true,
    },
    {
      tab: "new",
      label: "+ Нове замовлення",
      shown: store.permissions.includes("sale:create"),
      disabled: blocked,
      forgetsOrder: true,
    },
    {
      tab: "catalog",
      label: "Каталог",
      shown: store.permissions.includes("catalog:confirm"),
      disabled: blocked,
    },
    {
      tab: "receive",
      label: "Приймання",
      shown: store.permissions.includes("inventory:receive"),
      disabled: blocked,
    },
    {
      tab: "stock",
      label: "Залишки",
      shown: store.permissions.includes("inventory:view"),
      disabled: blocked,
    },
    {
      tab: "damaged",
      label: "Брак",
      shown: store.permissions.includes("damaged:handle"),
      disabled: blocked,
    },
    {
      tab: "openings",
      label: "Початкові залишки",
      shown: canSeeOpenings,
      disabled: blocked,
    },
    {
      tab: "backups",
      label: `Резервні копії${backupsNeedYou ? " ⚠" : ""}`,
      shown: canSeeBackups,
      disabled: blocked,
    },
    {
      tab: "suppliers",
      label: "Постачальникам",
      shown: canReturnToSupplier,
      disabled: otherThanSuppliers,
    },
    {
      tab: "invoices",
      label: "Накладні",
      shown: canSeeInvoices,
      disabled: otherThanInvoices,
    },
    {
      tab: "models",
      label: "Моделі",
      shown: canCorrect,
      disabled: otherThanCorrections,
    },
    {
      tab: "report",
      label: "Звіт",
      shown: canSeeReport,
      disabled: blocked,
    },
    {
      tab: "stores",
      label: "Магазини",
      shown: canManageStores,
      disabled: otherThanStores,
    },
  ];
  // Whatever section is open, «Ще» marks it when it is one of its own; its
  // screen's heading names it. Open, it closes once a section is chosen.
  const inMore = !counter.has(tab);
  const moreOpen = moreAt === tab;
  const sectionButton = (section: (typeof sections)[number]): JSX.Element => (
    <button
      key={section.tab}
      className={tab === section.tab ? "active" : "quiet"}
      aria-current={tab === section.tab ? "page" : undefined}
      disabled={section.disabled}
      onClick={() => {
        setTab(section.tab);
        if (section.forgetsOrder) {
          setSelectedId(null);
          setOrdersView(freshOrdersView);
        }
        // Chosen under «Ще», the button goes as «Ще» closes: the focus
        // stays on «Ще», not lost to the page (review, 2026-10-16).
        if (moreOpen && !counter.has(section.tab)) moreButton.current?.focus();
        setMoreAt(null);
      }}
    >
      {section.label}
    </button>
  );
  const shown = sections.filter((section) => section.shown);
  const rest = shown.filter((section) => !counter.has(section.tab));
  setScreen(tab);
  return (
    <>
      <StoreLine
        store={store.name}
        person={me.display_name}
        changeStore={changeStore}
        blocked={blocked}
      />
      {!trading && (
        <p className="notice" role="status">
          {stateText(store)}. Лише перегляд: продажі, приймання, повернення й
          оплати в цьому магазині зупинено.
        </p>
      )}
      <nav aria-label="Розділи" className="sections">
        <div className="row">
          {shown
            .filter((section) => counter.has(section.tab))
            .map(sectionButton)}
          <button
            ref={moreButton}
            className={inMore ? "active" : "quiet"}
            aria-current={inMore ? "true" : undefined}
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onClick={() => {
              setMoreAt(moreOpen ? null : tab);
            }}
          >
            Ще{backupsNeedYou ? " ⚠" : ""}
          </button>
        </div>
        <div id={moreId} className="more" hidden={!moreOpen}>
          {rest.map(sectionButton)}
        </div>
      </nav>
      {catalogStorageError && (
        <p role="alert">
          Не вдалося прочитати збережену операцію каталогу. Не очищайте дані
          застосунку; зверніться до менеджера.
        </p>
      )}
      {correctionStorageError && (
        <p role="alert">
          Не вдалося прочитати збережену зміну каталогу. Не очищайте дані
          застосунку; зверніться до менеджера.
        </p>
      )}
      {supplierStorageError && (
        <p role="alert">
          Не вдалося прочитати збережене повернення постачальнику. Не очищайте
          дані застосунку; зверніться до менеджера.
        </p>
      )}
      {invoiceStorageError && (
        <p role="alert">
          Не вдалося прочитати збережену операцію з накладною. Не очищайте дані
          застосунку; зверніться до власника.
        </p>
      )}
      {storesStorageError && (
        <p role="alert">
          Не вдалося прочитати збережену зміну стану магазину. Не очищайте дані
          застосунку.
        </p>
      )}
      {cashStorageError && (
        <p role="alert">
          Не вдалося прочитати збережену операцію каси. Не очищайте дані
          застосунку; зверніться до менеджера.
        </p>
      )}
      {storageError && (
        <p role="alert">
          Не вдалося прочитати збережену команду. Створення операцій зупинено.
          Зверніться до менеджера, не очищайте дані застосунку.
        </p>
      )}
      {saleStorageError && (
        <p role="alert">
          Не вдалося прочитати збережений продаж. Не очищайте дані застосунку;
          зверніться до менеджера.
        </p>
      )}
      {saleCommand.pending && (
        <section className="notice">
          <h3>
            {saleCommand.busy
              ? "Перевіряємо продаж…"
              : saleCommand.pending.emptyShelf
                ? "Запис нестачі ще не підтверджено"
                : "Продаж ще не підтверджено"}
          </h3>
          {/* Which customer it was: the attempt's own sum and way, never
              the server's total (redesign P1-4). */}
          <p>{keptSaleText(saleCommand.pending)}</p>
          <p>{keptText(saleCommand.pending.since, me.display_name)}</p>
          <button disabled={saleCommand.busy} onClick={checkSale}>
            Перевірити результат продажу
          </button>
        </section>
      )}
      {settled && (
        <section className="notice" role="status">
          <h3>Продаж записано один раз</h3>
          <SettledSale sale={settled} />
          {settled.credit && (
            <p>
              Оплата частинами: сплачено зараз {money(settled.credit.paid_now)}
              {settled.payment_method
                ? ` ${methodHow[settled.payment_method]}`
                : ""}
              {settledPaid !== null && ` — ${settledPaid}`}, покупець винен{" "}
              {money(settled.credit.owed)}.
              {settled.payment_method === "CARD" &&
                settledPaid === null &&
                ` ${chargeOnce(settled.credit.paid_now)}`}
            </p>
          )}
          <button
            onClick={() => {
              setSettled(null);
            }}
          >
            Зрозуміло
          </button>
        </section>
      )}
      {shelfSettled && (
        <section className="notice" role="status">
          <h3>Продажу не було</h3>
          <p>
            Нічого з кошика не було на полиці — нестачу записано. Повторно вона
            не запишеться.
          </p>
          <button
            onClick={() => {
              setShelfSettled(false);
            }}
          >
            Зрозуміло
          </button>
        </section>
      )}
      {saleCommand.error !== null && (
        <p role="alert">
          {saleErrorText(
            saleCommand.error,
            saleCommand.misses,
            saleCommand.pending?.acknowledged === true,
          )}
        </p>
      )}
      {receiptStorageError && (
        <p role="alert">
          Не вдалося прочитати збережене приймання. Не очищайте дані застосунку;
          зверніться до менеджера.
        </p>
      )}
      {receiptCommand.pending && (
        <section className="notice">
          <h3>
            {receiptCommand.busy
              ? "Перевіряємо приймання…"
              : "Незавершене приймання"}
          </h3>
          <p>
            Невідомо, чи записано попередню поставку. Перевірте результат — та
            сама поставка не буде прийнята двічі. Поки чекаємо, інші дії
            недоступні.
          </p>
          <p>{keptText(receiptCommand.pending.since, me.display_name)}</p>
          <button disabled={receiptCommand.busy} onClick={checkReceipt}>
            Перевірити результат приймання
          </button>
        </section>
      )}
      {receiptCommand.error !== null && (
        <p role="alert">
          {receiptErrorText(receiptCommand.error, receiptCommand.misses)}
        </p>
      )}
      {returnStorageError && (
        <p role="alert">
          Не вдалося прочитати збережене повернення. Не очищайте дані
          застосунку; зверніться до менеджера.
        </p>
      )}
      {returnCommand.pending && (
        <section className="notice">
          <h3>
            {returnCommand.busy
              ? "Перевіряємо повернення…"
              : "Повернення ще не підтверджено"}
          </h3>
          {/* Which customer it was: the goods and the sum the attempt kept
              beside its body, never the server's (returns task list, P1-2). */}
          <p>{keptReturnText(returnCommand.pending.body)}</p>
          <p>{keptText(returnCommand.pending.since, me.display_name)}</p>
          <button disabled={returnCommand.busy} onClick={checkReturn}>
            Перевірити результат повернення
          </button>
        </section>
      )}
      {returnSettled && (
        <section className="notice" role="status">
          <ReturnResult
            store={store}
            token={token}
            refund={returnSettled.refund}
            sent={returnSettled.sent}
            kept
          />
          <button
            onClick={() => {
              setReturnSettled(null);
            }}
          >
            Зрозуміло
          </button>
        </section>
      )}
      {returnCommand.error !== null && (
        <p role="alert">
          {returnErrorText(returnCommand.error, returnCommand.misses)}
        </p>
      )}
      {creditStorageError && (
        <p role="alert">
          Не вдалося прочитати збережений внесок. Не очищайте дані застосунку;
          зверніться до менеджера.
        </p>
      )}
      {creditCommand.pending && (
        <section className="notice">
          <h3>
            {creditCommand.pending.body.kind === "payment"
              ? creditCommand.busy
                ? "Перевіряємо внесок…"
                : "Внесок ще не підтверджено"
              : creditCommand.busy
                ? "Перевіряємо списання…"
                : "Списання ще не підтверджено"}
          </h3>
          {/* Which payment: its sum, way and goods, as the attempt kept them
              (credits task list, P1-2). */}
          <p>{keptCreditText(creditCommand.pending.body)}</p>
          <p>{keptText(creditCommand.pending.since, me.display_name)}</p>
          <button disabled={creditCommand.busy} onClick={checkCredit}>
            {creditCommand.pending.body.kind === "payment"
              ? "Перевірити результат внеску"
              : "Перевірити результат списання"}
          </button>
        </section>
      )}
      {creditSettled && (
        <section className="notice" role="status">
          {/* The payment's result, compact (credits task list, P1-2): a card
              is charged only if nobody did while the server did not answer
              (owner decision, 2026-10-07). */}
          {creditSettled.kind === "payment" ? (
            <Paid
              kind="payment"
              amount={creditSettled.amount}
              way={isTillMethod(creditSettled.way) ? creditSettled.way : null}
              paper={creditSettled.paper}
              credit={creditSettled.credit}
              kept
              said={`${visible(creditSettled.credit.customer_name ?? erasedCustomer)}: залишок боргу ${money(creditSettled.credit.owed)}.${
                creditSettled.paper
                  ? paidOnPaper(
                      creditSettled.way,
                      creditSettled.paper.first_days === true,
                    )
                  : creditSettled.way === "CARD"
                    ? ` ${chargeOnce(creditSettled.amount)}`
                    : ""
              }`}
            />
          ) : (
            <Paid
              kind="write-off"
              amount={creditSettled.credit.written_off}
              way={null}
              paper={null}
              credit={creditSettled.credit}
              kept
              said={`${visible(creditSettled.credit.customer_name ?? erasedCustomer)}: залишок боргу ${money(creditSettled.credit.owed)}.`}
            />
          )}
          <button
            onClick={() => {
              setCreditSettled(null);
            }}
          >
            Зрозуміло
          </button>
        </section>
      )}
      {creditCommand.error !== null && (
        <p role="alert">
          {creditErrorText(
            creditCommand.error,
            // Still kept: its own kind; settled as refused: the one it was.
            creditCommand.pending?.body.kind ?? creditRefused.kind,
            creditRefused.way,
            creditCommand.misses,
          )}
        </p>
      )}
      {adjustmentStorageError && (
        <p role="alert">
          Не вдалося прочитати збережене коригування. Не очищайте дані
          застосунку; зверніться до менеджера.
        </p>
      )}
      {adjustmentCommand.pending && (
        <section className="notice">
          <h3>
            {adjustmentCommand.busy
              ? "Перевіряємо коригування…"
              : "Незавершене коригування"}
          </h3>
          <p>
            Невідомо, чи записано попереднє коригування залишку. Перевірте
            результат — те саме коригування не застосується двічі. Поки чекаємо,
            інші дії недоступні.
          </p>
          <p>{keptText(adjustmentCommand.pending.since, me.display_name)}</p>
          <button disabled={adjustmentCommand.busy} onClick={checkAdjustment}>
            Перевірити результат коригування
          </button>
        </section>
      )}
      {adjustmentSettled && (
        <section className="notice" role="status">
          <h3>Коригування підтверджено</h3>
          <p>
            Його було записано один раз: облік{" "}
            {adjustmentSettled.quantity_before} →{" "}
            {adjustmentSettled.quantity_after}.
          </p>
          <button
            onClick={() => {
              setAdjustmentSettled(null);
            }}
          >
            Зрозуміло
          </button>
        </section>
      )}
      {adjustmentCommand.error !== null && (
        <p role="alert">
          {adjustmentErrorText(
            adjustmentCommand.error,
            adjustmentCommand.misses,
          )}
        </p>
      )}
      {countStorageError && (
        <p role="alert">
          Не вдалося прочитати збережений підрахунок інвентаризації. Не очищайте
          дані застосунку; зверніться до менеджера.
        </p>
      )}
      {countCommand.pending && (
        <section className="notice">
          <h3>
            {countCommand.busy
              ? "Перевіряємо підрахунок…"
              : "Незавершений підрахунок"}
          </h3>
          <p>
            Невідомо, чи записано попередній підрахунок інвентаризації.
            Перевірте результат — той самий підрахунок не застосується двічі.
            Поки чекаємо, інші дії недоступні.
          </p>
          <p>{keptText(countCommand.pending.since, me.display_name)}</p>
          <button disabled={countCommand.busy} onClick={checkCount}>
            Перевірити результат підрахунку
          </button>
        </section>
      )}
      {countSettled && (
        <section className="notice" role="status">
          <h3>Підрахунок підтверджено</h3>
          <p>
            Його було записано один раз:{" "}
            {countSettled.quantity_delta === 0
              ? `збігається з обліком (${String(countSettled.counted_quantity)}).`
              : `облік ${String(countSettled.quantity_before)} → ${String(countSettled.counted_quantity)}.`}
          </p>
          <button
            onClick={() => {
              setCountSettled(null);
            }}
          >
            Зрозуміло
          </button>
        </section>
      )}
      {countCommand.error !== null && (
        <p role="alert">
          {countErrorText(countCommand.error, countCommand.misses)}
        </p>
      )}
      {pending && (
        <section className="notice">
          <h3>{busy ? "Перевіряємо результат…" : "Незавершена операція"}</h3>
          <p>{pending.label}. Поки чекаємо, інші дії недоступні.</p>
          <p>{keptText(pending.since, me.display_name)}</p>
          <button disabled={busy} onClick={checkOrder}>
            {pending.acknowledged
              ? "Оновити результат"
              : "Повторити ту саму команду"}
          </button>
        </section>
      )}
      {error !== null && (
        <p role="alert" ref={orderAlert} tabIndex={-1}>
          {orderErrorText(
            error,
            orderResent,
            // Unconfirmed only while its outcome is unknown: answered, the
            // step is recorded, and only reading the order failed.
            pending !== null && !pending.acknowledged,
            orderMisses,
            pending?.label ?? null,
            // Answered: the step is recorded (owner decision, 2026-10-21).
            pending?.acknowledged === true,
          )}
        </p>
      )}
      {tab === "sale" ? (
        store.permissions.includes("sale:create") ? (
          <Sale
            key={saleEpoch}
            store={store}
            token={token}
            userId={me.user_id}
            journalKey={saleKey}
            searchFirst={searchFirst}
            blocked={
              storageError ||
              catalogStorageError ||
              saleStorageError ||
              receiptStorageError ||
              busy ||
              pending !== null ||
              catalogCommand.busy ||
              catalogCommand.pending !== null ||
              receiptCommand.busy ||
              receiptCommand.pending !== null ||
              adjustmentUnsettled ||
              returnUnsettled ||
              creditUnsettled ||
              cashUnsettled ||
              // The till is the first tab now (redesign P0-1): whatever holds
              // every other tab holds it too, not only the tab's button.
              storesUnsettled ||
              supplierUnsettled ||
              invoiceUnsettled ||
              correctionUnsettled
            }
            {...fixFromReceipt}
            {...(canReturn
              ? {
                  returnSale: (sale: SaleReceipt) => {
                    setReturnOf(sale.id);
                    setTab("returns");
                  },
                }
              : {})}
          />
        ) : (
          <p role="alert">Немає права оформлювати продаж.</p>
        )
      ) : tab === "receive" ? (
        store.permissions.includes("inventory:receive") ? (
          <Receive
            store={store}
            token={token}
            journalKey={receiptKey}
            blocked={
              storageError ||
              catalogStorageError ||
              saleStorageError ||
              receiptStorageError ||
              busy ||
              pending !== null ||
              catalogCommand.busy ||
              catalogCommand.pending !== null ||
              saleCommand.busy ||
              saleCommand.pending !== null ||
              adjustmentUnsettled ||
              returnUnsettled ||
              creditUnsettled ||
              cashUnsettled
            }
          />
        ) : (
          <p role="alert">Немає права приймати товар.</p>
        )
      ) : tab === "stock" ? (
        store.permissions.includes("inventory:view") ? (
          <Stock
            store={store}
            token={token}
            scopeKey={key}
            journalKey={adjustmentKey}
            countKey={countKey}
            blocked={
              otherThanAdjustment || adjustmentStorageError || countStorageError
            }
          />
        ) : (
          <p role="alert">Немає доступу до залишків.</p>
        )
      ) : tab === "returns" ? (
        canReturn ? (
          <Returns
            key={returnsEpoch}
            store={store}
            token={token}
            journalKey={returnKey}
            open={returnOf}
            opened={returnOpened}
            sell={
              store.permissions.includes("sale:create")
                ? () => {
                    setSearchFirst(true);
                    setTab("sale");
                  }
                : undefined
            }
            blocked={
              storageError ||
              catalogStorageError ||
              saleStorageError ||
              receiptStorageError ||
              busy ||
              pending !== null ||
              catalogCommand.busy ||
              catalogCommand.pending !== null ||
              saleCommand.busy ||
              saleCommand.pending !== null ||
              receiptCommand.busy ||
              receiptCommand.pending !== null ||
              adjustmentUnsettled ||
              creditUnsettled ||
              cashUnsettled
            }
          />
        ) : // Never opened without the right: nothing is said of the rule
        // (returns task list, P2-1).
        null
      ) : tab === "credits" ? (
        canSeeCredits ? (
          <Credits
            key={creditEpoch}
            store={store}
            token={token}
            journalKey={creditKey}
            readOnly={!trading}
            networkOwner={me.organization_permissions.includes(
              "credit:write_off",
            )}
            mayErase={me.organization_permissions.includes(
              "credit:erase_customer",
            )}
            sell={
              trading && store.permissions.includes("sale:create")
                ? () => {
                    setSearchFirst(true);
                    setTab("sale");
                  }
                : undefined
            }
            blocked={
              storageError ||
              catalogStorageError ||
              saleStorageError ||
              receiptStorageError ||
              busy ||
              pending !== null ||
              catalogCommand.busy ||
              catalogCommand.pending !== null ||
              saleCommand.busy ||
              saleCommand.pending !== null ||
              receiptCommand.busy ||
              receiptCommand.pending !== null ||
              adjustmentUnsettled ||
              returnUnsettled ||
              cashUnsettled
            }
          />
        ) : // Never opened without the right: nothing is said of the rule
        // (credits task list, P2-1).
        null
      ) : tab === "damaged" ? (
        store.permissions.includes("damaged:handle") ? (
          <Damaged
            store={store}
            token={token}
            blocked={blocked}
            readOnly={!trading}
          />
        ) : (
          <p role="alert">Немає доступу до розділу «Брак».</p>
        )
      ) : tab === "openings" ? (
        canSeeOpenings ? (
          <Openings
            store={store}
            token={token}
            scopeKey={key}
            blocked={blocked}
          />
        ) : (
          <p role="alert">Немає доступу до початкових залишків.</p>
        )
      ) : tab === "backups" ? (
        canSeeBackups ? (
          <Backups token={token} scopeKey={backupsKey} />
        ) : (
          <p role="alert">Цей розділ бачить лише власник.</p>
        )
      ) : tab === "suppliers" ? (
        canReturnToSupplier ? (
          <Suppliers
            store={store}
            token={token}
            journalKey={supplierKey}
            invoiceJournalKey={invoiceKey}
            blocked={otherThanSuppliers}
          />
        ) : (
          <p role="alert">Повертають постачальнику власник і менеджери.</p>
        )
      ) : tab === "invoices" ? (
        canSeeInvoices ? (
          <Invoices
            store={store}
            token={token}
            journalKey={invoiceKey}
            blocked={otherThanInvoices}
            readOnly={!trading}
            networkOwner={me.organization_permissions.includes(
              "supplier:write_off",
            )}
          />
        ) : (
          <p role="alert">Накладні ведуть власник і менеджери.</p>
        )
      ) : tab === "models" ? (
        canCorrect && trading ? (
          <Models
            store={store}
            token={token}
            journalKey={correctionKey}
            blocked={otherThanCorrections}
          />
        ) : (
          <p role="alert">Каталог виправляють власник і менеджери.</p>
        )
      ) : tab === "cash" ? (
        canSeeCash ? (
          <Cash
            store={store}
            token={token}
            journalKey={cashKey}
            blocked={otherThanCash || cashStorageError}
            networkOwner={me.organization_permissions.includes("store:manage")}
            fix={cashFix}
            fixSeen={fixSeen}
          />
        ) : // The right gone while «Каса» was open: nothing is said of the
        // rule, as «Борги» (cash task list, P2-1).
        null
      ) : tab === "report" ? (
        canSeeReport ? (
          <SalesReport token={token} scopeKey={reportKey} />
        ) : (
          <p role="alert">Звіт бачать власник і менеджери.</p>
        )
      ) : tab === "stores" ? (
        canManageStores ? (
          <Stores
            storeId={store.id}
            token={token}
            journalKey={storesKey}
            blocked={otherThanStores}
            changed={storesChanged}
          />
        ) : (
          <p role="alert">Цей розділ бачить лише власник мережі.</p>
        )
      ) : tab === "catalog" ? (
        store.permissions.includes("catalog:confirm") ? (
          <Catalog
            store={store}
            token={token}
            journalKey={catalogKey}
            storageError={
              catalogStorageError || storageError || busy || pending !== null
            }
            person={me.display_name}
          />
        ) : (
          <p role="alert">
            Немає доступу до перевірки каталогу. Зверніться до менеджера.
          </p>
        )
      ) : tab === "new" ? (
        <NewOrder
          store={store}
          token={token}
          blocked={blocked}
          submit={(lines, destination, carrier) => {
            void run({
              path: "/orders",
              body: {
                store_id: store.id,
                command_id: crypto.randomUUID(),
                lines,
                destination,
                ...(carrier ? { carrier } : {}),
              },
              label: "Резервування замовлення",
            });
          }}
        />
      ) : selectedId ? (
        <>
          <button
            className="quiet"
            onClick={() => {
              setSelectedId(null);
              setOrderDone(null);
              setCollected(null);
            }}
          >
            ← До замовлень
          </button>
          {detail.isPending ? (
            <p role="status">Завантажуємо замовлення…</p>
          ) : detail.error ? (
            <Failure
              error={detail.error}
              retry={() => {
                void detail.refetch();
              }}
            />
          ) : (
            <OrderDetail
              // Afresh once it moves on or says where it goes otherwise, so
              // no form keeps what it showed before.
              key={`${detail.data.id}:${detail.data.status}:${String(
                detail.data.shipping_history?.length ?? 0,
              )}`}
              order={detail.data}
              done={orderDone?.id === detail.data.id ? orderDone.text : null}
              collected={
                collected?.id === detail.data.id
                  ? collected.kept
                    ? "kept"
                    : "now"
                  : null
              }
              store={store}
              token={token}
              blocked={blocked}
              back={() => {
                setSelectedId(null);
                setOrderDone(null);
                setCollected(null);
              }}
              // Its sale, as the receipt's: «Каса» on it for whoever opens
              // «Каса», «Повернення» on it for whoever takes returns.
              fixWay={
                canSeeCash &&
                detail.data.sale_id &&
                // Only where the server gives this person its way: anywhere
                // else, «Каса» would say it (G32; review, 2026-10-24).
                detail.data.payment_method
                  ? () => {
                      setCashFix({
                        target: "SALE",
                        id: detail.data.sale_id ?? "",
                      });
                      setTab("cash");
                    }
                  : undefined
              }
              returnSale={
                canReturn && detail.data.sale_id
                  ? () => {
                      setReturnOf(detail.data.sale_id);
                      setTab("returns");
                    }
                  : undefined
              }
              action={(action, extra) => {
                void run({
                  path: `/orders/${detail.data.id}/${action}`,
                  body: { command_id: crypto.randomUUID(), ...extra },
                  label: actionLabels[action] ?? action,
                  orderId: detail.data.id,
                });
              }}
            />
          )}
        </>
      ) : (
        <Orders
          store={store}
          token={token}
          blocked={blocked}
          view={ordersView}
          change={setOrdersView}
          open={(order) => {
            setSelectedId(order.id);
            setOrderDone(null);
            setCollected(null);
          }}
          create={() => {
            setTab("new");
            setSelectedId(null);
          }}
        />
      )}
    </>
  );
}
/**
 * A kept payment typed from paper, confirmed: what the till says of money
 * taken during the outage, by its way (ADR-0021) — never to charge again.
 */
function paidOnPaper(way: PaymentMethod | null, firstDays: boolean): string {
  const paid = way === null ? null : paidDuringOutage(way, firstDays);
  return paid === null
    ? ""
    : ` ${paid.charAt(0).toUpperCase()}${paid.slice(1)}.`;
}

/**
 * A kept sale's banner (redesign P1-4): which sale it was — its sum and how
 * it was paid, as the attempt sent them, so the seller knows which customer
 * and whether to take the money again — and that it is not confirmed yet.
 * An attempt kept from before the way was asked names none.
 */
function keptSaleText(attempt: SaleAttempt): string {
  const waits =
    "сервер не відповів. Двічі він не запишеться. Поки чекаємо, інші дії недоступні.";
  if (attempt.emptyShelf)
    return "Сервер не відповів. Двічі нестача не запишеться. Поки чекаємо, інші дії недоступні.";
  const { sum, inParts } = attemptSum(attempt.body);
  const way = attempt.body.payment_method;
  const how = way ? ` · ${methodLabels[way]}` : "";
  // A sum that does not read: the way alone, never a guess.
  if (sum === null) return `Продаж${how} — ${waits}`;
  return `Продаж ${inParts ? "частинами, зараз" : "на"} ${money(sum)}${how} — ${waits}`;
}

/**
 * A kept payment's banner (credits task list, P1-2): which payment it was —
 * its sum, way and goods, as the attempt kept them — and that it is not
 * confirmed yet. The goods are read defensively: an attempt kept before they
 * were, or with something else there, names the sum and way alone.
 */
function keptCreditText(body: CreditBody): string {
  if (body.kind === "write-off")
    return "Списання боргу — сервер не відповів. Двічі воно не запишеться. Поки чекаємо, інші дії недоступні.";
  const goods: unknown[] = Array.isArray(body.goods) ? body.goods : [];
  const [first] = goods;
  // The first named, the rest counted; an empty name, none (review,
  // 2026-10-18).
  const named =
    typeof first === "string" && goods.every((good) => typeof good === "string")
      ? visible(first).trim()
      : "";
  const what =
    named === ""
      ? ""
      : ` за «${named}${goods.length > 1 ? ` + ще ${String(goods.length - 1)}` : ""}»`;
  const way = body.payment_method ? ` ${methodHow[body.payment_method]}` : "";
  return `Внесок${body.outage ? " з паперу" : ""} ${money(body.amount)}${way}${what} — сервер не відповів. Двічі він не запишеться. Поки чекаємо, інші дії недоступні.`;
}

/**
 * A sale whose answer was lost, settled: what it came to and how it was
 * paid (ADR-0012, B12). The seller presses first and charges the terminal
 * after (owner decision, 2026-10-04), so a card sale says to charge it,
 * unless that was done while the server did not answer. A sale typed from
 * paper shows its mark, and money taken during the outage is never charged
 * again (ADR-0013 §5.6). A sale in parts names its way on the part paid now,
 * and an answer recorded before the way was asked names none.
 */
function SettledSale({ sale }: { sale: SaleReceipt }): JSX.Element {
  const way = sale.credit ? null : (sale.payment_method ?? null);
  const mark = sale.outage ?? null;
  const paid =
    mark !== null && way !== null
      ? paidDuringOutage(way, mark.first_days === true)
      : null;
  return (
    <>
      {mark && <p className="badge">{markText(mark)}</p>}
      <p>
        Разом {money(sale.total)}
        {way ? ` ${methodHow[way]}` : ""}
        {paid !== null && ` — ${paid}`}.
        {way === "CARD" && paid === null && ` ${chargeOnce(sale.total)}`}
      </p>
    </>
  );
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
      <button onClick={retry}>Спробувати ще раз</button>
    </div>
  );
}
interface DraftLine {
  line: Line;
  name: string;
  size: string;
  warehouse: string;
}
function NewOrder({
  store,
  token,
  blocked,
  submit,
}: {
  store: Store;
  token: string;
  blocked: boolean;
  submit: (
    lines: Line[],
    destination: Destination,
    carrier: Carrier | null,
  ) => void;
}): JSX.Element {
  const [locationId, setLocationId] = useState("");
  const [offset, setOffset] = useState(0);
  const [option, setOption] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [validation, setValidation] = useState("");
  // Within Ukraine unless said otherwise, and then by a carrier, picked
  // now; the waybill comes when it is sent (owner decisions, 2026-10-01).
  const [destination, setDestination] = useState<Destination>("UKRAINE");
  const [carrier, setCarrier] = useState<Carrier | "">("");
  const locations = useQuery({
    queryKey: ["locations", store.id],
    queryFn: () =>
      api<Location[]>(`/stock-locations?store_id=${store.id}`, token),
  });
  const stock = useQuery({
    queryKey: ["stock", store.id, locationId, offset],
    queryFn: () =>
      api<{ items: StockOption[]; has_more: boolean }>(
        `/catalog/stock-options?store_id=${store.id}&location_id=${locationId}&limit=100&offset=${String(offset)}`,
        token,
      ),
    enabled: !!locationId,
  });
  const selected = stock.data?.items.find(
    (item) => `${item.product_variant_id}:${item.size_id}` === option,
  );
  function add(): void {
    const cents = kopecks(price);
    const count = Number(quantity);
    if (
      !selected ||
      cents === null ||
      !/^\d+$/.test(quantity) ||
      count < 1 ||
      count > 1000
    ) {
      setValidation(
        "Оберіть товар, кількість від 1 до 1000 та ціну з точністю до копійок.",
      );
      return;
    }
    if (
      draft.some(
        (d) =>
          d.line.source_location_id === locationId &&
          d.line.product_variant_id === selected.product_variant_id &&
          d.line.size_id === selected.size_id,
      )
    ) {
      setValidation(
        "Цей товар уже додано з цього складу. Видаліть рядок, щоб змінити його кількість.",
      );
      return;
    }
    if (count > selected.available_quantity) {
      setValidation("Кількість перевищує доступний залишок.");
      return;
    }
    setDraft([
      ...draft,
      {
        line: {
          product_variant_id: selected.product_variant_id,
          size_id: selected.size_id,
          source_location_id: locationId,
          quantity: count,
          unit_price: decimal(cents),
          discount_amount: "0.00",
        },
        name: selected.display_name,
        size: selected.size_label,
        warehouse: locations.data?.find((l) => l.id === locationId)?.name ?? "",
      },
    ]);
    setPrice("");
    setQuantity("1");
    setOption("");
    setValidation("");
  }
  const total = draft.reduce(
    (sum, d) =>
      sum + (kopecks(d.line.unit_price) ?? 0n) * BigInt(d.line.quantity),
    0n,
  );
  return (
    <section>
      <h2>Нове замовлення</h2>
      <p>
        Оберіть склад і товар. Замовлення зарезервує залишок до відправлення.
      </p>
      <fieldset disabled={blocked}>
        <legend>Товари</legend>
        {locations.isPending ? (
          <p role="status">Завантажуємо склади…</p>
        ) : locations.error ? (
          <Failure
            error={locations.error}
            retry={() => {
              void locations.refetch();
            }}
          />
        ) : (
          <label>
            Склад
            <select
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
                setOffset(0);
                setOption("");
              }}
            >
              <option value="">З якого складу віддаєте?</option>
              {locations.data.map((l) => (
                <option
                  key={l.id}
                  value={l.id}
                  disabled={!l.is_active || !l.can_sell}
                >
                  {visible(l.name)}
                  {!l.is_active
                    ? " — на паузі"
                    : !l.can_sell
                      ? " — без права продажу"
                      : ""}
                </option>
              ))}
            </select>
            {locations.data.length === 0 && (
              <span>Доступних складів немає.</span>
            )}
          </label>
        )}
        {locationId &&
          (stock.isPending ? (
            <p role="status">Завантажуємо товари…</p>
          ) : stock.error ? (
            <Failure
              error={stock.error}
              retry={() => {
                void stock.refetch();
              }}
            />
          ) : (
            <>
              <label>
                Товар і розмір
                <select
                  value={option}
                  onChange={(e) => {
                    setOption(e.target.value);
                  }}
                >
                  <option value="">Оберіть товар</option>
                  {stock.data.items.map((item) => (
                    <option
                      key={`${item.product_variant_id}:${item.size_id}`}
                      value={`${item.product_variant_id}:${item.size_id}`}
                      disabled={item.available_quantity <= 0}
                    >
                      {visible(item.display_name)} ·{" "}
                      {item.size_is_unknown
                        ? "розмір невідомий"
                        : visible(item.size_label)}{" "}
                      · доступно {item.available_quantity}
                    </option>
                  ))}
                </select>
              </label>
              {stock.data.items.length === 0 && (
                <p>На цьому складі немає товарів.</p>
              )}
              {selected && (
                <p className="hint">
                  На складі {selected.quantity} · у резерві{" "}
                  {selected.reserved_quantity} · доступно{" "}
                  {selected.available_quantity}
                </p>
              )}
              <div className="toolbar">
                <button
                  type="button"
                  className="quiet"
                  disabled={offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - 100));
                    setOption("");
                  }}
                >
                  Попередні товари
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={!stock.data.has_more}
                  onClick={() => {
                    setOffset(offset + 100);
                    setOption("");
                  }}
                >
                  Наступні товари
                </button>
              </div>
            </>
          ))}
        <div className="fields">
          <label>
            Кількість
            <input
              inputMode="numeric"
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
              }}
            />
          </label>
          <label>
            Ціна, грн
            <input
              inputMode="decimal"
              placeholder="0,00"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
              }}
            />
          </label>
        </div>
        <p className="hint">
          Вкажіть остаточну ціну після торгу. Це вартість товару, а не отримана
          оплата.
        </p>
        <button
          className="quiet"
          disabled={!selected || draft.length >= 100}
          onClick={add}
        >
          Додати товар
        </button>
        {validation && <p role="alert">{validation}</p>}
        {draft.map((d, index) => (
          <div
            className="line"
            key={`${d.line.source_location_id}:${d.line.product_variant_id}:${d.line.size_id}`}
          >
            <strong>
              {visible(d.name)} · {visible(d.size)}
            </strong>
            <span>
              {visible(d.warehouse)} · {d.line.quantity} ×{" "}
              {money(d.line.unit_price)}
            </span>
            <button
              className="quiet"
              onClick={() => {
                setDraft(draft.filter((_, i) => i !== index));
              }}
            >
              Прибрати {visible(d.name)}
            </button>
          </div>
        ))}
        <p className="total">
          Разом <strong>{money(decimal(total))}</strong>
        </p>
        <DestinationFields
          destination={destination}
          carrier={carrier}
          change={(nextDestination, nextCarrier) => {
            setDestination(nextDestination);
            setCarrier(nextCarrier);
            setValidation("");
          }}
        />
        <p className="hint">
          Номер накладної вписують, коли замовлення відправляють, або пізніше.
        </p>
        <button
          disabled={draft.length === 0}
          onClick={() => {
            if (destination === "UKRAINE" && carrier === "") {
              setValidation("Оберіть перевізника.");
              return;
            }
            submit(
              draft.map((d) => d.line),
              destination,
              destination === "UKRAINE" && carrier !== "" ? carrier : null,
            );
          }}
        >
          Замовити та зарезервувати
        </button>
      </fieldset>
    </section>
  );
}
