import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorText } from "@/shared/api";
import {
  connectTelegram,
  telegramInitData,
  telegramUserId,
} from "@/shared/telegram";
import { loadPending, submitPending, useCommand } from "@/orders/commands";
import type { Pending } from "@/orders/commands";
import {
  asShown,
  decimal,
  kopecks,
  money,
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
} from "@/orders/types";
import { Stock } from "@/inventory/Stock";
import { Catalog } from "@/catalog/Catalog";
import { loadCatalogCommand, useCatalogCommand } from "@/catalog/commands";
import { Sale } from "@/sales/Sale";
import { loadSale, resolve, useSaleCommand } from "@/sales/commands";
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
import { Backups, useBackups } from "@/backups/Backups";
import { Done as ReturnDone, Returns } from "@/returns/Returns";
import type { Refund } from "@/returns/types";
import { Credits } from "@/credits/Credits";
import {
  loadCreditCommand,
  resolveCreditCommand,
  useCreditCommand,
} from "@/credits/commands";
import type { Credit } from "@/credits/types";
import { TermsFields, checkTerms, noTerms } from "@/credits/Terms";
import type { TermsInput } from "@/credits/Terms";
import { Damaged } from "@/damaged/Damaged";
import { Openings } from "@/openings/Openings";
import { Stores } from "@/stores/Stores";
import { Invoices } from "@/suppliers/Invoices";
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
import "./styles.css";

