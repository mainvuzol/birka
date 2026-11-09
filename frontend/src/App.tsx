import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps, JSX } from "react";
import { flushSync } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryObserverResult } from "@tanstack/react-query";
import {
  api,
  ApiError,
  errorText,
  inOwnWords,
  UNREACHABLE,
} from "@/shared/api";
import { isTillMethod, methodHow, methodLabels } from "@/shared/payment";
import type { PaymentMethod, TillMethod } from "@/shared/payment";
import {
  keptCashText,
  keptText,
  noteChecked,
  useAutoCheck,
  useReach,
  waitsText,
} from "@/shared/reach";
import { setScreen } from "@/shared/report";
import { visible } from "@/shared/visible";
import { Opening } from "@/shared/Placeholder";
import { Icon } from "@/shared/Icon";
import { Toast } from "@/shared/Toast";
import { Banner } from "@/shared/Banner";
import { CheckLine, Kept, Settled } from "@/shared/Kept";
import {
  buzz,
  connectTelegram,
  telegramInitData,
  telegramUserId,
  telegramUserName,
  useAskBeforeClosing,
  useLockPortrait,
} from "@/shared/telegram";
import { loadPending, submitPending, useCommand } from "@/orders/commands";
import type { Pending } from "@/orders/commands";
import {
  CardPlaceholder,
  OrderDetail,
  actionLabels,
  stepDone,
  stepShown,
} from "@/orders/Order";
import { placesRead } from "@/orders/Returned";
import { Send } from "@/orders/Send";
import { Shipping } from "@/orders/Shipping";
import { Collect } from "@/orders/Collect";
import { chargeOnce } from "@/orders/Collected";
import { NewOrder } from "@/orders/NewOrder";
import { Orders, freshOrdersView } from "@/orders/Orders";
import { Unread } from "@/shared/Unread";
import { ModeSwitch } from "@/shared/ModeSwitch";
import { BlankTag } from "@/shared/BlankTag";
import type { OrdersView } from "@/orders/Orders";
import { asShown, money, stateText } from "@/orders/types";
import type { Me, Store, Order } from "@/orders/types";
import { Stock } from "@/inventory/Stock";
import { Model } from "@/inventory/Model";
import type { Opened } from "@/inventory/Model";
import { Stocktaking } from "@/inventory/Stocktaking";
import { DamagedMeta } from "@/inventory/Goods";
import { TabBar } from "@/shared/TabBar";
import { Back } from "@/shared/Back";
import { ScreenHeader, WorkspaceLineContext } from "@/shared/ScreenHeader";
import type { WorkspaceLine } from "@/shared/ScreenHeader";
import type { TabItem } from "@/shared/TabBar";
import { More } from "@/shared/More";
import {
  ApprovalsLine,
  BackupsLine,
  DebtsLine,
  useAwaitingApproval,
} from "@/shared/MoreLines";
import type { IconName } from "@/shared/icons";
import type { MoreBack, MoreGroup, MoreRow } from "@/shared/More";
import { Catalog } from "@/catalog/Catalog";
import {
  loadCatalogCommand,
  useCatalogCommand,
  useCatalogJournal,
} from "@/catalog/commands";
import { Sale } from "@/sales/Sale";
import {
  attemptSum,
  loadSale,
  resolve,
  useSaleCommand,
} from "@/sales/commands";
import type { SaleAttempt } from "@/sales/commands";
import { clearPaper, setPaper, usePaper } from "@/sales/paper";
import { forgetBasket, useBasketGoods } from "@/sales/basket";
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
import {
  Invoices,
  doneText as invoiceDoneText,
  refusalText as invoiceRefusalText,
} from "@/suppliers/Invoices";
import type { InvoiceOpening } from "@/suppliers/Invoices";
import {
  Borrowed,
  refusalText as borrowedRefusalText,
} from "@/suppliers/Borrowed";
import { invoiceKept, keptSaid, supplierReturnKept } from "@/suppliers/kept";
import type { Invoice, InvoiceBody, SupplierReturn } from "@/suppliers/types";
import { Models } from "@/catalog/Models";
import {
  loadCorrectionCommand,
  useCorrectionCommand,
} from "@/catalog/modelCommands";
import { SalesReport } from "@/reports/SalesReport";
import { History } from "@/cash/History";
import { Money } from "@/money/Money";
import type { Period } from "@/money/reads";
import { Today } from "@/today/Today";
import type { Phoned } from "@/today/Search";
import { useWaiting } from "@/today/waiting";
import {
  loadInvoiceCommand,
  resolveInvoiceCommand,
  useInvoiceCommand,
} from "@/suppliers/invoiceCommands";
import {
  Suppliers,
  refusalText as supplierRefusalText,
  returnedText,
} from "@/suppliers/Suppliers";
import {
  loadReturnToSupplier,
  resolveReturnToSupplier,
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
  movedOn,
  orderErrorText,
  receiptErrorText,
  returnErrorText,
  saleErrorText,
  timeOf,
} from "@/cash/errors";
import "./styles.css";

type Tab =
  /** The day of every store, in one look: the first tab for whoever reads
   * the report (spec S04; «Усе на бірці» task list, P0-6). */
  | "today"
  | "list"
  | "new"
  | "catalog"
  | "stock"
  /** A model's sizes on every warehouse, from its name on the till's
   * search (spec S23; «Усе на бірці» sections task list, P0-6). */
  | "model"
  /** «Ще» › «Товар» › «Інвентаризація» (sections task list, P1-5). */
  | "stocktaking"
  | "sale"
  | "receive"
  | "returns"
  | "damaged"
  | "openings"
  | "credits"
  /** «Продаж» › «Внесок»: a payment on a debt from the till (spec S08,
   * S21; «Усе на бірці» task list, P0-3). */
  | "deposit"
  | "backups"
  | "stores"
  | "suppliers"
  /** «Ще» › «Гроші» › «Позичене й під реалізацію», and «Постачальникам»'s
   * row (stage 2, money task list, P0-5). */
  | "borrowed"
  | "invoices"
  | "report"
  | "models"
  | "cash"
  /** Where the money is now, and what came in: a tab for whoever reads the
   * report (spec S29; «Усе на бірці» sections task list, P0-7). */
  | "money"
  /** «Гроші» › «Закриття»: the open store's closes. */
  | "closes"
  /** «Ще»'s own screen, its groups (navigation task list, P0-4). */
  | "more"
  /** «Ще» › «Товар» › «Товар і каталог», for whoever has two of its
   * screens or more («Усе на бірці» task list, P0-4). */
  | "catalogue";

/** The token, and when the session it opens ends by this phone's clock. */
interface Session {
  token: string;
  /** The moment the sign-in was asked, plus the session's length: never
   * later than the server ends it. Null when the server names no length. */
  until: number | null;
}

/**
 * Signs in with the launch data Telegram signed, once. The token it gives is
 * what every later request carries: a seller stays signed in for 12 hours
 * after opening the app (owner decision, 2026-10-03). The launch data itself
 * is taken for an hour only, so sending it again later would end a session
 * that still has hours to run. How long the session lasts is kept, for
 * «Ще»'s foot to say until when («Усе на бірці» task list, P1-5).
 */
async function signIn(): Promise<Session> {
  const initData = telegramInitData();
  if (!initData) throw new Error("TELEGRAM_REQUIRED");
  const asked = Date.now();
  const auth = await api<{ access_token: string; expires_in?: unknown }>(
    "/auth/telegram",
    undefined,
    { init_data: initData },
  );
  return {
    token: auth.access_token,
    until:
      typeof auth.expires_in === "number" &&
      auth.expires_in > 0 &&
      // A length no session has says no end, rather than break «Ще».
      auth.expires_in <= 366 * 24 * 3600
        ? asked + auth.expires_in * 1000
        : null,
  };
}

/** «5820 114 377»: threes from the right, a lone first digit kept with the
 * next three, so the ID is not read as a phone number's groups. */
export function idGroups(id: number): string[] {
  const digits = String(id);
  const groups: string[] = [];
  let end = digits.length;
  while (end > 0) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
    end -= 3;
  }
  if (groups.length > 1 && groups[0]?.length === 1)
    groups.splice(0, 2, `${groups[0]}${groups[1] ?? ""}`);
  return groups;
}

/** «ОР» of «Ольга Руденко»: the first letters of the first two words. */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => word !== "")
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("")
    .toLocaleUpperCase("uk-UA");
}

/** «Магазин заблоковано власником з 01.10.2026», «Магазин закрито, в архіві
 * з …»: a store that does not trade, to its own people (spec S08). */
function stateTitle(store: Pick<Store, "state" | "state_since">): string {
  const state = stateText(store);
  return `Магазин ${state.charAt(0).toLocaleLowerCase("uk-UA")}${state.slice(1)}`;
}

/**
 * Someone the shop has not added yet (redesign P1-3; spec S03, «Усе на
 * бірці» task list, P1-4). People are added on the server, by their
 * Telegram ID, on the owner's word (owner decision, 2026-10-01); the ID is
 * often taken for a phone number, so it says it is not, stands large in
 * its groups, and is copied — its digits — with one tap where the phone
 * lets the app copy, or selected whole where it does not. No menu, no
 * MainButton: nothing here is anyone's yet.
 */
