import { useCallback, useEffect, useId, useState } from "react";
import type { ComponentProps, JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorText } from "@/shared/api";
import { methodHow } from "@/shared/payment";
import type { PaymentMethod, TillMethod } from "@/shared/payment";
import { keptText, useAutoCheck } from "@/shared/reach";
import { setScreen } from "@/shared/report";
import { visible } from "@/shared/visible";
import {
  connectTelegram,
  telegramInitData,
  telegramUserId,
} from "@/shared/telegram";
import { loadPending, submitPending, useCommand } from "@/orders/commands";
import type { Pending } from "@/orders/commands";
import {
  asShown,
  carrierLabels,
  collectHint,
  collectMethods,
  decimal,
  kopecks,
  money,
  shippingText,
  stateText,
  statusLabels,
} from "@/orders/types";
import type {
  Me,
  Store,
  Location,
  StockOption,
  Line,
  Order,
  Carrier,
  Destination,
  ShippingChange,
} from "@/orders/types";
import { Stock } from "@/inventory/Stock";
import { Catalog } from "@/catalog/Catalog";
import { loadCatalogCommand, useCatalogCommand } from "@/catalog/commands";
import { Sale } from "@/sales/Sale";
import { loadSale, resolve, useSaleCommand } from "@/sales/commands";
import { clearPaper } from "@/sales/paper";
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
import { Done as ReturnDone, Returns } from "@/returns/Returns";
import type { Refund, ReturnPart } from "@/returns/types";
import { Credits } from "@/credits/Credits";
import {
  loadCreditCommand,
  resolveCreditCommand,
  useCreditCommand,
} from "@/credits/commands";
import { erasedCustomer } from "@/credits/types";
import type { Credit } from "@/credits/types";
import { TermsFields, checkTerms, noTerms } from "@/credits/Terms";
import type { TermsInput } from "@/credits/Terms";
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
  collectNeedsMethod,
  creditErrorText,
  orderErrorText,
  receiptErrorText,
  returnErrorText,
  saleErrorText,
} from "@/cash/errors";
import { NoCustomerData } from "@/shared/NoCustomerData";
import "./styles.css";

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
    return (
      <main>
        <h1>birka</h1>
        <h2>Доступу ще немає</h2>
        <p role="alert">
          Цей акаунт Telegram не має доступу до жодного магазину.
        </p>
        {/* People are added on the server, by this number, on the owner's
            word (owner decision, 2026-10-01). */}
        <p>
          Ваш номер у Telegram: <strong>{telegramUserId() ?? "—"}</strong>.
          Передайте його власнику магазину. Коли вас додадуть, натисніть
          «Спробувати ще раз».
        </p>
        <button onClick={readAgain}>Спробувати ще раз</button>
      </main>
    );
  if (failure)
    return (
      <main>
        <h1>birka</h1>
        <h2>Вхід через Telegram</h2>
        <p role="alert">
          {failure.message === "TELEGRAM_REQUIRED"
            ? "Відкрийте застосунок кнопкою в Telegram-боті вашого магазину."
            : errorText(failure)}
        </p>
        <button onClick={readAgain}>Спробувати ще раз</button>
      </main>
    );
  if (token === undefined || me.data === undefined)
    return (
      <main>
        <h1>birka</h1>
        <p role="status">Входимо в магазин…</p>
      </main>
    );
  const store = me.data.stores.find((s) => s.id === storeId);
  return (
    <main>
      <header>
        <div>
          <span className="eyebrow">РОБОЧЕ МІСЦЕ ПРОДАВЦЯ</span>
          <h1>
            birka <span> / магазин</span>
          </h1>
        </div>
        <span>{visible(me.data.display_name)}</span>
      </header>
      {!store ? (
        <section>
          <h2>Оберіть магазин</h2>
          <p>Продаж буде записано на обраний магазин. Склад оберете окремо.</p>
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
          <div className="toolbar">
            <h2>{visible(store.name)}</h2>
            <button
              className="quiet"
              onClick={() => {
                setStoreId("");
              }}
            >
              Змінити магазин
            </button>
          </div>
          <h3>{stateText(store)}</h3>
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
          changeStore={() => {
            setStoreId("");
          }}
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
  changeStore: () => void;
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
  const [tab, setTab] = useState<
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
    | "cash"
  >("list");
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
      useReturnToSupplier.setState({ pending: saved, error: null });
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
      useCorrectionCommand.setState({ pending: saved, error: null });
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
      useInvoiceCommand.setState({ pending: saved, error: null });
      if (saved) setTab("invoices");
    } catch {
      setInvoiceStorageError(true);
    }
  }, [invoiceKey, canSeeInvoices]);
  useEffect(() => {
    if (!canManageStores) return;
    try {
      const saved = loadStateCommand(storesKey);
      useStateCommand.setState({ pending: saved, error: null });
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
  const [offset, setOffset] = useState(0);
  // Orders found by their waybill (owner decision, 2026-10-01).
  const [waybillQuery, setWaybillQuery] = useState("");
  const [waybillSearch, setWaybillSearch] = useState("");
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
      useReceiptCommand.setState({ pending: saved, error: null });
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
      useAdjustmentCommand.setState({ pending: saved, error: null });
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
      useCountCommand.setState({ pending: saved, error: null });
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
  useEffect(() => {
    try {
      const saved = loadReturn(returnKey);
      useReturnCommand.setState({ pending: saved, error: null });
      if (saved) {
        setTab("returns");
        loadedFromDisk("return");
      }
    } catch {
      setReturnStorageError(true);
    }
  }, [returnKey, loadedFromDisk]);
  // A return is looked up in the store's sales, so it needs both.
  const canReturn =
    store.permissions.includes("sale:refund") &&
    store.permissions.includes("sale:view");
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
  // Sales paid in parts: whoever sells that way takes the payments.
  const canSeeCredits = store.permissions.includes("sale:credit");
  const creditKey = `birka:credit-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [creditStorageError, setCreditStorageError] = useState(false);
  const creditCommand = useCreditCommand();
  // A payment or write-off whose outcome was unknown, settled; a payment
  // with its sum and way, so a card is still charged on the terminal.
  const [creditSettled, setCreditSettled] = useState<{
    kind: "payment" | "write-off";
    credit: Credit;
    amount: string | null;
    way: PaymentMethod | null;
    // Typed from paper: the card was charged during the outage (ADR-0021).
    fromPaper?: boolean;
  } | null>(null);
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
      useCreditCommand.setState({ pending: saved, error: null });
      if (saved) {
        setTab("credits");
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
      useCashCommand.setState({ pending: saved, error: null });
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
      useSaleCommand.setState({ pending: saved, error: null });
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
  const { pending, busy, error } = useCommand();
  useEffect(() => {
    try {
      const saved = loadPending(key);
      useCommand.getState().set(saved);
      if (saved) loadedFromDisk("orders");
    } catch {
      setStorageError(true);
    }
  }, [key, loadedFromDisk]);
  const list = useQuery({
    queryKey: ["orders", store.id, offset, waybillSearch],
    queryFn: () =>
      api<{ orders: Order[]; has_more: boolean }>(
        `/orders?store_id=${store.id}&limit=50&offset=${String(offset)}${
          waybillSearch ? `&waybill=${encodeURIComponent(waybillSearch)}` : ""
        }`,
        token,
      ),
    enabled: store.permissions.includes("sale:view"),
  });
  const detail = useQuery({
    queryKey: ["order", store.id, selectedId],
    queryFn: () => api<Order>(`/orders/${selectedId ?? ""}`, token),
    enabled: selectedId !== null,
  });
  // The order command last sent, when it was a saved one resent: refused
  // for want of a way, it was an old «Клієнт забрав» (ADR-0012, B12), and
  // refused as having recorded nothing, it says which (ADR-0013 §1).
  const [orderResent, setOrderResent] = useState<string | null>(null);
  async function run(command: Pending, resent = false): Promise<void> {
    setOrderResent(resent ? command.label : null);
    const order = await submitPending(key, token, command);
    if (order) {
      cache.setQueryData(["order", store.id, order.id], order);
      setSelectedId(order.id);
      setTab("list");
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["orders", store.id] }),
        cache.invalidateQueries({ queryKey: ["stock", store.id] }),
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
        setCreditSettled({
          kind: attempt.body.kind,
          credit: outcome.result,
          ...(attempt.body.kind === "payment"
            ? {
                amount: attempt.body.amount,
                way: attempt.body.payment_method ?? null,
                fromPaper: !!attempt.body.outage,
              }
            : { amount: null, way: null }),
        });
        setCreditEpoch((epoch) => epoch + 1);
        void cache.invalidateQueries({
          queryKey: ["credits", store.id],
        });
      } else if (outcome.kind === "refused") {
        // Proven to have recorded nothing: settled, and said, with what to
        // do with money already taken.
        setCreditRefused({
          kind: attempt.body.kind,
          way:
            attempt.body.kind === "payment"
              ? (attempt.body.payment_method ?? null)
              : null,
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
      ? paidDuringOutage(settled.payment_method)
      : null;
  setScreen(tab);
  return (
    <>
      <div className="toolbar">
        <h2>{visible(store.name)}</h2>
        <button className="quiet" disabled={blocked} onClick={changeStore}>
          Змінити магазин
        </button>
      </div>
      {!trading && (
        <p className="notice" role="status">
          {stateText(store)}. Лише перегляд: продажі, приймання, повернення й
          оплати в цьому магазині зупинено.
        </p>
      )}
      <nav aria-label="Розділи">
        <button
          className={tab === "list" ? "active" : "quiet"}
          disabled={blocked}
          onClick={() => {
            setTab("list");
            setSelectedId(null);
          }}
        >
          Замовлення
        </button>
        {store.permissions.includes("sale:create") && (
          <button
            className={tab === "sale" ? "active" : "quiet"}
            disabled={blocked}
            onClick={() => {
              setTab("sale");
              setSelectedId(null);
            }}
          >
            Продаж
          </button>
        )}
        {store.permissions.includes("sale:create") && (
          <button
            className={tab === "new" ? "active" : "quiet"}
            disabled={blocked}
            onClick={() => {
              setTab("new");
              setSelectedId(null);
            }}
          >
            + Нове замовлення
          </button>
        )}
        {store.permissions.includes("catalog:confirm") && (
          <button
            className={tab === "catalog" ? "active" : "quiet"}
            disabled={blocked}
            onClick={() => {
              setTab("catalog");
            }}
          >
            Каталог
          </button>
        )}
        {store.permissions.includes("inventory:receive") && (
          <button
            className={tab === "receive" ? "active" : "quiet"}
            disabled={blocked}
            onClick={() => {
              setTab("receive");
            }}
          >
            Приймання
          </button>
        )}
        {store.permissions.includes("inventory:view") && (
          <button
            className={tab === "stock" ? "active" : "quiet"}
            disabled={blocked}
            onClick={() => {
              setTab("stock");
            }}
          >
            Залишки
          </button>
        )}
        {canReturn && (
          <button
            className={tab === "returns" ? "active" : "quiet"}
            disabled={blocked}
            onClick={() => {
              setTab("returns");
            }}
          >
            Повернення
          </button>
        )}
        {canSeeCredits && (
          <button
            className={tab === "credits" ? "active" : "quiet"}
            disabled={blocked}
            onClick={() => {
              setTab("credits");
            }}
          >
            Борги
          </button>
        )}
        {canSeeCash && (
          <button
            className={tab === "cash" ? "active" : "quiet"}
            disabled={otherThanCash}
            onClick={() => {
              setTab("cash");
              setSelectedId(null);
            }}
          >
            Каса
          </button>
        )}
        {store.permissions.includes("damaged:handle") && (
          <button
            className={tab === "damaged" ? "active" : "quiet"}
            disabled={blocked}
            onClick={() => {
              setTab("damaged");
            }}
          >
            Брак
          </button>
        )}
        {canSeeOpenings && (
          <button
            className={tab === "openings" ? "active" : "quiet"}
            disabled={blocked}
            onClick={() => {
              setTab("openings");
            }}
          >
            Початкові залишки
          </button>
        )}
        {canSeeBackups && (
          <button
            className={tab === "backups" ? "active" : "quiet"}
            disabled={blocked}
            onClick={() => {
              setTab("backups");
            }}
          >
            Резервні копії{backupsNeedYou ? " ⚠" : ""}
          </button>
        )}
        {canReturnToSupplier && (
          <button
            className={tab === "suppliers" ? "active" : "quiet"}
            disabled={otherThanSuppliers}
            onClick={() => {
              setTab("suppliers");
            }}
          >
            Постачальникам
          </button>
        )}
        {canSeeInvoices && (
          <button
            className={tab === "invoices" ? "active" : "quiet"}
            disabled={otherThanInvoices}
            onClick={() => {
              setTab("invoices");
            }}
          >
            Накладні
          </button>
        )}
        {canCorrect && (
          <button
            className={tab === "models" ? "active" : "quiet"}
            disabled={otherThanCorrections}
            onClick={() => {
              setTab("models");
            }}
          >
            Моделі
          </button>
        )}
        {canSeeReport && (
          <button
            className={tab === "report" ? "active" : "quiet"}
            disabled={blocked}
            onClick={() => {
              setTab("report");
            }}
          >
            Звіт
          </button>
        )}
        {canManageStores && (
          <button
            className={tab === "stores" ? "active" : "quiet"}
            disabled={otherThanStores}
            onClick={() => {
              setTab("stores");
            }}
          >
            Магазини
          </button>
        )}
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
            {saleCommand.busy ? "Перевіряємо продаж…" : "Незавершений продаж"}
          </h3>
          <p>
            Невідомо, чи записано попередній продаж. Перевірте результат — та
            сама операція не продасться двічі. Нові операції заблоковано.
          </p>
          <p>{keptText(saleCommand.pending.since, me.display_name)}</p>
          <button disabled={saleCommand.busy} onClick={checkSale}>
            Перевірити результат продажу
          </button>
        </section>
      )}
      {settled && (
        <section className="notice" role="status">
          <h3>Продаж підтверджено</h3>
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
        <p role="alert">{saleErrorText(saleCommand.error)}</p>
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
            сама поставка не буде прийнята двічі. Нові операції заблоковано.
          </p>
          <p>{keptText(receiptCommand.pending.since, me.display_name)}</p>
          <button disabled={receiptCommand.busy} onClick={checkReceipt}>
            Перевірити результат приймання
          </button>
        </section>
      )}
      {receiptCommand.error !== null && (
        <p role="alert">{receiptErrorText(receiptCommand.error)}</p>
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
              : "Незавершене повернення"}
          </h3>
          <p>
            Невідомо, чи записано попереднє повернення. Перевірте результат — те
            саме повернення не буде оформлено двічі, і гроші не повернуться
            двічі. Нові операції заблоковано.
          </p>
          <p>{keptText(returnCommand.pending.since, me.display_name)}</p>
          <button disabled={returnCommand.busy} onClick={checkReturn}>
            Перевірити результат повернення
          </button>
        </section>
      )}
      {returnSettled && (
        <section className="notice">
          <ReturnDone
            store={store}
            token={token}
            refund={returnSettled.refund}
            sent={returnSettled.sent}
            kept
          />
          <p>Його було записано один раз — повторно воно не пройде.</p>
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
        <p role="alert">{returnErrorText(returnCommand.error)}</p>
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
            {creditCommand.busy ? "Перевіряємо внесок…" : "Незавершений внесок"}
          </h3>
          <p>
            Невідомо, чи записано попередній внесок або списання боргу.
            Перевірте результат — та сама операція не запишеться двічі. Нові
            операції заблоковано.
          </p>
          <p>{keptText(creditCommand.pending.since, me.display_name)}</p>
          <button disabled={creditCommand.busy} onClick={checkCredit}>
            Перевірити результат внеску
          </button>
        </section>
      )}
      {creditSettled && (
        <section className="notice" role="status">
          <h3>
            {creditSettled.kind === "payment"
              ? "Внесок підтверджено"
              : "Списання підтверджено"}
          </h3>
          <p>
            Його було записано один раз
            {creditSettled.amount !== null && creditSettled.way !== null
              ? `: ${money(creditSettled.amount)} ${methodHow[creditSettled.way]}`
              : ""}
            . {visible(creditSettled.credit.customer_name ?? erasedCustomer)}:
            залишок боргу {money(creditSettled.credit.owed)}.
            {creditSettled.fromPaper
              ? paidOnPaper(creditSettled.way)
              : creditSettled.amount !== null &&
                creditSettled.way === "CARD" &&
                ` ${chargeOnce(creditSettled.amount)}`}
          </p>
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
            creditRefused.kind,
            creditRefused.way,
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
            результат — те саме коригування не застосується двічі. Нові операції
            заблоковано.
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
        <p role="alert">{adjustmentErrorText(adjustmentCommand.error)}</p>
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
            Нові операції заблоковано.
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
        <p role="alert">{countErrorText(countCommand.error)}</p>
      )}
      {pending && (
        <section className="notice">
          <h3>{busy ? "Перевіряємо результат…" : "Незавершена операція"}</h3>
          <p>
            {pending.label}. До підтвердження результату нові операції
            заблоковано.
          </p>
          <p>{keptText(pending.since, me.display_name)}</p>
          <button disabled={busy} onClick={checkOrder}>
            {pending.acknowledged
              ? "Оновити результат"
              : "Повторити ту саму команду"}
          </button>
        </section>
      )}
      {error !== null && (
        <p role="alert">{orderErrorText(error, orderResent)}</p>
      )}
      {tab === "sale" ? (
        store.permissions.includes("sale:create") ? (
          <Sale
            key={saleEpoch}
            store={store}
            token={token}
            journalKey={saleKey}
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
              cashUnsettled
            }
            {...fixFromReceipt}
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
        ) : (
          <p role="alert">Немає права приймати повернення.</p>
        )
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
        ) : (
          <p role="alert">Немає доступу до боргів.</p>
        )
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
            person={me.display_name}
          />
        ) : (
          <p role="alert">Немає доступу до каси.</p>
        )
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
            }}
          >
            ← До списку
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
              store={store}
              blocked={blocked}
              refresh={() => {
                void detail.refetch();
              }}
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
        <section>
          <div className="toolbar">
            <h2>Замовлення магазину</h2>
            <button
              className="quiet"
              onClick={() => {
                void list.refetch();
              }}
            >
              Оновити
            </button>
          </div>
          {store.permissions.includes("sale:view") && (
            <form
              className="search"
              onSubmit={(event) => {
                event.preventDefault();
                setWaybillSearch(waybillQuery.trim());
                setOffset(0);
              }}
            >
              <label>
                Пошук за номером накладної
                <input
                  type="search"
                  value={waybillQuery}
                  maxLength={64}
                  onChange={(event) => {
                    setWaybillQuery(event.target.value);
                  }}
                />
              </label>
              <button type="submit">Знайти</button>
            </form>
          )}
          {!store.permissions.includes("sale:view") ? (
            <p>Немає права переглядати замовлення.</p>
          ) : list.isPending ? (
            <p role="status">Завантажуємо…</p>
          ) : list.error ? (
            <Failure
              error={list.error}
              retry={() => {
                void list.refetch();
              }}
            />
          ) : (
            <>
              {list.data.orders.length === 0 && (
                <p>
                  {waybillSearch
                    ? "Замовлень із такою накладною не знайдено."
                    : "Поки немає замовлень. Створіть перше, щоб зарезервувати товар."}
                </p>
              )}
              {list.data.orders.map((order) => (
                <button
                  className="order-card"
                  key={order.id}
                  onClick={() => {
                    setSelectedId(order.id);
                  }}
                >
                  <span className="badge">{statusLabels[order.status]}</span>
                  <strong>
                    {order.items
                      .map((item) => visible(item.display_name))
                      .join(", ")}
                  </strong>
                  <span>
                    {order.items.reduce((n, item) => n + item.quantity, 0)} шт.
                    · {money(order.total)}
                  </span>
                  <span>{shippingText(order)}</span>
                  <small>
                    № {order.id.slice(0, 8)} ·{" "}
                    {order.created_at
                      ? new Date(order.created_at).toLocaleDateString("uk-UA")
                      : ""}
                  </small>
                </button>
              ))}
              <div className="toolbar">
                <button
                  className="quiet"
                  disabled={offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - 50));
                  }}
                >
                  Попередні
                </button>
                <button
                  className="quiet"
                  disabled={!list.data.has_more}
                  onClick={() => {
                    setOffset(offset + 50);
                  }}
                >
                  Наступні
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
/**
 * A card operation whose answer was lost, confirmed — maybe by the phone
 * itself, minutes or hours after the press. Following the paper text, the
 * seller may have charged the terminal meanwhile, so it says to charge it
 * only if nobody did (owner decision, 2026-10-07; ADR-0013 §5.6, G19).
 */
/**
 * A kept payment typed from paper, confirmed: what the till says of money
 * taken during the outage, by its way (ADR-0021) — never to charge again.
 */
function paidOnPaper(way: PaymentMethod | null): string {
  const paid = way === null ? null : paidDuringOutage(way);
  return paid === null
    ? ""
    : ` ${paid.charAt(0).toUpperCase()}${paid.slice(1)}.`;
}

function chargeOnce(amount: string): string {
  return `Якщо картку ще не провели — проведіть на терміналі ${money(amount)}. Якщо вже провели, поки сервер не відповідав, — не проводьте вдруге.`;
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
  const paid = mark !== null && way !== null ? paidDuringOutage(way) : null;
  return (
    <>
      {mark && <p className="badge">{markText(mark)}</p>}
      <p>
        Операцію було записано. Разом {money(sale.total)}
        {way ? ` ${methodHow[way]}` : ""}
        {paid !== null && ` — ${paid}`}. Повторно вона не пройде.
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
      <button onClick={retry}>Повторити</button>
    </div>
  );
}
const actionLabels: Record<string, string> = {
  shipping: "Зміна доставки",
  dispatch: "Відправлено",
  arrive: "Прибув на пошту",
  collect: "Клієнт забрав",
  cancel: "Скасувати замовлення",
  return: "Прийняти повернення",
};
function OrderDetail({
  order,
  store,
  blocked,
  action,
  refresh,
}: {
  order: Order;
  store: Store;
  blocked: boolean;
  action: (action: string, extra?: Record<string, unknown>) => void;
  refresh: () => void;
}): JSX.Element {
  const hint = useId();
  const [reason, setReason] = useState("");
  const [received, setReceived] = useState(false);
  const [returning, setReturning] = useState(false);
  // Collected and paid in parts, as at the till (owner decision, 2026-10-01).
  const [credit, setCredit] = useState<TermsInput>(noTerms);
  // How it was paid, said at «Клієнт забрав»; nothing chosen for the seller
  // (owner decisions, 2026-10-04). In parts, the way of the part paid now.
  const [way, setWay] = useState<PaymentMethod | null>(null);
  const [problem, setProblem] = useState("");
  // The waybill, or abroad where and how it went, written as it is sent.
  const [sentWith, setSentWith] = useState("");
  const [changingShipping, setChangingShipping] = useState(false);
  const mayCredit = store.permissions.includes("sale:credit");
  const open = ["READY_TO_DISPATCH", "DISPATCHED", "ARRIVED"].includes(
    order.status,
  );
  const next = {
    READY_TO_DISPATCH: "dispatch",
    DISPATCHED: "arrive",
    ARRIVED: "collect",
  }[order.status as "READY_TO_DISPATCH" | "DISPATCHED" | "ARRIVED"];
  return (
    <section>
      <div className="toolbar">
        <h2>Замовлення № {order.id.slice(0, 8)}</h2>
        <button className="quiet" onClick={refresh}>
          Оновити
        </button>
      </div>
      <span className="badge">{statusLabels[order.status]}</span>
      <p>Доставка: {shippingText(order)}</p>
      {order.same_waybill && order.same_waybill.length > 0 && (
        <p className="notice">
          Ця накладна є також у замовленні №{" "}
          {order.same_waybill.map((other) => other.id.slice(0, 8)).join(", № ")}
          . Збережено — перевірте, чи це один пакунок.
        </p>
      )}
      {order.items.map((item) => (
        <div className="line" key={item.id}>
          <strong>{visible(item.display_name)}</strong>
          <span>
            Розмір: {visible(item.size_label ?? "Не вказано")} · {item.quantity}{" "}
            шт.
          </span>
          <span>
            {money(item.unit_price)} за одиницю
            {kopecks(item.discount_amount) !== 0n
              ? ` · знижка ${money(item.discount_amount)}`
              : ""}
          </span>
        </div>
      ))}
      <p className="total">
        Разом <strong>{money(order.total)}</strong>
      </p>
      <p className="hint">{collectHint}</p>
      {order.sale_id && (
        <p role="status">
          Продаж зафіксовано.
          {order.payment_method
            ? ` Оплачено ${methodHow[order.payment_method]}.`
            : ""}
        </p>
      )}
      {order.credit && (
        <p>
          Оплата частинами: сплачено {money(order.credit.paid)}, клієнт винен{" "}
          {money(order.credit.owed)}. Наступні внески — у розділі «Борги».
        </p>
      )}
      {next === "collect" && store.permissions.includes("sale:create") && (
        <fieldset disabled={blocked}>
          <legend>Як оплачено замовлення</legend>
          {collectMethods.map((choice) => (
            <label className="check" key={choice.method}>
              <input
                type="radio"
                name="collect-way"
                checked={way === choice.method}
                onChange={() => {
                  setWay(choice.method);
                  setProblem("");
                }}
              />
              {choice.label}
            </label>
          ))}
        </fieldset>
      )}
      {next === "collect" &&
        mayCredit &&
        store.permissions.includes("sale:create") && (
          <fieldset disabled={blocked}>
            <legend>Оплата</legend>
            <TermsFields
              value={credit}
              change={(value) => {
                setCredit(value);
                setProblem("");
              }}
              total={kopecks(order.total) ?? 0n}
              hint="Клієнт забирає замовлення, сплачує частину зараз, решту винен цьому магазину. Наступні внески — у розділі «Борги»."
            />
          </fieldset>
        )}
      {next === "dispatch" &&
        order.destination &&
        store.permissions.includes("sale:create") && (
          <label>
            {order.destination === "ABROAD"
              ? "Куди і як відправили: місто, країна, спосіб"
              : "Номер накладної"}{" "}
            (можна дописати пізніше)
            <input
              value={sentWith}
              maxLength={order.destination === "ABROAD" ? 1000 : 64}
              disabled={blocked}
              aria-describedby={
                order.destination === "ABROAD" ? `${hint}-sent` : undefined
              }
              onChange={(event) => {
                setSentWith(event.target.value);
              }}
            />
            {order.destination === "ABROAD" && (
              <NoCustomerData id={`${hint}-sent`} />
            )}
          </label>
        )}
      {problem && <p role="alert">{problem}</p>}
      <div className="actions">
        {next && store.permissions.includes("sale:create") && (
          <button
            disabled={blocked}
            onClick={() => {
              if (next === "dispatch") {
                const written = sentWith.trim();
                action(
                  "dispatch",
                  written
                    ? order.destination === "ABROAD"
                      ? { abroad_note: written }
                      : { waybill: written }
                    : undefined,
                );
                return;
              }
              if (next !== "collect") {
                action(next);
                return;
              }
              if (way === null) {
                setProblem(collectNeedsMethod);
                return;
              }
              if (!credit.inParts) {
                action(next, { payment_method: way });
                return;
              }
              const terms = checkTerms(credit, kopecks(order.total) ?? 0n);
              if (typeof terms === "string") setProblem(terms);
              else action(next, { payment_method: way, credit: terms });
            }}
          >
            {actionLabels[next]}
          </button>
        )}
        {order.status === "READY_TO_DISPATCH" &&
          store.permissions.includes("sale:create") && (
            <button
              className="quiet"
              disabled={blocked}
              onClick={() => {
                action("cancel");
              }}
            >
              Скасувати та звільнити резерв
            </button>
          )}
        {["DISPATCHED", "ARRIVED"].includes(order.status) &&
          store.permissions.includes("sale:refund") &&
          store.permissions.includes("inventory:receive") && (
            <button
              className="quiet"
              disabled={blocked}
              onClick={() => {
                setReturning(!returning);
              }}
            >
              Товар повернувся на склад
            </button>
          )}
      </div>
      {open &&
        store.permissions.includes("sale:create") &&
        (changingShipping ? (
          <ShippingForm
            order={order}
            blocked={blocked}
            cancel={() => {
              setChangingShipping(false);
            }}
            save={(shipping) => {
              action("shipping", shipping);
            }}
          />
        ) : (
          <button
            className="quiet"
            disabled={blocked}
            onClick={() => {
              setChangingShipping(true);
            }}
          >
            Змінити доставку
          </button>
        ))}
      {order.shipping_history && order.shipping_history.length > 0 && (
        <>
          <h3>Історія доставки</h3>
          <ul aria-label="Історія доставки">
            {order.shipping_history.map((change, index) => (
              <li key={`${change.at}:${String(index)}`}>
                {new Date(change.at).toLocaleString("uk-UA", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}{" "}
                · {shippingKinds[change.kind]} · {shippingText(change)} ·{" "}
                {visible(change.by)}
              </li>
            ))}
          </ul>
        </>
      )}
      {returning && ["DISPATCHED", "ARRIVED"].includes(order.status) && (
        <fieldset disabled={blocked}>
          <legend>Фізичне повернення всього замовлення</legend>
          <p>Товар повернеться на ті склади, звідки його відправили.</p>
          <label>
            Причина повернення
            <textarea
              maxLength={1000}
              value={reason}
              aria-describedby={`${hint}-return`}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
            <NoCustomerData id={`${hint}-return`} />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={received}
              onChange={(e) => {
                setReceived(e.target.checked);
              }}
            />
            Усі товари фізично отримані на складах відправлення
          </label>
          <button
            disabled={!received || !reason.trim()}
            onClick={() => {
              action("return", {
                reason: reason.trim(),
                physically_received: true,
              });
            }}
          >
            Прийняти повернення
          </button>
        </fieldset>
      )}
    </section>
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
              <option value="">Оберіть склад явно</option>
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
                      {visible(item.display_name)} · {visible(item.size_label)}{" "}
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
            Домовлена ціна за одиницю, грн
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
              Видалити {visible(d.name)}
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

/** Within Ukraine by one of three carriers, or abroad. */
function DestinationFields({
  destination,
  carrier,
  change,
}: {
  destination: Destination;
  carrier: Carrier | "";
  change: (destination: Destination, carrier: Carrier | "") => void;
}): JSX.Element {
  return (
    <div className="fields">
      <label>
        Куди
        <select
          value={destination}
          onChange={(event) => {
            const next = event.target.value as Destination;
            change(next, next === "UKRAINE" ? carrier : "");
          }}
        >
          <option value="UKRAINE">По Україні</option>
          <option value="ABROAD">За кордон</option>
        </select>
      </label>
      {destination === "UKRAINE" && (
        <label>
          Перевізник
          <select
            value={carrier}
            onChange={(event) => {
              change("UKRAINE", event.target.value as Carrier | "");
            }}
          >
            <option value="">Оберіть перевізника</option>
            {(Object.keys(carrierLabels) as Carrier[]).map((key) => (
              <option key={key} value={key}>
                {carrierLabels[key]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

const shippingKinds: Record<ShippingChange["kind"], string> = {
  CREATED: "Вказано при створенні",
  DISPATCHED: "Вписано при відправленні",
  CORRECTED: "Змінено",
};

/** Where an open order goes, as it should stand: corrected or written later.
 * Every earlier version stays in its history (owner decision, 2026-10-01). */
function ShippingForm({
  order,
  blocked,
  cancel,
  save,
}: {
  order: Order;
  blocked: boolean;
  cancel: () => void;
  save: (shipping: Record<string, unknown>) => void;
}): JSX.Element {
  const hint = useId();
  const [destination, setDestination] = useState<Destination>(
    order.destination ?? "UKRAINE",
  );
  const [carrier, setCarrier] = useState<Carrier | "">(order.carrier ?? "");
  const [waybill, setWaybill] = useState(order.waybill ?? "");
  const [note, setNote] = useState(order.abroad_note ?? "");
  const [problem, setProblem] = useState("");
  return (
    <fieldset disabled={blocked}>
      <legend>Доставка</legend>
      <DestinationFields
        destination={destination}
        carrier={carrier}
        change={(nextDestination, nextCarrier) => {
          setDestination(nextDestination);
          setCarrier(nextCarrier);
          setProblem("");
        }}
      />
      {destination === "UKRAINE" ? (
        <label>
          Номер накладної
          <input
            value={waybill}
            maxLength={64}
            onChange={(event) => {
              setWaybill(event.target.value);
            }}
          />
        </label>
      ) : (
        <label>
          Куди і як відправили: місто, країна, спосіб
          <textarea
            value={note}
            maxLength={1000}
            aria-describedby={hint}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <NoCustomerData id={hint} />
        </label>
      )}
      {problem && <p role="alert">{problem}</p>}
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            if (destination === "UKRAINE" && carrier === "") {
              setProblem("Оберіть перевізника.");
              return;
            }
            save(
              destination === "UKRAINE"
                ? {
                    destination,
                    carrier,
                    ...(waybill.trim() ? { waybill: waybill.trim() } : {}),
                  }
                : {
                    destination,
                    ...(note.trim() ? { abroad_note: note.trim() } : {}),
                  },
            );
          }}
        >
          Зберегти доставку
        </button>
        <button type="button" className="quiet" onClick={cancel}>
          Скасувати
        </button>
      </div>
    </fieldset>
  );
}