async function authenticate(): Promise<{ token: string; me: Me }> {
  const initData = telegramInitData();
  if (!initData) throw new Error("TELEGRAM_REQUIRED");
  const auth = await api<{ access_token: string }>(
    "/auth/telegram",
    undefined,
    { init_data: initData },
  );
  return {
    token: auth.access_token,
    me: await api<Me>("/me", auth.access_token),
  };
}
export function App(): JSX.Element {
  useEffect(connectTelegram, []);
  const auth = useQuery({
    queryKey: ["session"],
    queryFn: authenticate,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const [storeId, setStoreId] = useState("");
  if (auth.isPending)
    return (
      <main>
        <h1>birka</h1>
        <p role="status">Входимо в магазин…</p>
      </main>
    );
  if (auth.error instanceof ApiError && auth.error.code === "NO_ACCESS")
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
        <button
          onClick={() => {
            void auth.refetch();
          }}
        >
          Спробувати ще раз
        </button>
      </main>
    );
  if (auth.error)
    return (
      <main>
        <h1>birka</h1>
        <h2>Вхід через Telegram</h2>
        <p role="alert">
          {auth.error.message === "TELEGRAM_REQUIRED"
            ? "Відкрийте застосунок кнопкою в Telegram-боті вашого магазину."
            : errorText(auth.error)}
        </p>
        <button
          onClick={() => {
            void auth.refetch();
          }}
        >
          Спробувати ще раз
        </button>
      </main>
    );
  const store = auth.data.me.stores.find((s) => s.id === storeId);
  return (
    <main>
      <header>
        <div>
          <span className="eyebrow">РОБОЧЕ МІСЦЕ ПРОДАВЦЯ</span>
          <h1>
            birka <span> / магазин</span>
          </h1>
        </div>
        <span>{auth.data.me.display_name}</span>
      </header>
      {!store ? (
        <section>
          <h2>Оберіть магазин</h2>
          <p>Продаж буде записано на обраний магазин. Склад оберете окремо.</p>
          {auth.data.me.stores.length === 0 ? (
            <p>Доступних магазинів немає. Зверніться до адміністратора.</p>
          ) : (
            auth.data.me.stores.map((s) => (
              <button
                className="store"
                key={s.id}
                onClick={() => {
                  setStoreId(s.id);
                }}
              >
                {s.name}
                <small>{s.code}</small>
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
            <h2>{store.name}</h2>
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
          <button
            onClick={() => {
              void auth.refetch();
            }}
          >
            Оновити
          </button>
        </section>
      ) : (
        <Workspace
          key={store.id}
          store={asShown(store)}
          token={auth.data.token}
          me={auth.data.me}
          changeStore={() => {
            setStoreId("");
          }}
          storesChanged={() => {
            void auth.refetch();
          }}
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
  const backupsNeedYou =
    backups.data !== undefined && backups.data.state !== "OK";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
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
      if (saved) setTab("receive");
    } catch {
      setReceiptStorageError(true);
    }
  }, [receiptKey]);
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
      if (saved) setTab("stock");
    } catch {
      setAdjustmentStorageError(true);
    }
  }, [adjustmentKey]);
  const returnKey = `birka:return-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [returnStorageError, setReturnStorageError] = useState(false);
  const returnCommand = useReturnCommand();
  useEffect(() => {
    try {
      const saved = loadReturn(returnKey);
      useReturnCommand.setState({ pending: saved, error: null });
      if (saved) setTab("returns");
    } catch {
      setReturnStorageError(true);
    }
  }, [returnKey]);
  // A return is looked up in the store's sales, so it needs both.
  const canReturn =
    store.permissions.includes("sale:refund") &&
    store.permissions.includes("sale:view");
  // A return whose outcome was unknown, settled: what to give back.
  const [returnSettled, setReturnSettled] = useState<Refund | null>(null);
  // Sales paid in parts: whoever sells that way takes the payments.
  const canSeeCredits = store.permissions.includes("sale:credit");
  const creditKey = `birka:credit-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [creditStorageError, setCreditStorageError] = useState(false);
  const creditCommand = useCreditCommand();
  // A payment or write-off whose outcome was unknown, settled.
  const [creditSettled, setCreditSettled] = useState<{
    kind: "payment" | "write-off";
    credit: Credit;
  } | null>(null);
  // Bumped to remount «Борги» once such a command settles, so no screen
  // keeps showing the debt as it was before it.
  const [creditEpoch, setCreditEpoch] = useState(0);
  useEffect(() => {
    try {
      const saved = loadCreditCommand(creditKey);
      useCreditCommand.setState({ pending: saved, error: null });
      if (saved) setTab("credits");
    } catch {
      setCreditStorageError(true);
    }
  }, [creditKey]);
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
      if (saved) setTab("sale");
    } catch {
      setSaleStorageError(true);
    }
  }, [saleKey]);
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
      useCommand.getState().set(loadPending(key));
    } catch {
      setStorageError(true);
    }
  }, [key]);
  const list = useQuery({
    queryKey: ["orders", store.id, offset],
    queryFn: () =>
      api<{ orders: Order[]; has_more: boolean }>(
        `/orders?store_id=${store.id}&limit=50&offset=${String(offset)}`,
        token,
      ),
    enabled: store.permissions.includes("sale:view"),
  });
  const detail = useQuery({
    queryKey: ["order", store.id, selectedId],
    queryFn: () => api<Order>(`/orders/${selectedId ?? ""}`, token),
    enabled: selectedId !== null,
  });
  async function run(command: Pending): Promise<void> {
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
  // Every journal but the stock correction's and the store states' own,
  // which their screens read themselves.
  const othersUnsettled =
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
  const otherThanAdjustment =
    othersUnsettled || storesUnsettled || supplierUnsettled || invoiceUnsettled;
  const adjustmentUnsettled =
    adjustmentStorageError ||
    adjustmentCommand.busy ||
    adjustmentCommand.pending !== null;
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
  const blocked = otherThanAdjustment || adjustmentUnsettled;
  return (
    <>
      <div className="toolbar">
        <h2>{store.name}</h2>
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
          <button
            disabled={saleCommand.busy}
            onClick={() => {
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
                }
              });
            }}
          >
            Перевірити результат продажу
          </button>
        </section>
      )}
      {settled && (
        <section className="notice" role="status">
          <h3>Продаж підтверджено</h3>
          <p>
            Операцію було записано. Разом {money(settled.total)}. Повторно вона
            не пройде.
          </p>
          {settled.credit && (
            <p>
              Оплата частинами: сплачено зараз {money(settled.credit.paid_now)},
              покупець винен {money(settled.credit.owed)}.
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
        <p role="alert">{errorText(saleCommand.error)}</p>
      )}
      {receiptStorageError && (
        <p role="alert">
          Не вдалося прочитати збережене приймання. Не очищайте дані
          застосунку; зверніться до менеджера.
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
          <button
            disabled={receiptCommand.busy}
            onClick={() => {
              const attempt = receiptCommand.pending;
              if (attempt) void resolveReceipt(receiptKey, token, attempt);
            }}
          >
            Перевірити результат приймання
          </button>
        </section>
      )}
      {receiptCommand.error !== null && (
        <p role="alert">{errorText(receiptCommand.error)}</p>
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
          <button
            disabled={returnCommand.busy}
            onClick={() => {
              const attempt = returnCommand.pending;
              if (!attempt) return;
              void resolveReturn(returnKey, token, attempt).then((outcome) => {
                if (outcome.kind === "done") {
                  setReturnSettled(outcome.result);
                  void cache.invalidateQueries({
                    queryKey: ["store-sales", store.id],
                  });
                  void cache.invalidateQueries({
                    queryKey: ["credits", store.id],
                  });
                }
              });
            }}
          >
            Перевірити результат повернення
          </button>
        </section>
      )}
      {returnSettled && (
        <section className="notice">
          <ReturnDone refund={returnSettled} />
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
        <p role="alert">{errorText(returnCommand.error)}</p>
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
          <button
            disabled={creditCommand.busy}
            onClick={() => {
              const attempt = creditCommand.pending;
              if (!attempt) return;
              void resolveCreditCommand(creditKey, token, attempt).then(
                (outcome) => {
                  if (outcome.kind === "done") {
                    setCreditSettled({
                      kind: attempt.body.kind,
                      credit: outcome.result,
                    });
                    setCreditEpoch((epoch) => epoch + 1);
                    void cache.invalidateQueries({
                      queryKey: ["credits", store.id],
                    });
                  }
                },
              );
            }}
          >
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
            Його було записано один раз. {creditSettled.credit.customer_name}:
            залишок боргу {money(creditSettled.credit.owed)}.
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
        <p role="alert">{errorText(creditCommand.error)}</p>
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
          <button
            disabled={adjustmentCommand.busy}
            onClick={() => {
              const attempt = adjustmentCommand.pending;
              if (!attempt) return;
              void resolveAdjustment(adjustmentKey, token, attempt).then(
                (outcome) => {
                  if (outcome.kind === "done") {
                    setAdjustmentSettled(outcome.result);
                    void cache.invalidateQueries({
                      queryKey: ["inventory-stock"],
                    });
                  }
                },
              );
            }}
          >
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
        <p role="alert">{errorText(adjustmentCommand.error)}</p>
      )}
      {pending && (
        <section className="notice">
          <h3>{busy ? "Перевіряємо результат…" : "Незавершена операція"}</h3>
          <p>
            {pending.label}. До підтвердження результату нові операції
            заблоковано.
          </p>
          <button
            disabled={busy}
            onClick={() => {
              void run(pending);
            }}
          >
            {pending.acknowledged
              ? "Оновити результат"
              : "Повторити ту саму команду"}
          </button>
        </section>
      )}
      {error !== null && <p role="alert">{errorText(error)}</p>}
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
              creditUnsettled
            }
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
              creditUnsettled
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
            blocked={otherThanAdjustment || adjustmentStorageError}
          />
        ) : (
          <p role="alert">Немає доступу до залишків.</p>
        )
      ) : tab === "returns" ? (
        canReturn ? (
          <Returns
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
              creditUnsettled
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
              returnUnsettled
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
          submit={(lines) => {
            void run({
              path: "/orders",
              body: {
                store_id: store.id,
                command_id: crypto.randomUUID(),
                lines,
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
                  Поки немає замовлень. Створіть перше, щоб зарезервувати товар.
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
                    {order.items.map((item) => item.display_name).join(", ")}
                  </strong>
                  <span>
                    {order.items.reduce((n, item) => n + item.quantity, 0)} шт.
                    · {money(order.total)}
                  </span>
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
  const [reason, setReason] = useState("");
  const [received, setReceived] = useState(false);
  const [returning, setReturning] = useState(false);
  // Collected and paid in parts, as at the till (owner decision, 2026-10-01).
  const [credit, setCredit] = useState<TermsInput>(noTerms);
  const [problem, setProblem] = useState("");
  const mayCredit = store.permissions.includes("sale:credit");
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
      {order.items.map((item) => (
        <div className="line" key={item.id}>
          <strong>{item.display_name}</strong>
          <span>
            Розмір: {item.size_label ?? "Не вказано"} · {item.quantity} шт.
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
      <p className="hint">
        Продаж фіксуємо, коли клієнт забрав товар. Цей статус не підтверджує
        оплату.
      </p>
      {order.sale_id && <p role="status">Продаж зафіксовано.</p>}
      {order.credit && (
        <p>
          Оплата частинами: сплачено {money(order.credit.paid)}, клієнт винен{" "}
          {money(order.credit.owed)}. Наступні внески — у розділі «Борги».
        </p>
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
      {problem && <p role="alert">{problem}</p>}
      <div className="actions">
        {next && store.permissions.includes("sale:create") && (
          <button
            disabled={blocked}
            onClick={() => {
              if (next !== "collect" || !credit.inParts) {
                action(next);
                return;
              }
              const terms = checkTerms(credit, kopecks(order.total) ?? 0n);
              if (typeof terms === "string") setProblem(terms);
              else action(next, { credit: terms });
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
      {returning && ["DISPATCHED", "ARRIVED"].includes(order.status) && (
        <fieldset disabled={blocked}>
          <legend>Фізичне повернення всього замовлення</legend>
          <p>Товар повернеться на ті склади, звідки його відправили.</p>
          <label>
            Причина повернення
            <textarea
              maxLength={1000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
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
  submit: (lines: Line[]) => void;
}): JSX.Element {
  const [locationId, setLocationId] = useState("");
  const [offset, setOffset] = useState(0);
  const [option, setOption] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [validation, setValidation] = useState("");
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
                  {l.name}
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
                      {item.display_name} · {item.size_label} · доступно{" "}
                      {item.available_quantity}
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
              {d.name} · {d.size}
            </strong>
            <span>
              {d.warehouse} · {d.line.quantity} × {money(d.line.unit_price)}
            </span>
            <button
              className="quiet"
              onClick={() => {
                setDraft(draft.filter((_, i) => i !== index));
              }}
            >
              Видалити {d.name}
            </button>
          </div>
        ))}
        <p className="total">
          Разом <strong>{money(decimal(total))}</strong>
        </p>
        <button
          disabled={draft.length === 0}
          onClick={() => {
            submit(draft.map((d) => d.line));
          }}
        >
          Замовити та зарезервувати
        </button>
      </fieldset>
    </section>
  );
}