function NoAccess({
  checkAgain,
}: {
  /** Read again; true while there is still no access. */
  checkAgain: () => Promise<boolean>;
}): JSX.Element {
  const id = telegramUserId();
  const name = telegramUserName();
  const [toast, setToast] = useState<{ text: string; times: number } | null>(
    null,
  );
  const tell = (text: string): void => {
    setToast((now) => ({ text, times: (now?.times ?? 0) + 1 }));
  };
  // Absent outside a secure page, whatever the types say.
  const clipboard = (navigator as { clipboard?: Partial<Clipboard> }).clipboard;
  const write = clipboard?.writeText?.bind(clipboard);
  const failed = "Не вдалося скопіювати — виділіть ID і скопіюйте його.";
  const copy =
    id !== null && write !== undefined
      ? () => {
          try {
            write(String(id)).then(
              () => {
                buzz("success");
                tell("ID скопійовано");
              },
              () => {
                tell(failed);
              },
            );
          } catch {
            tell(failed);
          }
        }
      : null;
  return (
    <main className="before-store">
      {name !== null && (
        <p className="t-meta opened-as">
          <span className="avatar" aria-hidden="true">
            {initialsOf(name)}
          </span>
          <span>Ви відкрили Бірку як {visible(name)}</span>
        </p>
      )}
      <BlankTag>
        <h1 className="t-title-l">Доступу ще немає</h1>
        <p role="alert" className="blank-body">
          Цей акаунт Telegram не має доступу до жодного магазину.
        </p>
        <div className="perforation" aria-hidden="true" />
        {id !== null ? (
          <>
            <p className="t-label telegram-id-label">Ваш Telegram ID</p>
            <p className="telegram-id">
              {/* Apart by their margins, not by spaces: what is selected
                  is the digits alone. */}
              {idGroups(id).map((group, at) => (
                <span key={at}>{group}</span>
              ))}
            </p>
            <p className="t-meta">
              Це не номер телефону. Надішліть його власнику магазину.
            </p>
            {copy && (
              <button type="button" className="copy-id" onClick={copy}>
                <Icon name="copy" />
                Скопіювати ID
              </button>
            )}
          </>
        ) : (
          <p>
            Не вдалося прочитати ваш Telegram ID. Відкрийте застосунок кнопкою в
            боті вашого магазину.
          </p>
        )}
        <p className="t-meta blank-after">
          Коли вас додадуть, закрийте застосунок і відкрийте його знову кнопкою
          в боті.
        </p>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            void checkAgain().then((still) => {
              if (still)
                tell(
                  "Доступу поки немає. Попросіть власника магазину додати ваш ID.",
                );
            });
          }}
        >
          Спробувати ще раз
        </button>
      </BlankTag>
      {/* Present from the start, so a reader hears it filled (review,
          2026-11-01): the toast's own words are not read twice. */}
      <p role="status" className="visually-hidden">
        {toast?.text ?? ""}
      </p>
      {toast && (
        <Toast
          key={toast.times}
          text={toast.text}
          live={false}
          gone={() => {
            setToast(null);
          }}
        />
      )}
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
  const token = session.data?.token;
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
  function reread(): Promise<QueryObserverResult> {
    return token === undefined ? session.refetch() : me.refetch();
  }
  function readAgain(): void {
    void reread();
  }
  // «Спробувати ще раз» on «Доступу ще немає» in flight: the screen stays
  // while it reads — a sign-in read again has nothing to show meanwhile —
  // and says, if so, that there is still no access (spec S03).
  const [asking, setAsking] = useState(false);
  async function checkAgain(): Promise<boolean> {
    setAsking(true);
    try {
      const read = await reread();
      return read.error instanceof ApiError && read.error.code === "NO_ACCESS";
    } finally {
      setAsking(false);
    }
  }
  const failure = session.error ?? me.error;
  // Named while drawn, before anything below can throw: a note of a broken
  // screen says which. A store's own screens name themselves.
  setScreen(me.data === undefined ? "sign-in" : "store-choice");
  if (
    (failure instanceof ApiError && failure.code === "NO_ACCESS") ||
    asking
  )
    return <NoAccess checkAgain={checkAgain} />;
  // A sign-in that failed: the same blank tag, its words as they were
  // («Усе на бірці» task list, P1-4; К12), the app's name over it, where
  // «Доступу ще немає» says whose Telegram opened it (owner, 2026-10-15,
  // В4) — the screen's own title its heading.
  if (failure)
    return (
      <main className="before-store">
        <p className="opened-as app-name">
          <span className="avatar" aria-hidden="true">
            <Icon name="mark" />
          </span>
          <span>Бірка</span>
        </p>
        <BlankTag>
          <h1 className="t-title-l">Вхід через Telegram</h1>
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
                : // Never an order's words at the door (owner decision,
                  // 2026-10-25).
                  inOwnWords(
                    errorText(failure),
                    "Не вдалося увійти. Відкрийте застосунок знову кнопкою в боті вашого магазину.",
                    "Не вдалося увійти. Відкрийте застосунок знову кнопкою в боті вашого магазину.",
                  )}
          </p>
          <button onClick={readAgain}>Спробувати ще раз</button>
        </BlankTag>
      </main>
    );
  // Before the rights are read, a first screen's places and no menu (spec
  // S02; «Усе на бірці» task list, P1-4).
  if (token === undefined || me.data === undefined)
    return (
      <main>
        <Opening />
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
  // No store to choose: one blank tag, the owner the one to ask, as on
  // every screen before a store (spec §6.28; stage 2, admin task list,
  // P2-3).
  if (me.data.stores.length === 0)
    return (
      <main className="before-store">
        <p className="opened-as app-name">
          <span className="avatar" aria-hidden="true">
            <Icon name="mark" />
          </span>
          <span>Бірка</span>
        </p>
        <BlankTag>
          <h1 className="t-title-l">Магазинів поки немає</h1>
          <p className="blank-body">Зверніться до власника.</p>
          <button onClick={readAgain}>Спробувати ще раз</button>
        </BlankTag>
      </main>
    );
  return (
    <main>
      {!store ? (
        // The door (spec S06, its door variant; «Усе на бірці» task list,
        // P1-4; Q-1 «if not»): the question at every opening, nothing
        // chosen beforehand, nothing remembered (В6) — a store's tag each,
        // the whole tag its button, its code under its name (К18).
        <>
          <header className="screen-header">
            <div className="screen-title">
              <h1>Де ви сьогодні?</h1>
            </div>
            <p className="t-meta door-line">
              Продажі запишуться на той магазин, у якому ви зараз.
            </p>
          </header>
          <section className="door">
            {me.data.stores.map((s) => (
              <button
                type="button"
                className="store-tag tag-hero tag-outline"
                key={s.id}
                onClick={() => {
                  // A choice, felt (spec §4.4; «Усе на бірці» task list,
                  // P1-2).
                  buzz("selection");
                  setStoreId(s.id);
                }}
              >
                <span className="store-tag-in">
                  <span className="store-tag-name">{visible(s.name)}</span>
                  <span className="t-meta store-tag-code">
                    {visible(s.code)}
                  </span>
                  {/* Its state in its words, as before, on a sticker. */}
                  {s.state !== "ACTIVE" && (
                    <span className="badge store-tag-state">
                      {stateText(s)}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </section>
        </>
      ) : store.state !== "ACTIVE" && store.permissions.length === 0 ? (
        // Its own people learn the state and since when, never why (owner
        // decision, 2026-10-01).
        <WorkspaceLineContext.Provider
          value={{
            store: store.name,
            person: me.data.display_name,
            changeStore,
            changeHeld: false,
          }}
        >
          {/* One blank tag, its state and since when its title, the line
              over it as on any screen of a store (spec S08; stage 2, admin
              task list, P1-1). Said as a status, never a refusal (stage 2,
              orders task list, P0-2). */}
          <ScreenHeader />
          <BlankTag>
            <h1 className="t-title-l">{stateTitle(store)}</h1>
            <p role="status" className="blank-body">
              Продажі, приймання, повернення й оплати тут зупинено. Зверніться
              до власника.
            </p>
            <button onClick={readAgain}>Спробувати ще раз</button>
          </BlankTag>
        </WorkspaceLineContext.Provider>
      ) : (
        <Workspace
          key={store.id}
          store={asShown(store)}
          token={token}
          me={me.data}
          sessionUntil={session.data?.until ?? null}
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
  sessionUntil,
  changeStore,
  storesChanged,
}: {
  store: Store;
  token: string;
  me: Me;
  /** When this phone's session ends, by its clock; null when unknown. */
  sessionUntil: number | null;
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
  // ends it (ADR-0013 §7); so is the till's basket kept while it is left
  // (navigation task list, P0-5).
  useEffect(
    () => () => {
      clearPaper();
      forgetBasket();
    },
    [],
  );
  const [tab, setTab] = useState<Tab>(
    // «Сьогодні» first for whoever reads the report there — the owner and
    // managers (owner decision, 2026-10-26, В3; «Усе на бірці» task list,
    // §4а) — and the till for whoever sells there (redesign, P0-1): the
    // book is opened at the page of the day's work. Kept operations still
    // turn to their own tab, below.
    store.permissions.includes("report:view_financial")
      ? "today"
      : store.state === "ACTIVE" && store.permissions.includes("sale:create")
        ? "sale"
        : "list",
  );
  // A way of «Продаж» just chosen by its switch: the next screen's switch
  // takes the focus (navigation task list, P0-1; review, 2026-10-26).
  const [modeChosen, setModeChosen] = useState(false);
  const modeFocused = useCallback(() => {
    setModeChosen(false);
  }, []);
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
      // Borrowed goods sent back are «Позичене й під реалізацію»'s (stage
      // 2, money task list, P0-6).
      if (saved) setTab(saved.body.stock_lot_id ? "borrowed" : "suppliers");
    } catch {
      setSupplierStorageError(true);
    }
  }, [supplierKey, canReturnToSupplier]);
  // The sales report: the owner's and managers' (owner decisions,
  // 2026-10-02). It reads every store they hold it in, whichever is open.
  const canSeeReport = store.permissions.includes("report:view_financial");
  const canConfirmCatalog = store.permissions.includes("catalog:confirm");
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
      if (saved) {
        setTab("models");
        // Checked once by itself on «Моделі», as every kept operation
        // (stage 2, goods task list, P1-2).
        loadedFromDisk("correction");
      }
    } catch {
      setCorrectionStorageError(true);
    }
  }, [correctionKey, canCorrect, loadedFromDisk]);
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
      // Borrowed goods marked sold are «Позичене й під реалізацію»'s
      // (stage 2, money task list, P0-6).
      if (saved)
        setTab(
          saved.body.kind === "sold" && canReturnToSupplier
            ? "borrowed"
            : "invoices",
        );
    } catch {
      setInvoiceStorageError(true);
    }
  }, [invoiceKey, canSeeInvoices, canReturnToSupplier]);
  // Either journal's kept operation confirmed: «… записано один раз» until
  // «Зрозуміло», and the screen it was made on opened afresh; refused, in
  // that screen's words while the refusal stands (stage 2, money task list,
  // P0-6).
  const [invoiceSettled, setInvoiceSettled] = useState<{
    invoice: Invoice;
    body: InvoiceBody;
  } | null>(null);
  const [invoiceRefused, setInvoiceRefused] = useState<{
    error: unknown;
    said: string;
  } | null>(null);
  const [supplierSettled, setSupplierSettled] = useState<SupplierReturn | null>(
    null,
  );
  const [supplierRefused, setSupplierRefused] = useState<{
    error: unknown;
    said: string;
  } | null>(null);
  const [suppliersEpoch, setSuppliersEpoch] = useState(0);
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
  // The lists of existing stock that wait for this person's approval here:
  // «Початкові залишки»'s line on «Ще», and «Товар і каталог»'s («Усе на
  // бірці» task list, P1-5).
  const awaitingApproval = useAwaitingApproval(store, token, reportKey);
  // What waits on «Сьогодні», read here too for its tab's badge: the same
  // reads, none where «Сьогодні» is not this person's.
  const work = useWaiting({
    token,
    scopeKey: reportKey,
    stores: canSeeReport ? me.stores : [],
    open: store,
    readsBackups: canSeeReport && canSeeBackups,
  });
  // A section a tag of «Сьогодні» opened goes back there: «← Сьогодні».
  const [fromToday, setFromToday] = useState<Tab | null>(null);
  // «Сьогодні»'s search (frame task list, P2-2): what was typed, kept while
  // what a result opened stands — «Сьогодні» keeps it meanwhile; the
  // customer whose card a result opened, in «Покупці» as they were mounted
  // then; the order.
  const [todayTyped, setTodayTyped] = useState("");
  const [todayCustomer, setTodayCustomer] = useState<{
    customer: Phoned;
    epoch: number;
  } | null>(null);
  const [todayOrder, setTodayOrder] = useState<string | null>(null);
  // So from «Гроші»: «← Гроші»; and «Надійшло»'s period, kept while the
  // report opened on it stands («Усе на бірці» sections task list, P0-7).
  const [fromMoney, setFromMoney] = useState<Tab | null>(null);
  // The suppliers' screens opened from each other (stage 2, money task
  // list, P1-3): «Позичене й під реалізацію» from «Ще», «Постачальникам» or
  // a sold invoice's card, its «←» back there; an invoice opened from a
  // return's set-off or a sold stub, the return to open again on the way
  // back.
  const [borrowedFrom, setBorrowedFrom] = useState<
    "more" | "suppliers" | Invoice
  >("more");
  const [invoiceOpening, setInvoiceOpening] = useState<InvoiceOpening | null>(
    null,
  );
  const [openingEpoch, setOpeningEpoch] = useState(0);
  const [returnOpen, setReturnOpen] = useState<SupplierReturn | null>(null);
  // A model's detail, from the till's search: what found it, and what the
  // search held, to come back to; and the screen it opened, «← {модель}»
  // over it (sections task list, P0-6).
  const [model, setModel] = useState<Opened | null>(null);
  const [tillTyped, setTillTyped] = useState("");
  const [fromModel, setFromModel] = useState<Tab | null>(null);
  // Opened from «Залишки», for whoever has no till: «← Залишки» over it,
  // marked with «Ще» (stage 2, goods task list, P2-5).
  const [modelFromStock, setModelFromStock] = useState(false);
  // The warehouse «Залишки» shows, kept while a model's detail is open over
  // it: «← Залишки» comes back to it. Known by the scope it was chosen in.
  const [stockPlace, setStockPlace] = useState<{
    scope: string;
    place: string;
  } | null>(null);
  // Left for anything but a model it opened: chosen afresh next time, none
  // taken while there are several.
  useEffect(() => {
    if (tab !== "stock" && !(tab === "model" && modelFromStock))
      setStockPlace(null);
  }, [tab, modelFromStock]);
  const [moneyPeriod, setMoneyPeriod] = useState<Period>("today");
  // «Звіт про продажі» opens on «Надійшло»'s period and its days.
  const [reportPeriod, setReportPeriod] = useState<{
    mode: Period;
    range: { from: string; to: string } | null;
  }>({ mode: "today", range: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // «Замовлення» as it was left: what was typed, the place chosen (review,
  // 2026-10-23); afresh when «Замовлення» is chosen again.
  const [ordersView, setOrdersView] = useState<OrdersView>(freshOrdersView);
  // An order's step sheet over its card («Усе на бірці» sections task
  // list, P0-2, P0-3): «Відправити» or «Клієнт забрав», from the card's
  // MainButton or the row's verb — the row as read, until the card is.
  // Kept apart from the card, which is mounted afresh as it is read: what
  // was typed in it stays.
  const [orderSheet, setOrderSheet] = useState<{
    id: string;
    kind: "send" | "collect" | "shipping";
    /** «Доставка» opened by «ТТН ще немає — вписати»: the cursor in it. */
    writing?: boolean;
  } | null>(null);
  const [opening, setOpening] = useState<Order | null>(null);
  // The sheet's step refused: why, in the sheet, over what was typed.
  const [sheetRefused, setSheetRefused] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const key = `birka:pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const catalogKey = `birka:catalog-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const saleKey = `birka:sale-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [catalogStorageError, setCatalogStorageError] = useState(false);
  const [saleStorageError, setSaleStorageError] = useState(false);
  // «Ще» › «Товар»: «Прийшов товар», «Брак» and «Інвентаризація», each by
  // its own right («Усе на бірці» task list, P0-4; sections task list,
  // P1-5); «Залишки» only for whoever reads the stock with no till here —
  // anyone else's is the till's search and a model's detail (P0-6).
  const canSeeStock = store.permissions.includes("inventory:view");
  // A stocktake reads the warehouse it counts: whoever may correct the
  // stock but not read it has none (review, 2026-11-01).
  const canStocktake =
    canSeeStock && store.permissions.includes("inventory:adjust");
  const stockListed = canSeeStock && !store.permissions.includes("sale:create");
  const canReceive = store.permissions.includes("inventory:receive");
  const canSeeDamaged = store.permissions.includes("damaged:handle");
  // Read, not watched, as `canReturnNow`: a kept delivery, correction or
  // count turns to its screen only for whoever may open it; anyone else's
  // banner stands over any tab («Усе на бірці» task list, P2-1). With the
  // till, a correction's is its search, which opens first anyway.
  const canReceiveNow = useRef(canReceive);
  canReceiveNow.current = canReceive;
  const canStocktakeNow = useRef(canStocktake);
  canStocktakeNow.current = canStocktake;
  const stockListedNow = useRef(stockListed);
  stockListedNow.current = stockListed;
  const receiptKey = `birka:receipt-pending:${me.organization_id}:${me.user_id}:${store.id}`;
  const [receiptStorageError, setReceiptStorageError] = useState(false);
  // A kept delivery confirmed: «Приймання записано один раз» until
  // «Зрозуміло» (stage 2, orders task list, P0-1; В-ЗП2 (а)).
  const [receiptSettled, setReceiptSettled] = useState(false);
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
        if (canReceiveNow.current) setTab("receive");
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
        // Its balances are read again once it is settled.
        if (stockListedNow.current) setTab("stock");
        loadedFromDisk("adjustment");
      }
    } catch {
      setAdjustmentStorageError(true);
    }
  }, [adjustmentKey, loadedFromDisk]);
  // A stocktake's count (ADR-0022): «Інвентаризація»'s own, as a correction.
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
        if (canStocktakeNow.current) setTab("stocktaking");
        else if (stockListedNow.current) setTab("stock");
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
  // A kept delivery proven recorded: «Прийшов товар» afresh, its list gone
  // with it — edited, it would be recorded again (review, 2026-11-03).
  const [receiveEpoch, setReceiveEpoch] = useState(0);
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
  // The app opened on the till opens it with its cursor in the search (spec
  // S08; «Усе на бірці» task list, P0-5), as «Новий продаж» on a return's
  // result does (returns task list, P0-5). The till takes it as it mounts,
  // once: the next tab change clears it, so neither the till opened any
  // other way — «Продати», the menu — nor one mounted afresh on that visit
  // takes the cursor (review, 2026-10-17).
  const [searchFirst, setSearchFirst] = useState(tab === "sale");
  useEffect(() => {
    setSearchFirst(false);
  }, [tab]);
  // «Замовлення» only for whoever may read them; nothing is said of the
  // rule to anyone else (orders task list, P2-1).
  const canSeeOrders = store.permissions.includes("sale:view");
  // Read, not watched, as `canReturnNow`.
  const canSeeOrdersNow = useRef(canSeeOrders);
  canSeeOrdersNow.current = canSeeOrders;
  // Sales paid in parts: whoever sells that way takes the payments.
  const canSeeCredits = store.permissions.includes("sale:credit");
  // Read, not watched, as `canReturnNow` (credits task list, P2-1).
  const canSeeCreditsNow = useRef(canSeeCredits);
  canSeeCreditsNow.current = canSeeCredits;
  // The till's «Внесок» (spec S08; «Усе на бірці» task list, P0-3): the
  // same right, in a store that trades, where payments are taken.
  const canDeposit = canSeeCredits && trading;
  const canDepositNow = useRef(canDeposit);
  canDepositNow.current = canDeposit;
  // This person's other stores asked for a whole number that owes nothing
  // here: those that trade, where they take payments too — and «Покупці»'s
  // other blocks (S19).
  const depositOthers = me.stores.filter(
    (other) =>
      other.id !== store.id &&
      other.state === "ACTIVE" &&
      other.permissions.includes("sale:credit"),
  );
  // A payment's form open at the till, or from «Покупці»: the menu steps
  // aside (spec S21).
  const [depositTask, setDepositTask] = useState(false);
  // And while the cash is counted («Усе на бірці» sections task list, P1-2).
  const [cashTask, setCashTask] = useState(false);
  // And while a supplier's invoice is paid (stage 2, money task list, P0-2).
  const [invoiceTask, setInvoiceTask] = useState(false);
  // And while goods are returned to a supplier (stage 2, money task list,
  // P0-4).
  const [supplierTask, setSupplierTask] = useState(false);
  // And while a sale's return is made (stage 2, orders task list, P0-6).
  const [returnTask, setReturnTask] = useState(false);
  // And while a warehouse is counted (stage 2, goods task list, P0-3).
  const [stocktakeTask, setStocktakeTask] = useState(false);
  // And while a list's line is answered (stage 2, goods task list, P0-5).
  const [openingsTask, setOpeningsTask] = useState(false);
  // The list «Сьогодні»'s tag opens itself, until the section is left
  // (P0-6).
  const [openingsOpened, setOpeningsOpened] = useState<string | null>(null);
  const taskScreen =
    ((tab === "deposit" || tab === "credits") && depositTask) ||
    (tab === "cash" && cashTask) ||
    (tab === "invoices" && invoiceTask) ||
    (tab === "suppliers" && supplierTask) ||
    (tab === "returns" && returnTask) ||
    (tab === "stocktaking" && stocktakeTask) ||
    (tab === "openings" && openingsTask) ||
    // And while a new order is made (stage 2, orders task list, P0-5).
    tab === "new";
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
  // Bumped to remount «Покупці» once such a command settles, so no screen
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
        // Its banner shows over any tab; «Продаж» › «Внесок» is turned to
        // only for whoever may take payments, never to say they may not
        // (credits task list, P2-1; «Усе на бірці» task list, P0-3) — a
        // payment's; a write-off, never made at the till, and a payment in
        // a store that does not trade, «Покупці».
        if (saved.body.kind === "payment" && canDepositNow.current)
          setTab("deposit");
        else if (canSeeCreditsNow.current) setTab("credits");
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
  // A catalogue operation kept on the phone is checked on its own screen
  // alone: the screen stands while it is kept, its right gone or not, and
  // the server's answer settles it (review).
  const catalogKept = catalogCommand.pending !== null;
  const saleCommand = useSaleCommand();
  const [settled, setSettled] = useState<SaleReceipt | null>(null);
  // A basket that turned out to have been recorded as an empty shelf.
  const [shelfSettled, setShelfSettled] = useState(false);
  // Bumped to remount the till after a settled sale, so its basket and its
  // `command_id` do not survive an operation that turned out to be complete.
  const [saleEpoch, setSaleEpoch] = useState(0);
  // Read, not watched, as `canReturnNow`: a kept sale turns to the till only
  // for whoever may sell there («Усе на бірці» task list, P2-1).
  const canSell = store.permissions.includes("sale:create");
  const canSellNow = useRef(canSell);
  canSellNow.current = canSell;
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
        if (canSellNow.current) setTab("sale");
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
      // Read: a sheet over any screen may send through it now (stage 2,
      // goods task list, P0-1).
      useCatalogJournal.setState({ key: catalogKey });
    } catch {
      useCatalogJournal.setState({ key: null });
      setCatalogStorageError(true);
    }
  }, [catalogKey]);
  useEffect(() => {
    useCatalogJournal.setState({ person: me.display_name });
  }, [me.display_name]);
  const { pending, busy, error, misses: orderMisses } = useCommand();
  useEffect(() => {
    try {
      const saved = loadPending(key);
      useCommand.getState().set(saved);
      if (saved) {
        // Its own tab, as every kept operation: the till opens first now —
        // for whoever may read orders; anyone else's banner stands over
        // any tab (orders task list, P2-1).
        if (canSeeOrdersNow.current) setTab("list");
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
  // P0-2, P0-4): sent, arrived, cancelled — a reserve on its stub (stage 2,
  // orders task list, P1-3).
  const [orderDone, setOrderDone] = useState<{
    id: string;
    text: string;
    stub: boolean;
  } | null>(null);
  // The order «Клієнт забрав» was just recorded on: its sale said large
  // (orders task list, P0-3) — kept and confirmed later, said so.
  const [collected, setCollected] = useState<{
    id: string;
    kept: boolean;
  } | null>(null);
  // Each step that came back with its order: its card mounted afresh.
  const [orderEpoch, setOrderEpoch] = useState(0);
  // An order's step refused: why, at the screen's top, brought to the
  // finger from where it was pressed (review, 2026-10-23; orders task
  // list, P0-2).
  const orderAlert = useRef<HTMLParagraphElement>(null);
  const [stepRefused, setStepRefused] = useState(0);
  // A new order's refusal belongs to its screen: a shortfall said on its
  // line, and forgotten with the screen, never said again over the list or
  // the next new order (orders task list, P0-5; review, 2026-10-24).
  const [newRefused, setNewRefused] = useState<unknown>(null);
  const [firstSend, setFirstSend] = useState(false);
  useEffect(() => {
    if (tab === "new" || newRefused === null) return;
    const settled = useCommand.getState();
    if (settled.error === newRefused && settled.pending === null)
      useCommand.setState({ error: null });
    setNewRefused(null);
  }, [tab, newRefused]);
  useEffect(() => {
    if (stepRefused > 0) orderAlert.current?.focus();
  }, [stepRefused]);
  /** An order's command sent, and the order it came back with. `stay`:
   * a step taken from its row, the list kept («Усе на бірці» sections task
   * list, P0-1). */
  async function run(
    command: Pending,
    resent = false,
    stay = false,
  ): Promise<Order | null> {
    // One at a time: a second press while the first is asked does nothing,
    // its sheet and what was said kept (review, 2026-11-01).
    if (useCommand.getState().busy) return null;
    setOrderResent(resent ? command.label : null);
    setOrderDone(null);
    setCollected(null);
    setNewRefused(null);
    // Its first sending is written down before it goes, yet nothing is
    // unanswered until it comes back without an answer: no banner meanwhile,
    // as «Каса»'s (review, 2026-10-25).
    if (!resent) setFirstSend(true);
    let order: Order | null;
    try {
      order = await submitPending(key, token, command);
    } finally {
      setFirstSend(false);
    }
    const settled = useCommand.getState();
    // A step on an order, by its path's last word: «dispatch», «cancel»;
    // a new one, «reserve» — by its path first, since one answered is kept
    // with its order's id (review, 2026-10-24).
    const step =
      command.path === "/orders"
        ? "reserve"
        : command.orderId
          ? (command.path.split("/").at(-1) ?? "")
          : "";
    // The step's sheet over its card («Усе на бірці» sections task list,
    // P0-2, P0-3), closed in the render that says what came of it: the
    // sale, the banner or why then takes the cursor, nothing over them.
    const fromSheet =
      step === "dispatch" || step === "collect" || step === "shipping";
    const closeSheet = (): void => {
      setOrderSheet((open) => (open?.id === command.orderId ? null : open));
    };
    if (
      !order &&
      step !== "" &&
      settled.pending === null &&
      settled.error !== null
    ) {
      // Refused, recorded nowhere: the order and its row as they are now,
      // said so (orders task list, P1-2) — or, a new one short of stock,
      // its line marked on its screen (P0-5).
      buzz("error");
      setStepRefused((count) => count + 1);
      // From its sheet: kept, why over what was typed — unless the order
      // moved on meanwhile, which its card says.
      if (fromSheet) {
        if (movedOn(settled.error)) closeSheet();
        else setSheetRefused(true);
      }
      if (step === "reserve" && tab === "new") setNewRefused(settled.error);
      if (command.orderId) {
        void cache.invalidateQueries({
          queryKey: ["order", store.id, command.orderId],
        });
        // Its row too: back on the list, it is where it is now (orders
        // task list, P1-2).
        void cache.invalidateQueries({
          queryKey: ["orders", store.id],
          refetchType: "all",
        });
      }
    } else if (!order && fromSheet) closeSheet();
    if (order) {
      // Sent with a waybill another order has: its sheet stays with the
      // warning.
      if (
        fromSheet &&
        !(step === "dispatch" && (order.same_waybill?.length ?? 0) > 0)
      )
        closeSheet();
      // Reserved, sent, arrived or cancelled: a buzz, and what it did on
      // the order (orders task list, P0-2, P0-4, P0-5); a step kept and
      // confirmed later, that it was recorded once (P1-1) — a new order
      // says what it reserved, a collect its sale.
      const once = `Операцію «${visible(command.label)}» записано один раз`;
      const text =
        step === ""
          ? null
          : resent && step !== "reserve" && step !== "collect"
            ? once
            : // Come back, by the warehouses its screen read (P2-4); a new
              // order confirmed late and moved on meanwhile: once.
              (stepDone(step, order, placesRead(cache, store.id)) ??
              (resent && step === "reserve" ? once : null));
      if (text !== null) {
        // Sent with a waybill another order has: recorded, and a warning
        // («Усе на бірці» sections task list, P0-3).
        buzz(
          step === "dispatch" && (order.same_waybill?.length ?? 0) > 0
            ? "warning"
            : "success",
        );
        if (!stay)
          setOrderDone({
            id: order.id,
            text,
            // Reserved, and still waiting to be sent: torn off as recorded
            // (P1-3). Confirmed late and moved on: its line alone.
            stub: step === "reserve" && order.status === "READY_TO_DISPATCH",
          });
      }
      // Collected: a sale, said as the till says one (orders task list,
      // P0-3).
      if (step === "collect") {
        buzz("success");
        setCollected({ id: order.id, kept: resent });
      }
      cache.setQueryData(["order", store.id, order.id], order);
      if (!stay) {
        setOrderEpoch((epoch) => epoch + 1);
        setSelectedId(order.id);
        setTab("list");
      }
      await Promise.all([
        // Read now, though the list is not shown: back on it, the order is
        // where it is now (review, 2026-10-23).
        cache.invalidateQueries({
          queryKey: ["orders", store.id],
          refetchType: "all",
        }),
        // What the till and a new order list: reserved, freed or sold
        // (orders task list, P0-5).
        cache.invalidateQueries({ queryKey: ["sale-stock"] }),
        // Collected in parts, a debt: «Покупці» read again (review,
        // 2026-10-19).
        cache.invalidateQueries({ queryKey: ["credits", store.id] }),
      ]);
    }
    return order;
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
      // Its words stand over any tab; the till is turned to only for
      // whoever may sell («Усе на бірці» task list, P2-1).
      if (outcome.kind === "sold") {
        setSettled(outcome.sale);
        setSaleEpoch((epoch) => epoch + 1);
        if (canSellNow.current) setTab("sale");
      } else if (outcome.kind === "nothing-sold") {
        setShelfSettled(true);
        setSaleEpoch((epoch) => epoch + 1);
        if (canSellNow.current) setTab("sale");
      } else if (outcome.kind === "refused") {
        // Proven to have recorded nothing (ADR-0013 §1): the basket is
        // the seller's again, and the refusal says why and what to do.
        useSaleCommand.setState({ error: outcome.error });
        setSaleEpoch((epoch) => epoch + 1);
        if (canSellNow.current) setTab("sale");
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
      else if (outcome.kind === "done") {
        // Confirmed: its stub torn off, felt as the till's is (stage 2,
        // orders task list, P0-1).
        buzz("success");
        setReceiptSettled(true);
        setReceiveEpoch((epoch) => epoch + 1);
      }
    });
  }
  // What a supplier's operation changes, read again: the invoices, the
  // returns, the borrowed goods and the till's stock.
  function suppliersRead(): void {
    for (const name of ["supplier-invoices", "supplier-returns", "borrowed"])
      void cache.invalidateQueries({ queryKey: [name, store.id] });
    void cache.invalidateQueries({ queryKey: ["sale-stock"] });
  }
  // The invoices' and the suppliers' kept operations, checked by their
  // button alone (G11; stage 2, money task list, P0-6): confirmed later, as
  // the sale's, felt as nothing.
  function checkInvoice(): void {
    const attempt = invoiceCommand.pending;
    if (!attempt) return;
    void resolveInvoiceCommand(invoiceKey, token, attempt).then((outcome) => {
      if (outcome.kind === "done") {
        setInvoiceSettled({ invoice: outcome.result, body: attempt.body });
        setSuppliersEpoch((epoch) => epoch + 1);
        suppliersRead();
      } else if (outcome.kind === "refused") {
        // Proven to have recorded nothing: its form, if still open, is the
        // person's again, and the refusal says why.
        useInvoiceCommand.setState({ error: outcome.error });
        setInvoiceRefused({
          error: outcome.error,
          said:
            attempt.body.kind === "sold"
              ? borrowedRefusalText(outcome.error)
              : invoiceRefusalText(outcome.error),
        });
        suppliersRead();
      }
    });
  }
  function checkSupplierReturn(): void {
    const attempt = supplierCommand.pending;
    if (!attempt) return;
    void resolveReturnToSupplier(supplierKey, token, attempt).then(
      (outcome) => {
        if (outcome.kind === "done") {
          setSupplierSettled(outcome.result);
          setSuppliersEpoch((epoch) => epoch + 1);
          suppliersRead();
        } else if (outcome.kind === "refused") {
          useReturnToSupplier.setState({ error: outcome.error });
          setSupplierRefused({
            error: outcome.error,
            // Borrowed goods sent back say it as their section does.
            said: attempt.body.stock_lot_id
              ? borrowedRefusalText(outcome.error)
              : supplierRefusalText(outcome.error),
          });
          suppliersRead();
        }
      },
    );
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
        buzz("success");
        setAdjustmentSettled(outcome.result);
        void cache.invalidateQueries({
          queryKey: ["inventory-stock"],
        });
        // The till's search too: a correction may be made from a model's
        // detail, a tap from it (review, 2026-11-01).
        void cache.invalidateQueries({ queryKey: ["sale-stock"] });
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
        buzz("success");
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
        void cache.invalidateQueries({ queryKey: ["sale-stock"] });
      }
    });
  }
  function checkOrder(): void {
    if (pending) void run(pending, true);
  }
  // A sheet left over a card that is gone: closed with it.
  useEffect(() => {
    if (tab !== "list") setOrderSheet(null);
  }, [tab]);
  /**
   * The step's sheet over the open order («Усе на бірці» sections task
   * list, P0-2, P0-3): closed by `run` once its step is recorded — a
   * waybill another order has kept with its warning — and once its answer
   * is lost, when the banner says it; refused, kept with why.
   */
  function stepSheet(): JSX.Element | null {
    const sheet = orderSheet;
    const order = detail.data ?? (opening?.id === selectedId ? opening : null);
    if (
      tab !== "list" ||
      sheet === null ||
      order === null ||
      sheet.id !== order.id
    )
      return null;
    const close = (): void => {
      setOrderSheet(null);
      setSheetRefused(false);
    };
    const take = (
      action: "dispatch" | "collect" | "shipping",
      extra?: Record<string, unknown>,
    ): void => {
      setSheetRefused(false);
      const body = { command_id: crypto.randomUUID(), ...extra };
      void run({
        path: `/orders/${order.id}/${action}`,
        body,
        label: actionLabels[action] ?? action,
        orderId: order.id,
        shown: stepShown(order, extra),
      });
    };
    const refusal =
      sheetRefused && error !== null
        ? orderErrorText(
            error,
            orderResent,
            pending !== null && !pending.acknowledged,
            orderMisses,
            pending?.label ?? null,
            pending?.acknowledged === true,
          )
        : null;
    if (sheet.kind === "shipping")
      return (
        <Shipping
          order={order}
          writing={sheet.writing === true}
          blocked={blocked}
          waiting={busy}
          refusal={refusal}
          save={(extra) => {
            take("shipping", extra);
          }}
          close={close}
        />
      );
    return sheet.kind === "send" ? (
      <Send
        order={order}
        store={store}
        token={token}
        blocked={blocked}
        waiting={busy}
        refusal={refusal}
        send={(extra) => {
          take("dispatch", extra);
        }}
        close={close}
      />
    ) : (
      <Collect
        order={order}
        store={store}
        token={token}
        blocked={blocked}
        refusal={refusal}
        collect={(extra) => {
          take("collect", extra);
        }}
        close={close}
      />
    );
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
  const receiptUnsettled =
    receiptStorageError ||
    receiptCommand.busy ||
    receiptCommand.pending !== null;
  const othersExceptReceiptAndCredit =
    busy ||
    pending !== null ||
    storageError ||
    catalogStorageError ||
    saleStorageError ||
    catalogCommand.busy ||
    catalogCommand.pending !== null ||
    saleCommand.busy ||
    saleCommand.pending !== null ||
    returnUnsettled;
  const othersExceptCorrectionsAndCash =
    othersExceptReceiptAndCredit || receiptUnsettled || creditUnsettled;
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
  // Borrowed goods marked sold, kept, are «Постачальникам»'s: its row stays
  // open to them, its forms held (stage 2, money task list, P0-6).
  const soldKept =
    canReturnToSupplier && invoiceCommand.pending?.body.kind === "sold";
  const suppliersHeld =
    othersUnsettled ||
    adjustmentUnsettled ||
    storesUnsettled ||
    (invoiceUnsettled && !soldKept);
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
  // «Ще»'s rows to a screen that keeps a journal of its own are held by
  // every journal but that one, as «Каса» and «Моделі» are: a kept receipt
  // or write-off never shuts its own screen once it is left (review,
  // 2026-10-29).
  const elsewhereUnsettled =
    cashUnsettled ||
    correctionUnsettled ||
    adjustmentUnsettled ||
    storesUnsettled ||
    supplierUnsettled ||
    invoiceUnsettled;
  const otherThanReceipt =
    othersExceptReceiptAndCredit ||
    receiptStorageError ||
    creditUnsettled ||
    elsewhereUnsettled;
  const otherThanCredit =
    othersExceptReceiptAndCredit || receiptUnsettled || elsewhereUnsettled;
  // A first send in flight: whatever answers it is said on its own screen,
  // so nothing leaves it until then — «Ще» and «← Ще» too, free otherwise
  // (navigation task list, P0-4; review, 2026-10-26).
  const sending =
    busy ||
    saleCommand.busy ||
    catalogCommand.busy ||
    receiptCommand.busy ||
    returnCommand.busy ||
    creditCommand.busy ||
    cashCommand.busy ||
    correctionCommand.busy ||
    adjustmentCommand.busy ||
    countCommand.busy ||
    stateCommand.busy ||
    supplierCommand.busy ||
    invoiceCommand.busy;
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
  // «Каса» is a tab for whoever counts the drawer and reads no report; for
  // whoever reads one it is «Гроші» › «Каса · {магазин}» (S29; the frame's
  // В2 (а); «Усе на бірці» sections task list, P0-7) — in a store that does
  // not trade too, never a sixth tab. Over such a store, a tab for whoever
  // else the network's rights open it to, to close the day (§4а).
  const cashTab = canSeeCash && !canSeeReport;
  // The screens «Гроші» opens and stands for, for whoever has it.
  const moneyScreens: readonly Tab[] = ["cash", "report", "invoices", "closes"];
  // The sections (redesign P1-6), each by the same right as before: the
  // menu's tabs (spec §6.2; «Усе на бірці» task list, P0-4), and every other
  // under «Ще», two taps away. An order left open is forgotten by the
  // sections that always were.
  const sections: {
    tab: Tab;
    label: string;
    /** Its glyph as a row of «Ще» (spec S07; «Усе на бірці» task list,
     * P1-5); a tab's is the menu's own. */
    icon: IconName;
    shown: boolean;
    disabled: boolean;
    forgetsOrder?: true;
    /** The other tabs it stands for, marked with it. */
    also?: readonly Tab[];
    /** Pressed again where it stands: its first screen. */
    again?: () => void;
    /** A tab of the menu, never a row of «Ще». */
    tabbed?: true;
  }[] = [
    // «Сьогодні», the first tab, by the report's right in this store
    // («Усе на бірці» task list, P0-6, §4а).
    {
      tab: "today",
      label: "Сьогодні",
      icon: "tab-today",
      shown: canSeeReport,
      disabled: blocked,
      forgetsOrder: true,
      tabbed: true,
    },
    // «Продаж» holds the returns and the payments on debts too, by
    // «Продати · Повернути · Внесок» under its heading (navigation task
    // list, P0-1; «Усе на бірці» task list, P0-3): for whoever does one of
    // them alone, it opens that one.
    {
      tab: store.permissions.includes("sale:create")
        ? "sale"
        : canReturn
          ? "returns"
          : "deposit",
      label: "Продаж",
      icon: "tab-sell",
      shown:
        store.permissions.includes("sale:create") || canReturn || canDeposit,
      disabled: blocked,
      // An order left open is kept by the returns, as before (review,
      // 2026-10-26).
      ...(store.permissions.includes("sale:create")
        ? { forgetsOrder: true as const }
        : {}),
      // A model's detail too, and what it opened — not one «Залишки»
      // opened, which is «Ще»'s (stage 2, goods task list, P2-5).
      also: [
        "returns",
        "deposit",
        ...(modelFromStock
          ? []
          : (["model", ...(fromModel ? [fromModel] : [])] as Tab[])),
      ],
      tabbed: true,
    },
    // «Замовлення», a tab of its own: its list, its card and «+ Нове
    // замовлення» as before; pressed again, its first screen.
    {
      tab: "list",
      label: "Замовлення",
      icon: "tab-orders",
      shown: canSeeOrders,
      disabled: blocked,
      forgetsOrder: true,
      also: ["new"],
      again: () => {
        setTab("list");
        setSelectedId(null);
        setOrdersView(freshOrdersView);
      },
      tabbed: true,
    },
    // «Гроші», for whoever reads the report: «Каса», «Звіт про продажі»,
    // «Накладні» and «Закриття» are opened from it, and marked with it
    // (spec S29; «Усе на бірці» sections task list, P0-7). Held as «Ще» is:
    // only while a first send is in flight, each of its ways by its own
    // section's rule.
    {
      tab: "money",
      label: "Гроші",
      icon: "tab-money",
      shown: canSeeReport,
      disabled: sending,
      // «Покупці» too, while opened from it.
      also:
        fromMoney === "credits" ? [...moneyScreens, "credits"] : moneyScreens,
      tabbed: true,
    },
    {
      tab: "cash",
      label: "Каса",
      icon: "drawer",
      shown: canSeeCash,
      disabled: otherThanCash,
      forgetsOrder: true,
      ...(cashTab ? { tabbed: true as const } : {}),
    },
    // «Ще» › «Люди» › «Покупці» (S19; «Усе на бірці» sections task list,
    // P0-4).
    {
      tab: "credits",
      label: "Покупці",
      icon: "person",
      shown: canSeeCredits,
      disabled: otherThanCredit,
    },
    // «Ще» › «Товар» (spec S07).
    {
      tab: "receive",
      label: "Прийшов товар",
      icon: "arrived",
      shown: canReceive,
      disabled: otherThanReceipt,
    },
    {
      tab: "damaged",
      label: "Брак",
      icon: "damaged",
      shown: canSeeDamaged,
      disabled: blocked,
    },
    {
      tab: "stocktaking",
      label: "Інвентаризація",
      icon: "stocktake",
      shown: canStocktake,
      disabled: otherThanAdjustment,
    },
    {
      tab: "stock",
      label: "Залишки",
      icon: "stocktake",
      shown: stockListed,
      disabled: otherThanAdjustment,
    },
    {
      tab: "catalog",
      label: "Перевірка каталогу",
      // «Товар і каталог»'s own mark on each of its rows; «paper» is the
      // paper mode's alone (stage 2, goods task list, P2-3).
      icon: "catalogue",
      shown: canConfirmCatalog,
      disabled: blocked,
    },
    {
      tab: "openings",
      label: "Початкові залишки",
      icon: "catalogue",
      shown: canSeeOpenings,
      disabled: blocked,
    },
    {
      tab: "backups",
      label: "Резервні копії",
      icon: "backup",
      shown: canSeeBackups,
      disabled: blocked,
    },
    {
      tab: "suppliers",
      label: "Постачальникам",
      icon: "supplier",
      shown: canReturnToSupplier,
      disabled: suppliersHeld,
    },
    // By the right to return goods, as before (stage 2, money task list,
    // P0-5; В2 (а)): its «Продано» is whoever keeps the invoices'.
    {
      tab: "borrowed",
      label: "Позичене й під реалізацію",
      icon: "supplier",
      shown: canReturnToSupplier,
      disabled: suppliersHeld,
    },
    {
      tab: "invoices",
      label: "Накладні",
      icon: "supplier",
      shown: canSeeInvoices,
      disabled: otherThanInvoices,
    },
    {
      tab: "models",
      label: "Моделі",
      icon: "catalogue",
      shown: canCorrect,
      disabled: otherThanCorrections,
    },
    {
      tab: "report",
      label: "Звіт про продажі",
      icon: "report",
      shown: canSeeReport,
      disabled: blocked,
    },
    {
      tab: "stores",
      label: "Магазини",
      icon: "stores",
      shown: canManageStores,
      disabled: otherThanStores,
    },
  ];
  // Whatever section is open, «Ще» marks it when it is one of its own, and
  // on its own screen; the section's heading names it.
  const tabbed = new Set<Tab>(
    sections
      .filter((section) => section.tabbed && section.shown)
      .flatMap((section) => [section.tab, ...(section.also ?? [])]),
  );
  const inMore = !tabbed.has(tab);
  const standsFor = (section: (typeof sections)[number]): boolean =>
    tab === section.tab || (section.also?.includes(tab) ?? false);
  const tabOf = (section: (typeof sections)[number]): TabItem => ({
    key: section.tab,
    label: section.label,
    // The open tags of «Сьогодні», «9+» past nine (spec §6.3).
    ...(section.tab === "today" && work.tags.length > 0
      ? {
          badge: work.tags.length > 9 ? "9+" : String(work.tags.length),
          badgeWords: `Чекає на вас: ${String(work.tags.length)}`,
        }
      : {}),
    ...(section.tab === "today"
      ? { ref: todayButton }
      : section.tab === "list"
        ? { ref: ordersButton }
        : section.tab === "money"
          ? { ref: moneyButton }
          : section.tab === "sale"
            ? { ref: saleButton }
            : {}),
    icon:
      section.tab === "today"
        ? "tab-today"
        : section.tab === "list"
          ? "tab-orders"
          : section.tab === "cash"
            ? "tab-drawer"
            : section.tab === "money"
              ? "tab-money"
              : "tab-sell",
    current: standsFor(section),
    disabled: section.disabled,
    open: () => {
      if (section.again && standsFor(section)) {
        section.again();
        return;
      }
      setTab(section.tab);
      if (section.forgetsOrder) {
        setSelectedId(null);
        setOrdersView(freshOrdersView);
      }
    },
  });
  const shown = sections.filter((section) => section.shown);
  // Selling, taking back and taking a payment on a debt, one section's
  // ways (navigation task list, P0-1; «Усе на бірці» task list, P0-3): each
  // by its own right, the switch for whoever has two or more, under each
  // screen's heading, held as the row is. Its name for a reader says the
  // ways it holds.
  const tillModes = (
    current: "sale" | "returns" | "deposit",
  ): JSX.Element | null => {
    const open = [
      ...(store.permissions.includes("sale:create")
        ? [{ mode: "sale" as const, label: "Продати", named: "продаж" }]
        : []),
      ...(canReturn
        ? [{ mode: "returns" as const, label: "Повернути", named: "повернення" }]
        : []),
      ...(canDeposit
        ? [{ mode: "deposit" as const, label: "Внесок", named: "внесок" }]
        : []),
    ];
    if (open.length < 2) return null;
    const names = open.map((way) => way.named);
    const last = names.pop() ?? "";
    const label = `${names.join(", ")} або ${last}`;
    return (
      <ModeSwitch
        label={`${label.charAt(0).toUpperCase()}${label.slice(1)}`}
        modes={open}
        current={current}
        disabled={blocked}
        focus={modeChosen}
        focused={modeFocused}
        choose={(mode) => {
          setModeChosen(true);
          setTab(mode);
          if (mode === "sale") {
            setSelectedId(null);
            setOrdersView(freshOrdersView);
          }
        }}
      />
    );
  };
  const rest = shown.filter((section) => !section.tabbed);
  // What waits under each row, its count the row's one colour (spec S07;
  // «Усе на бірці» task list, P1-5): «Брак»'s units, as its tile said; who
  // owes the store; the lists to approve; the backups.
  const metaOf: Partial<Record<Tab, JSX.Element>> = {
    credits: <DebtsLine store={store} token={token} />,
    damaged: <DamagedMeta store={store} token={token} />,
    openings: <ApprovalsLine count={awaitingApproval} />,
    backups: <BackupsLine backups={backups.data} needYou={backupsNeedYou} />,
  };
  const rowOf = (section: (typeof sections)[number]): MoreRow => ({
    key: section.tab,
    label: section.label,
    icon: section.icon,
    ...(metaOf[section.tab] ? { meta: metaOf[section.tab] } : {}),
    disabled: section.disabled,
    open: () => {
      setTab(section.tab);
      moreButton.current?.focus();
    },
  });
  const rowsOf = (tabs: readonly Tab[]): MoreRow[] =>
    tabs.flatMap((key) =>
      rest.filter((section) => section.tab === key).map(rowOf),
    );
  // «Товар і каталог»: a list of its own for whoever has two of its screens
  // or more, the one itself for whoever has one; its line names what it
  // holds.
  const catalogueRows = rowsOf(["catalog", "models", "openings"]);
  const catalogueWords: Partial<Record<string, string>> = {
    catalog: "перевірка",
    models: "моделі",
    openings: "початкові залишки",
  };
  const catalogueRow: MoreRow[] =
    catalogueRows.length < 2
      ? catalogueRows
      : [
          {
            key: "catalogue",
            label: "Товар і каталог",
            icon: "catalogue" as const,
            // What waits in it first, then what it holds.
            meta: (
              <ApprovalsLine
                count={
                  catalogueRows.some((row) => row.key === "openings")
                    ? awaitingApproval
                    : null
                }
                then={catalogueRows
                  .map((row) => catalogueWords[row.key] ?? "")
                  .join(", ")}
              />
            ),
            // Held only when all it holds is: «Моделі» stays reachable while
            // its own correction waits.
            disabled: catalogueRows.every((row) => row.disabled),
            open: () => {
              setTab("catalogue");
              moreButton.current?.focus();
            },
          },
        ];
  const paperOn = usePaper((state) => state.storeId === store.id);
  // The person's other stores whose stock a search reads too: trading, and
  // with the right to read stock there («Усе на бірці» task list, P2-3).
  const stockElsewhere = me.stores.filter(
    (other) =>
      other.id !== store.id &&
      other.state === "ACTIVE" &&
      other.permissions.includes("inventory:view"),
  );
  // «Ще»'s groups, in the design's order (spec S07; «Усе на бірці» task
  // list, P0-4): people, goods, money, the network, this phone.
  const moreGroups: MoreGroup[] = [
    { title: "Люди", rows: rowsOf(["credits"]) },
    {
      title: "Товар",
      rows: [
        ...rowsOf(["receive", "damaged", "stocktaking", "stock"]),
        ...catalogueRow,
      ],
    },
    // For whoever has «Гроші», only the suppliers' stay here (the frame's
    // §2а, row 11; stage 2, money task list, P1-3).
    {
      title: "Гроші",
      rows: rowsOf(
        canSeeReport
          ? ["suppliers", "borrowed"]
          : ["cash", "report", "invoices", "suppliers", "borrowed"],
      ),
    },
    { title: "Мережа", rows: rowsOf(["stores", "backups"]) },
    {
      title: "Цей телефон",
      rows: [
        ...(changeStore
          ? [
              {
                key: "change",
                label: "Змінити магазин",
                icon: "stores" as const,
                // The store open now (spec S07).
                meta: visible(store.name),
                disabled: blocked,
                open: changeStore,
              },
            ]
          : []),
        // The till's own switch, the same state (`sales/paper.ts`).
        ...(trading && store.permissions.includes("sale:create")
          ? [
              {
                key: "paper",
                label: "Вношу продаж з паперу",
                icon: "paper" as const,
                on: paperOn,
                disabled: blocked,
                open: () => {
                  setPaper(store.id, !paperOn);
                },
              },
            ]
          : []),
      ],
    },
  ];
  // «Ще»'s foot: who is signed in, and until when by this phone's clock —
  // the sign-in's moment and the session's length (spec S07; «Усе на
  // бірці» task list, P1-5). No role: the server names none (К8).
  const signedInAs = `Ви увійшли як ${visible(me.display_name)}${
    sessionUntil === null
      ? ""
      : ` · сесія до ${timeOf(new Date(sessionUntil).toISOString())}`
  }`;
  // «Ще» is shown when it holds anything (§4а).
  const hasMore = moreGroups.some((group) => group.rows.length > 0);
  // The focus stays on «Ще», never lost to the page, as the screen under it
  // goes (review, 2026-10-16 and 2026-10-26).
  const moreButton = useRef<HTMLButtonElement>(null);
  const toMore = (): void => {
    setTab("more");
    moreButton.current?.focus();
  };
  const moreBack: MoreBack = { go: toMore, held: sending };
  // So on «Сьогодні», and on «Замовлення», for whoever leaves «Сьогодні» by
  // a tag's verb or comes back to it.
  const todayButton = useRef<HTMLButtonElement>(null);
  const ordersButton = useRef<HTMLButtonElement>(null);
  const todayBack: MoreBack = {
    go: () => {
      setTab("today");
      todayButton.current?.focus();
    },
    // Held as «Сьогодні» in the menu is.
    held: sending || blocked,
    to: "Сьогодні",
  };
  // So on «Гроші», for whoever comes back to it.
  const moneyButton = useRef<HTMLButtonElement>(null);
  const toMoney = (): void => {
    setTab("money");
    moneyButton.current?.focus();
  };
  const moneyBack: MoreBack = { go: toMoney, held: sending, to: "Гроші" };
  // So on a model's detail, and on what it opened: «Продаж» marked all
  // along, the focus stays on it (review, 2026-11-01).
  const saleButton = useRef<HTMLButtonElement>(null);
  const tillBack: MoreBack = {
    go: () => {
      setTab("sale");
      saleButton.current?.focus();
    },
    held: sending,
    to: "Продаж",
  };
  /** A screen the model's detail opens, or the detail itself. */
  const fromModelTo = (section: Tab): void => {
    setTab(section);
    (modelFromStock ? moreButton : saleButton).current?.focus();
  };
  // So on a model's detail «Залишки» opened (stage 2, goods task list,
  // P2-5).
  const stockBack: MoreBack = {
    go: () => {
      setTab("stock");
      moreButton.current?.focus();
    },
    held: sending,
    to: "Залишки",
  };
  const modelBack = (section: Tab): MoreBack =>
    fromModel === section && model
      ? {
          go: () => {
            fromModelTo("model");
          },
          held: sending,
          to: visible(model.name),
        }
      : moreBack;
  /** A section opened from «Гроші», «← Гроші» over it. */
  const fromMoneyTo = (section: Tab) => (): void => {
    setTab(section);
    setFromMoney(section);
    moneyButton.current?.focus();
  };
  /** The «←» of a section in «Ще»: back where it was opened from — «Гроші»'s
   * own screens there for whoever has it, whatever opened them. */
  const backOf = (section: Tab): MoreBack =>
    fromToday === section
      ? todayBack
      : fromMoney === section ||
          (canSeeReport && moneyScreens.includes(section))
        ? moneyBack
        : moreBack;
  /** An invoice in «Накладні», opened from outside them (stage 2, money
   * task list, P1-3): marked as «Накладні» are. */
  const openInvoice = (which: InvoiceOpening): void => {
    setInvoiceOpening(which);
    setOpeningEpoch((epoch) => epoch + 1);
    setTab("invoices");
    (canSeeReport ? moneyButton : moreButton).current?.focus();
  };
  /** One of «Ще»'s screens, from another's way. */
  const toSection = (section: Tab): void => {
    setTab(section);
    moreButton.current?.focus();
  };
  // «Позичене й під реалізацію»'s «←»: where it was opened (P1-3).
  const borrowedBack: MoreBack =
    borrowedFrom === "more"
      ? backOf("borrowed")
      : borrowedFrom === "suppliers"
        ? {
            go: () => {
              toSection("suppliers");
            },
            held: sending || suppliersHeld,
            to: "Постачальникам",
          }
        : {
            go: () => {
              openInvoice({
                id: borrowedFrom.id,
                supplierId: borrowedFrom.supplier.id,
                invoice: borrowedFrom,
              });
            },
            held: sending || otherThanInvoices,
            to: "Накладна",
          };
  /** A tag's verb: its section, with «← Сьогодні». */
  const fromTag = (section: Tab) => (): void => {
    setTab(section);
    setFromToday(section);
    todayButton.current?.focus();
  };
  /** A row of «Сьогодні»'s search: the model's detail or the customer's
   * card, with «← Сьогодні»; an order's card in «Замовлення», as the
   * parcels' verb opens it (frame task list, P2-2). */
  const foundModel = (opened: Opened, typed: string): void => {
    setTodayTyped(typed);
    setModel(opened);
    setModelFromStock(false);
    setTab("model");
    setFromToday("model");
    todayButton.current?.focus();
  };
  const foundCustomer = (customer: Phoned, typed: string): void => {
    setTodayTyped(typed);
    setTodayCustomer({ customer, epoch: creditEpoch });
    setTab("credits");
    setFromToday("credits");
    todayButton.current?.focus();
  };
  const foundOrder = (order: Order, typed: string): void => {
    setTodayTyped(typed);
    setTab("list");
    setSelectedId(order.id);
    setOpening(order);
    setOrderSheet(null);
    setSheetRefused(false);
    setOrderDone(null);
    setCollected(null);
    setOrdersView(freshOrdersView);
    setTodayOrder(order.id);
    ordersButton.current?.focus();
  };
  /** «Замовлення» afresh, from «Сьогодні»'s parcels. */
  const ordersFromToday = (): void => {
    setTab("list");
    setSelectedId(null);
    setOrdersView(freshOrdersView);
    ordersButton.current?.focus();
  };
  // Back on «Сьогодні» or on «Ще», a section is opened afresh from there.
  useEffect(() => {
    if (tab === "today" || tab === "more") setFromToday(null);
    if (tab === "today" || tab === "more" || tab === "money")
      setFromMoney(null);
    if (tab !== "borrowed" && tab !== "invoices") setBorrowedFrom("more");
    if (tab !== "invoices") setInvoiceOpening(null);
    if (tab !== "suppliers" && tab !== "invoices") setReturnOpen(null);
    if (tab !== "openings") setOpeningsOpened(null);
  }, [tab]);
  // Anywhere but the model and what it opened, its way back is forgotten,
  // and the search it held: the till takes it as it opens, once — opened
  // afresh, a kept sale settled say, it starts with none (review,
  // 2026-11-01).
  useEffect(() => {
    if (tab === "model" || tab === fromModel) return;
    setFromModel(null);
    setTillTyped("");
  }, [tab, fromModel]);
  // «Сьогодні»'s search, anywhere but «Сьогодні» and what a result opened,
  // is forgotten, with that way back: «Сьогодні» opens on the day again.
  useEffect(() => {
    const found =
      (fromToday === "model" && (tab === "model" || tab === fromModel)) ||
      (fromToday === "credits" && tab === "credits") ||
      (todayOrder !== null && tab === "list" && selectedId === todayOrder);
    if (tab === "today" || found) return;
    setTodayTyped("");
    setTodayCustomer(null);
    setTodayOrder(null);
    if (fromToday === "model" || fromToday === "credits") setFromToday(null);
  }, [tab, fromToday, fromModel, todayOrder, selectedId]);
  // Opened on «Замовлення» with no till to open first, by whoever may not
  // read them: the first section shown instead (orders task list, P2-1) —
  // unless a kept operation turned to its own tab meanwhile (review,
  // 2026-10-25).
  // Whoever may not read orders opens on the first tab shown — «Ще», for
  // whoever has no other — never on a task's screen (§4а).
  const firstShown: Tab | undefined =
    shown.find((section) => section.tabbed)?.tab ??
    (hasMore ? "more" : undefined);
  // So with «Сьогодні», once the report's right is gone while it is open.
  useEffect(() => {
    if (tab === "list" && !canSeeOrders && firstShown !== undefined)
      setTab((now) => (now === "list" ? firstShown : now));
    if (tab === "today" && !canSeeReport && firstShown !== undefined)
      setTab((now) => (now === "today" ? firstShown : now));
    // And with «Гроші» and the screens it stands for.
    if (
      (tab === "money" || tab === "closes" || tab === "report") &&
      !canSeeReport &&
      firstShown !== undefined
    )
      setTab((now) => (now === tab ? firstShown : now));
    // And with «Перевірка каталогу», whose row is shown with its right
    // alone: «Ще» instead, nothing said of the rule (stage 2, goods task
    // list, P1-5) — once no operation of it is kept, which its screen
    // checks and settles (review).
    if (
      tab === "catalog" &&
      !canConfirmCatalog &&
      !catalogKept &&
      firstShown !== undefined
    )
      setTab((now) =>
        now === "catalog" ? (hasMore ? "more" : firstShown) : now,
      );
  }, [
    tab,
    canSeeOrders,
    canSeeReport,
    canConfirmCatalog,
    catalogKept,
    hasMore,
    firstShown,
  ]);
  // A first send is its dock's to say: an attempt is shown as kept only
  // once its answer is lost, or while it is checked again («Усе на бірці»
  // task list, P0-2).
  const keptSale =
    saleCommand.busy && saleCommand.firstSend ? null : saleCommand.pending;
  const keptReturn =
    returnCommand.busy && returnCommand.firstSend
      ? null
      : returnCommand.pending;
  const keptCredit =
    creditCommand.busy && creditCommand.firstSend
      ? null
      : creditCommand.pending;
  // A delivery's press turns its own ring (stage 2, orders task list, P0-1);
  // a correction's and a count's step aside, and their stub is what says
  // they are sent.
  const keptReceipt =
    receiptCommand.busy && receiptCommand.firstSend
      ? null
      : receiptCommand.pending;
  const silent = useReach((reach) => reach.down);
  // The suppliers' and the invoices' (stage 2, money task list, P0-6): a
  // first send turns its own button's ring, as a delivery's.
  const keptInvoice =
    invoiceCommand.busy && invoiceCommand.firstSend
      ? null
      : invoiceCommand.pending;
  const keptSupplierReturn =
    supplierCommand.busy && supplierCommand.firstSend
      ? null
      : supplierCommand.pending;
  // Borrowed goods marked sold, or sent back, are «Позичене й під
  // реалізацію»'s (stage 2, money task list, P0-6).
  const invoiceOwn = (body: InvoiceBody): boolean =>
    tab ===
    (body.kind === "sold" && canReturnToSupplier ? "borrowed" : "invoices");
  const returnOwn = (lot: string | null | undefined): boolean =>
    tab === (lot ? "borrowed" : "suppliers");
  // Under either: why it is still unconfirmed, or — refused — why, while
  // that refusal stands.
  const invoiceSaid = keptInvoice
    ? keptSaid(
        invoiceCommand.error,
        invoiceKept[keptInvoice.body.kind],
        invoiceCommand.misses,
      )
    : invoiceRefused !== null && invoiceCommand.error === invoiceRefused.error
      ? invoiceRefused.said
      : null;
  const supplierSaid = keptSupplierReturn
    ? keptSaid(
        supplierCommand.error,
        supplierReturnKept,
        supplierCommand.misses,
      )
    : supplierRefused !== null &&
        supplierCommand.error === supplierRefused.error
      ? supplierRefused.said
      : null;
  // A correction's own screens: wherever «Виправити залишок» is made — the
  // model's detail, «Інвентаризація» — and «Залишки», whose balances it
  // reads again, where a kept one read from the phone opens.
  const correcting =
    tab === "model" || tab === "stock" || tab === "stocktaking";
  // An order's step answered is recorded: only its order is not shown yet.
  const keptStep =
    pending && !firstSend && !pending.acknowledged ? pending : null;
  // The line under every screen's title: «Змінити магазин» held, too, while
  // a payment's form stands at the till or the cash is counted: «←» is its
  // only way out (spec S21, S26; review, 2026-10-29).
  const line: WorkspaceLine = {
    store: store.name,
    person: me.display_name,
    changeStore,
    changeHeld: blocked || taskScreen,
  };
  // Telegram asks before Бірка closes while the till's basket holds goods —
  // on the till or left for a while — or a sale waits to be checked; the
  // screen is kept upright while the basket is open (spec §4.4; «Усе на
  // бірці» task list, P1-2; В-Т7 (а)).
  const basketGoods = useBasketGoods(
    `${store.id}:${String(saleEpoch)}`,
    store.id,
  );
  // And while any other operation is kept on the phone, as the sale (stage
  // 2, orders task list, P0-1) — never for a first send still in flight,
  // whose attempt is on the phone already (review, 2026-11-05).
  useAskBeforeClosing(
    basketGoods ||
      keptSale !== null ||
      keptReceipt !== null ||
      (adjustmentCommand.pending !== null &&
        !(adjustmentCommand.busy && adjustmentCommand.firstSend)) ||
      (countCommand.pending !== null &&
        !(countCommand.busy && countCommand.firstSend)) ||
      keptStep !== null ||
      (cashCommand.pending !== null &&
        !(cashCommand.busy && cashCommand.firstSend)),
  );
  useLockPortrait(basketGoods);
  // The phone's memory unread, a journal or more: one plate, a line each
  // (stage 2, orders task list, P0-2).
  const unreadKept = [
    catalogStorageError &&
      "Не вдалося прочитати збережену операцію каталогу. Не очищайте дані застосунку; зверніться до менеджера.",
    correctionStorageError &&
      "Не вдалося прочитати збережену зміну каталогу. Не очищайте дані застосунку; зверніться до менеджера.",
    supplierStorageError &&
      "Не вдалося прочитати збережене повернення постачальнику. Не очищайте дані застосунку; зверніться до менеджера.",
    invoiceStorageError &&
      "Не вдалося прочитати збережену операцію з накладною. Не очищайте дані застосунку; зверніться до власника.",
    storesStorageError &&
      "Не вдалося прочитати збережену зміну стану магазину. Не очищайте дані застосунку.",
    cashStorageError &&
      "Не вдалося прочитати збережену операцію каси. Не очищайте дані застосунку; зверніться до менеджера.",
    storageError &&
      "Не вдалося прочитати збережену команду. Створення операцій зупинено. Зверніться до менеджера, не очищайте дані застосунку.",
    saleStorageError &&
      "Не вдалося прочитати збережений продаж. Не очищайте дані застосунку; зверніться до менеджера.",
    receiptStorageError &&
      "Не вдалося прочитати збережене приймання. Не очищайте дані застосунку; зверніться до менеджера.",
    returnStorageError &&
      "Не вдалося прочитати збережене повернення. Не очищайте дані застосунку; зверніться до менеджера.",
    creditStorageError &&
      "Не вдалося прочитати збережений внесок. Не очищайте дані застосунку; зверніться до менеджера.",
    adjustmentStorageError &&
      "Не вдалося прочитати збережене коригування. Не очищайте дані застосунку; зверніться до менеджера.",
    countStorageError &&
      "Не вдалося прочитати збережений підрахунок інвентаризації. Не очищайте дані застосунку; зверніться до менеджера.",
  ].filter((said): said is string => said !== false);
  setScreen(tab);
  return (
    <WorkspaceLineContext.Provider value={line}>
      {/* While the server does not answer, the owner's words once, over
          every screen of the store: each place not read says only «Сервер
          не відповідає.» and «Спробувати ще раз» (G13; stage 2, orders task
          list, P0-3; В-ЗП1 (а)). Gone with the first answer, before «Сервер
          знову відповідає» can stand. Not over a store that does not trade:
          nothing is sold there, on paper or not (review, 2026-11-05). */}
      {silent && trading && (
        <Banner kind="paper" role="status" label="Сервер не відповідає">
          <p>{UNREACHABLE}</p>
        </Banner>
      )}
      {!trading && (
        <Banner kind="blocked" role="status" as="div">
          <p>
            {stateText(store)}. Лише перегляд: продажі, приймання, повернення й
            оплати в цьому магазині зупинено.
          </p>
        </Banner>
      )}
      {/* The menu at the bottom (spec §6.2; «Усе на бірці» task list,
          P0-4); out of the way while a payment's form stands at the till
          or the cash is counted, a task's screen left by «←» (spec S21,
          S26; P0-3). */}
      <TabBar
        away={taskScreen}
        tabs={[
          ...shown.filter((section) => section.tabbed).map(tabOf),
          ...(hasMore
            ? [
                {
                  key: "more",
                  label: "Ще",
                  icon: "tab-more" as const,
                  // The backups' dot on its glyph, read with its name
                  // («Усе на бірці» task list, P1-5).
                  ...(backupsNeedYou
                    ? { attention: "є що перевірити" }
                    : {}),
                  current:
                    tab === "more" ? true : inMore ? ("true" as const) : false,
                  disabled: sending,
                  open: toMore,
                  ref: moreButton,
                },
              ]
            : []),
        ]}
      />
      {unreadKept.length > 0 && (
        <div role="alert">
          {unreadKept.map((said) => (
            <p key={said}>{said}</p>
          ))}
        </div>
      )}
      {/* Kept and confirmed: the stub on the till, a banner over any other
          screen («Усе на бірці» task list, P0-2). */}
      {keptSale && (
        <Kept
          own={tab === "sale"}
          title={
            keptSale.emptyShelf
              ? "Запис нестачі ще не підтверджено"
              : "Продаж ще не підтверджено"
          }
          busy={saleCommand.busy}
          check={{ label: "Перевірити результат продажу", run: checkSale }}
        >
          {/* Which customer it was: the attempt's own sum and way, never
              the server's total (redesign P1-4). */}
          <p>{keptSaleText(keptSale)}</p>
          <p>{keptText(keptSale.since, me.display_name)}</p>
        </Kept>
      )}
      {settled && (
        <Settled own={tab === "sale"}>
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
        </Settled>
      )}
      {shelfSettled && (
        <Banner kind="recorded" role="status">
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
        </Banner>
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
      {/* The journals' kept operations as the sale's: the stub on their
          own screen, a banner over any other, the title the same while
          checked (stage 2, orders task list, P0-1; В-ЗП2 (а)). */}
      {keptReceipt && (
        <Kept
          own={tab === "receive"}
          title="Приймання ще не підтверджено"
          busy={receiptCommand.busy}
          check={{ label: "Перевірити результат приймання", run: checkReceipt }}
        >
          <p>
            Невідомо, чи записано попередню поставку. Перевірте результат — та
            сама поставка не буде прийнята двічі. Поки чекаємо, інші дії
            недоступні.
          </p>
          <p>{keptText(keptReceipt.since, me.display_name)}</p>
        </Kept>
      )}
      {receiptSettled && (
        <Settled own={tab === "receive"}>
          <h3>Приймання записано один раз</h3>
          <button
            onClick={() => {
              setReceiptSettled(false);
            }}
          >
            Зрозуміло
          </button>
        </Settled>
      )}
      {receiptCommand.error !== null && (
        <p role="alert">
          {receiptErrorText(receiptCommand.error, receiptCommand.misses)}
        </p>
      )}
      {keptReturn && (
        <Kept
          own={tab === "returns"}
          title="Повернення ще не підтверджено"
          busy={returnCommand.busy}
          check={{ label: "Перевірити результат повернення", run: checkReturn }}
        >
          {/* Which customer it was: the goods and the sum the attempt kept
              beside its body, never the server's (returns task list, P1-2). */}
          <p>{keptReturnText(keptReturn.body)}</p>
          <p>{keptText(keptReturn.since, me.display_name)}</p>
        </Kept>
      )}
      {returnSettled && (
        <Settled own={tab === "returns"}>
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
        </Settled>
      )}
      {returnCommand.error !== null && (
        <p role="alert">
          {returnErrorText(returnCommand.error, returnCommand.misses)}
        </p>
      )}
      {keptCredit && (
        <Kept
          own={
            tab === "credits" ||
            (tab === "deposit" && keptCredit.body.kind === "payment")
          }
          title={
            keptCredit.body.kind === "payment"
              ? "Внесок ще не підтверджено"
              : "Списання ще не підтверджено"
          }
          busy={creditCommand.busy}
          check={{
            label:
              keptCredit.body.kind === "payment"
                ? "Перевірити результат внеску"
                : "Перевірити результат списання",
            run: checkCredit,
          }}
        >
          {/* Which payment: its sum, way and goods, as the attempt kept them
              (credits task list, P1-2). */}
          <p>{keptCreditText(keptCredit.body)}</p>
          <p>{keptText(keptCredit.since, me.display_name)}</p>
        </Kept>
      )}
      {creditSettled && (
        <Settled
          own={
            tab === "credits" ||
            (tab === "deposit" && creditSettled.kind === "payment")
          }
        >
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
        </Settled>
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
      {adjustmentCommand.pending && (
        <Kept
          own={correcting}
          title="Коригування ще не підтверджено"
          busy={adjustmentCommand.busy}
          check={{
            label: "Перевірити результат коригування",
            run: checkAdjustment,
          }}
        >
          <p>
            Невідомо, чи записано попереднє коригування залишку. Перевірте
            результат — те саме коригування не застосується двічі. Поки чекаємо,
            інші дії недоступні.
          </p>
          <p>{keptText(adjustmentCommand.pending.since, me.display_name)}</p>
        </Kept>
      )}
      {adjustmentSettled && (
        <Settled own={correcting}>
          <h3>Коригування записано один раз</h3>
          <p>
            Облік {adjustmentSettled.quantity_before} →{" "}
            {adjustmentSettled.quantity_after}.
          </p>
          <button
            onClick={() => {
              setAdjustmentSettled(null);
            }}
          >
            Зрозуміло
          </button>
        </Settled>
      )}
      {adjustmentCommand.error !== null && (
        <p role="alert">
          {adjustmentErrorText(
            adjustmentCommand.error,
            adjustmentCommand.misses,
          )}
        </p>
      )}
      {countCommand.pending && (
        <Kept
          own={tab === "stocktaking"}
          title="Підрахунок ще не підтверджено"
          busy={countCommand.busy}
          check={{ label: "Перевірити результат підрахунку", run: checkCount }}
        >
          <p>
            Невідомо, чи записано попередній підрахунок інвентаризації.
            Перевірте результат — той самий підрахунок не застосується двічі.
            Поки чекаємо, інші дії недоступні.
          </p>
          <p>{keptText(countCommand.pending.since, me.display_name)}</p>
        </Kept>
      )}
      {countSettled && (
        <Settled own={tab === "stocktaking"}>
          <h3>Підрахунок записано один раз</h3>
          <p>
            {countSettled.quantity_delta === 0
              ? `Збігається з обліком (${String(countSettled.counted_quantity)}).`
              : `Облік ${String(countSettled.quantity_before)} → ${String(countSettled.counted_quantity)}.`}
          </p>
          <button
            onClick={() => {
              setCountSettled(null);
            }}
          >
            Зрозуміло
          </button>
        </Settled>
      )}
      {countCommand.error !== null && (
        <p role="alert">
          {countErrorText(countCommand.error, countCommand.misses)}
        </p>
      )}
      {/* The invoices' and the suppliers' kept operations, as the sale's —
          checked by their button alone, so nothing says the phone checks
          every 20 s (G11; stage 2, money task list, P0-6; В1 (а)). */}
      {keptInvoice && (
        <Kept
          own={invoiceOwn(keptInvoice.body)}
          title={`${invoiceKept[keptInvoice.body.kind].what} ще не підтверджено`}
          busy={invoiceCommand.busy}
          byItself={false}
          check={{
            label: invoiceKept[keptInvoice.body.kind].check,
            run: checkInvoice,
          }}
        >
          <p>{invoiceKept[keptInvoice.body.kind].unknown}</p>
          {keptInvoice.since && <p>{waitsText(keptInvoice.since)}</p>}
        </Kept>
      )}
      {invoiceSettled && (
        <Settled own={invoiceOwn(invoiceSettled.body)}>
          <h3>{`${invoiceKept[invoiceSettled.body.kind].what} записано один раз`}</h3>
          <p>{invoiceDoneText(invoiceSettled.invoice, invoiceSettled.body)}</p>
          <button
            onClick={() => {
              setInvoiceSettled(null);
            }}
          >
            Зрозуміло
          </button>
        </Settled>
      )}
      {invoiceSaid !== null && <p role="alert">{invoiceSaid}</p>}
      {keptSupplierReturn && (
        <Kept
          own={returnOwn(keptSupplierReturn.body.stock_lot_id)}
          title={`${supplierReturnKept.what} ще не підтверджено`}
          busy={supplierCommand.busy}
          byItself={false}
          check={{
            label: supplierReturnKept.check,
            run: checkSupplierReturn,
          }}
        >
          <p>{supplierReturnKept.unknown}</p>
          {keptSupplierReturn.since && (
            <p>{waitsText(keptSupplierReturn.since)}</p>
          )}
        </Kept>
      )}
      {supplierSettled && (
        <Settled own={returnOwn(supplierSettled.stock_lot_id)}>
          <h3>{`${supplierReturnKept.what} записано один раз`}</h3>
          <p>{returnedText(supplierSettled)}</p>
          <button
            onClick={() => {
              setSupplierSettled(null);
            }}
          >
            Зрозуміло
          </button>
        </Settled>
      )}
      {supplierSaid !== null && <p role="alert">{supplierSaid}</p>}
      {/* Which step and which order (orders task list, P1-1), named as the
          order's refusals name it (owner decision, 2026-10-20): the stub on
          «Замовлення» and «Нове замовлення», a banner over any other
          screen; answered, it is recorded, its stub torn off, and only its
          order waits to be shown (stage 2, orders task list, P0-1). */}
      {keptStep && (
        <Kept
          own={tab === "list" || tab === "new"}
          title={`Операцію «${visible(keptStep.label)}» ще не підтверджено`}
          busy={busy}
          check={{ label: "Перевірити результат замовлення", run: checkOrder }}
        >
          <p>{keptStepText(keptStep)}</p>
          {/* An order's step is never typed from paper: one not recorded is
              made again here, and one recorded the server refuses by its
              status (owner decision, 2026-10-23, В4 (а)). */}
          <p>{keptCashText(keptStep.since)}</p>
        </Kept>
      )}
      {pending && !firstSend && pending.acknowledged && (
        <Settled own={tab === "list" || tab === "new"}>
          <h3>{`Операцію «${visible(pending.label)}» записано`}</h3>
          <p>{keptStepText(pending)}</p>
          <CheckLine busy={busy} />
          <button
            type="button"
            className={tab === "list" || tab === "new" ? "quiet" : undefined}
            disabled={busy}
            onClick={() => {
              noteChecked();
              checkOrder();
            }}
          >
            Оновити результат
          </button>
        </Settled>
      )}
      {error !== null &&
        // A new order refused: said on its screen, over «Куди», or on its
        // line (stage 2, orders task list, P0-5); a step refused in its
        // sheet, there.
        error !== newRefused &&
        !(sheetRefused && orderSheet !== null) && (
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
      {tab === "today" ? (
        canSeeReport ? (
          <Today
            token={token}
            scopeKey={reportKey}
            stores={me.stores}
            open={store}
            readsBackups={canSeeBackups}
            held={blocked}
            verbs={{
              ...(canSeeBackups ? { backups: fromTag("backups") } : {}),
              ...(canSeeOrders ? { parcels: ordersFromToday } : {}),
              ...(canSeeDamaged ? { damaged: fromTag("damaged") } : {}),
              ...(store.permissions.includes("snapshot:approve")
                ? {
                    openings: (opens?: string) => {
                      setOpeningsOpened(opens ?? null);
                      fromTag("openings")();
                    },
                  }
                : {}),
              // Where this person makes the lists: one to finish, or the
              // first to begin (stage 2, admin task list, P0-1, P0-2).
              ...(store.permissions.includes("snapshot:import")
                ? { finish: fromTag("openings"), first: fromTag("openings") }
                : {}),
            }}
            toOrders={canSeeOrders && !blocked ? ordersFromToday : undefined}
            search={
              canSeeStock || canSeeCredits || canSeeOrders
                ? {
                    typed: todayTyped,
                    ...(canSeeStock ? { model: foundModel } : {}),
                    ...(canSeeCredits ? { customer: foundCustomer } : {}),
                    ...(canSeeOrders ? { order: foundOrder } : {}),
                  }
                : undefined
            }
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "sale" ? (
        store.permissions.includes("sale:create") ? (
          <Sale
            key={saleEpoch}
            keptAt={`${store.id}:${String(saleEpoch)}`}
            mode={tillModes("sale")}
            store={store}
            token={token}
            userId={me.user_id}
            others={stockElsewhere}
            journalKey={saleKey}
            searchFirst={searchFirst}
            typed={tillTyped}
            {...(canSeeStock
              ? {
                  openModel: (opened: Opened, typed: string) => {
                    setModel(opened);
                    setModelFromStock(false);
                    setTillTyped(typed);
                    fromModelTo("model");
                  },
                }
              : {})}
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
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "receive" ? (
        canReceive ? (
          <Receive
            key={receiveEpoch}
            store={store}
            token={token}
            journalKey={receiptKey}
            back={modelBack("receive")}
            model={
              fromModel === "receive" && model
                ? {
                    product_variant_id: model.variantId,
                    display_name: model.name,
                  }
                : null
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
              adjustmentUnsettled ||
              returnUnsettled ||
              creditUnsettled ||
              cashUnsettled
            }
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "stock" ? (
        stockListed ? (
          <Stock
            store={store}
            token={token}
            scopeKey={key}
            place={stockPlace?.scope === key ? stockPlace.place : ""}
            choose={(place) => {
              setStockPlace({ scope: key, place });
            }}
            open={(opened) => {
              setModel(opened);
              setModelFromStock(true);
              setTab("model");
              moreButton.current?.focus();
            }}
            back={moreBack}
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "model" ? (
        model && canSeeStock ? (
          <Model
            key={`${model.variantId}:${model.query}`}
            store={store}
            token={token}
            scopeKey={key}
            journalKey={adjustmentKey}
            opened={model}
            blocked={
              otherThanAdjustment || adjustmentStorageError || countStorageError
            }
            back={
              fromToday === "model"
                ? todayBack
                : modelFromStock
                  ? stockBack
                  : tillBack
            }
            receive={() => {
              fromModelTo("receive");
              setFromModel("receive");
            }}
            stocktake={() => {
              fromModelTo("stocktaking");
              setFromModel("stocktaking");
            }}
          />
        ) : null
      ) : tab === "stocktaking" ? (
        canStocktake ? (
          <Stocktaking
            store={store}
            token={token}
            scopeKey={key}
            journalKey={adjustmentKey}
            countKey={countKey}
            blocked={
              otherThanAdjustment || adjustmentStorageError || countStorageError
            }
            back={modelBack("stocktaking")}
            task={setStocktakeTask}
          />
        ) : null
      ) : tab === "returns" ? (
        canReturn ? (
          <Returns
            key={returnsEpoch}
            mode={tillModes("returns")}
            task={setReturnTask}
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
      ) : tab === "deposit" ? (
        canDeposit ? (
          // The same list and debt as «Покупці», a payment's alone (spec S08,
          // S21; «Усе на бірці» task list, P0-3).
          <Credits
            // Its own, never «Покупці»'s: a debt, a result or a search left
            // here is not carried there, nor back (review, 2026-10-29).
            key={`deposit:${String(creditEpoch)}`}
            mode={tillModes("deposit")}
            till={{ task: setDepositTask, others: depositOthers }}
            store={store}
            token={token}
            journalKey={creditKey}
            {...(store.permissions.includes("sale:create")
              ? {
                  sell: () => {
                    setSearchFirst(true);
                    setTab("sale");
                  },
                }
              : {})}
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
              cashUnsettled ||
              // At the till, as «Продати»: whatever holds every other tab
              // holds it too.
              storesUnsettled ||
              supplierUnsettled ||
              invoiceUnsettled ||
              correctionUnsettled
            }
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "credits" ? (
        canSeeCredits ? (
          <Credits
            key={creditEpoch}
            back={backOf("credits")}
            opened={
              fromToday === "credits" && todayCustomer?.epoch === creditEpoch
                ? todayCustomer.customer
                : undefined
            }
            stores={depositOthers}
            payTask={setDepositTask}
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
        canSeeDamaged ? (
          <Damaged
            store={store}
            token={token}
            blocked={blocked}
            readOnly={!trading}
            back={backOf("damaged")}
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "more" ? (
        <More groups={moreGroups} foot={signedInAs} />
      ) : tab === "catalogue" ? (
        <More
          title="Товар і каталог"
          groups={[{ title: "", rows: catalogueRows }]}
          back={moreBack}
        />
      ) : tab === "openings" ? (
        canSeeOpenings ? (
          <Openings
            store={store}
            token={token}
            scopeKey={key}
            blocked={blocked}
            back={backOf("openings")}
            task={setOpeningsTask}
            opened={openingsOpened}
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "backups" ? (
        canSeeBackups ? (
          <Backups
            token={token}
            scopeKey={backupsKey}
            back={backOf("backups")}
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "suppliers" ? (
        canReturnToSupplier ? (
          <Suppliers
            key={suppliersEpoch}
            store={store}
            token={token}
            journalKey={supplierKey}
            blocked={otherThanSuppliers}
            back={moreBack}
            task={setSupplierTask}
            opened={returnOpen}
            forget={() => {
              setReturnOpen(null);
            }}
            openInvoice={
              canSeeInvoices
                ? {
                    go: (setOff, item) => {
                      setReturnOpen(item);
                      openInvoice({
                        id: setOff.invoice_id,
                        supplierId: item.supplier.id,
                        leave: {
                          go: () => {
                            toSection("suppliers");
                          },
                          held: sending || suppliersHeld,
                          to: "Повернення",
                        },
                      });
                    },
                    held: otherThanInvoices,
                  }
                : undefined
            }
            openBorrowed={{
              go: () => {
                setBorrowedFrom("suppliers");
                toSection("borrowed");
              },
              held: suppliersHeld,
            }}
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "borrowed" ? (
        canReturnToSupplier ? (
          <Borrowed
            key={suppliersEpoch}
            store={store}
            token={token}
            journalKey={supplierKey}
            invoiceJournalKey={invoiceKey}
            blocked={otherThanSuppliers}
            back={borrowedBack}
            openInvoice={
              canSeeInvoices
                ? {
                    go: (invoice) => {
                      openInvoice({
                        id: invoice.id,
                        supplierId: invoice.supplier.id,
                        invoice,
                        leave: {
                          go: () => {
                            toSection("borrowed");
                          },
                          held: sending || suppliersHeld,
                          to: "Позичене й під реалізацію",
                        },
                      });
                    },
                    held: otherThanInvoices,
                  }
                : undefined
            }
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "invoices" ? (
        canSeeInvoices ? (
          <Invoices
            key={`${String(suppliersEpoch)}:${String(openingEpoch)}`}
            store={store}
            token={token}
            journalKey={invoiceKey}
            blocked={otherThanInvoices}
            readOnly={!trading}
            networkOwner={me.organization_permissions.includes(
              "supplier:write_off",
            )}
            back={backOf("invoices")}
            task={setInvoiceTask}
            // Its way back held as that screen's row is now, not as it was
            // at the tap that opened it.
            opening={
              invoiceOpening?.leave
                ? {
                    ...invoiceOpening,
                    leave: {
                      ...invoiceOpening.leave,
                      held: sending || suppliersHeld,
                    },
                  }
                : invoiceOpening
            }
            openBorrowed={
              canReturnToSupplier
                ? {
                    go: (invoice) => {
                      setBorrowedFrom(invoice);
                      toSection("borrowed");
                    },
                    held: suppliersHeld,
                  }
                : undefined
            }
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "models" ? (
        canCorrect && trading ? (
          <Models
            store={store}
            token={token}
            journalKey={correctionKey}
            loaded={fromDisk.has("correction")}
            // Its own journal unread: nothing sent, the plate says why.
            blocked={otherThanCorrections || correctionStorageError}
            back={moreBack}
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
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
            back={cashTab ? undefined : backOf("cash")}
            task={setCashTask}
          />
        ) : // The right gone while «Каса» was open: nothing is said of the
        // rule, as «Покупці» (cash task list, P2-1).
        null
      ) : tab === "money" ? (
        canSeeReport ? (
          <Money
            token={token}
            scopeKey={reportKey}
            stores={me.stores}
            period={moneyPeriod}
            choose={setMoneyPeriod}
            held={sending}
            toCustomers={
              canSeeCredits
                ? { go: fromMoneyTo("credits"), disabled: otherThanCredit }
                : undefined
            }
            toInvoices={
              canSeeInvoices
                ? { go: fromMoneyTo("invoices"), disabled: otherThanInvoices }
                : undefined
            }
            toReport={{
              disabled: blocked,
              open: (range) => {
                setReportPeriod({ mode: moneyPeriod, range });
                fromMoneyTo("report")();
              },
            }}
            rows={[
              {
                key: "closes",
                label: "Закриття",
                icon: "clock",
                disabled: otherThanCash,
                open: fromMoneyTo("closes"),
              },
              ...(canSeeCash
                ? [
                    {
                      key: "cash",
                      label: `Каса · ${visible(store.name)}`,
                      icon: "drawer" as const,
                      disabled: otherThanCash,
                      open: fromMoneyTo("cash"),
                    },
                  ]
                : []),
            ]}
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "closes" ? (
        canSeeReport ? (
          <History store={store} token={token} back={toMoney} backTo="Гроші" />
        ) : null
      ) : tab === "report" ? (
        canSeeReport ? (
          <SalesReport
            token={token}
            scopeKey={reportKey}
            back={backOf("report")}
            period={reportPeriod}
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "stores" ? (
        canManageStores ? (
          <Stores
            storeId={store.id}
            token={token}
            journalKey={storesKey}
            // Its own kept change unreadable: nothing to change it with
            // either (review, 2026-11-07).
            blocked={otherThanStores || storesStorageError}
            changed={storesChanged}
            back={moreBack}
          />
        ) : // Never opened without the right: nothing is said of the rule
        // («Усе на бірці» task list, P2-1).
        null
      ) : tab === "catalog" ? (
        canConfirmCatalog || catalogKept ? (
          <Catalog
            store={store}
            token={token}
            journalKey={catalogKey}
            storageError={
              catalogStorageError || storageError || busy || pending !== null
            }
            person={me.display_name}
            back={moreBack}
          />
        ) : // Its row is shown with the right alone: without it, nothing is
        // said of the rule, and «Ще» opens instead (stage 2, goods task
        // list, P1-5).
        null
      ) : tab === "new" ? (
        <NewOrder
          store={store}
          token={token}
          journalKey={saleKey}
          blocked={blocked}
          waiting={busy && firstSend}
          refused={newRefused}
          said={
            newRefused === null || error !== newRefused
              ? null
              : orderErrorText(
                  error,
                  orderResent,
                  pending !== null && !pending.acknowledged,
                  orderMisses,
                  pending?.label ?? null,
                  pending?.acknowledged === true,
                )
          }
          back={() => {
            setTab("list");
          }}
          submit={(lines, destination, carrier, shown) => {
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
              shown,
            });
          }}
        />
      ) : !canSeeOrders ? null : selectedId ? (
        detail.data === undefined ? (
          // In the card's own frame, its way back and its title's place
          // where the card's will stand: nothing moves when it comes
          // (orders task list, P2-2).
          <>
            <ScreenHeader
              pushed
              waiting={detail.isPending}
              back={
                <Back
                  go={() => {
                    setSelectedId(null);
                    setOrderSheet(null);
                    setOrderDone(null);
                    setCollected(null);
                  }}
                >
                  ← До замовлень
                </Back>
              }
            />
            <section className="order">
              {detail.isPending ? (
                <CardPlaceholder />
              ) : (
                <Unread
                  error={detail.error}
                  retry={() => {
                    void detail.refetch();
                  }}
                />
              )}
            </section>
          </>
        ) : (
          // «← До замовлень» its own: where it goes is a step with its own
          // way back (orders task list, P1-3). Read again and failed — the
          // phone back from the carrier's app, a refusal's re-read — the
          // card as last read stays, what was typed with it, and why over
          // it (review, 2026-10-25).
          <>
            {detail.error && (
              <Unread
                error={detail.error}
                retry={() => {
                  void detail.refetch();
                }}
              />
            )}
            <OrderDetail
              // Afresh once it moves on or says where it goes otherwise, so
              // no form keeps what it showed before — and after every step
              // it took, so a tap carried from it is let go.
              key={`${detail.data.id}:${detail.data.status}:${String(
                detail.data.shipping_history?.length ?? 0,
              )}:${String(orderEpoch)}`}
              order={detail.data}
              done={orderDone?.id === detail.data.id ? orderDone : null}
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
              waiting={busy}
              sheet={orderSheet?.id === detail.data.id}
              openSheet={(kind, writing = false) => {
                setOrderSheet({ id: detail.data.id, kind, writing });
                setSheetRefused(false);
              }}
              back={() => {
                setSelectedId(null);
                setOrderSheet(null);
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
                  shown: stepShown(detail.data, extra),
                });
              }}
              // The same waybill's other order, opened at its top.
              openOther={(id) => {
                setSelectedId(id);
                setOrderSheet(null);
                setOrderDone(null);
                setCollected(null);
                window.scrollTo(0, 0);
              }}
            />
          </>
        )
      ) : (
        <Orders
          store={store}
          token={token}
          blocked={blocked}
          view={ordersView}
          change={setOrdersView}
          open={(order, then) => {
            setSelectedId(order.id);
            setOpening(order);
            setOrderSheet(then ? { id: order.id, kind: then } : null);
            setSheetRefused(false);
            setOrderDone(null);
            setCollected(null);
          }}
          arrive={(order) =>
            run(
              {
                path: `/orders/${order.id}/arrive`,
                body: { command_id: crypto.randomUUID() },
                label: actionLabels.arrive ?? "Прибув на пошту",
                orderId: order.id,
                shown: stepShown(order),
              },
              false,
              true,
            ).then((recorded) => recorded !== null)
          }
          create={() => {
            setTab("new");
            setSelectedId(null);
          }}
        />
      )}
      {stepSheet()}
    </WorkspaceLineContext.Provider>
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
 * A kept order step's line (orders task list, P1-1): the operation the
 * subject (owner decision after #136, 2026-10-25), said by name after a
 * line of goods; answered, only its order is not shown yet.
 */
function keptStepText(step: Pending): string {
  const subject = step.shown
    ? visible(step.shown)
    : `Операція «${visible(step.label)}»`;
  return `${subject} — ${
    step.acknowledged
      ? "замовлення ще не вдалося показати."
      : "сервер не відповів. Двічі цю операцію не запишуть."
  } Поки чекаємо, інші дії недоступні.`;
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
