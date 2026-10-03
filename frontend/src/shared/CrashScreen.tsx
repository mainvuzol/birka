import { Component, useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { release, reportError } from "@/shared/report";
import { connectTelegram } from "@/shared/telegram";

/**
 * Whether the phone keeps a command that was sent and whose answer is not
 * known yet. Only those are saved: each journal
 * (`birka:<scope>-pending:…`, the orders' `birka:pending:…`) is written just
 * before its request and removed once its outcome is known. A basket still
 * being filled lives only on the screen.
 *
 * Only the keys' names are looked at, never their values: those hold
 * customers' names and phones. Storage that cannot be read promises nothing.
 */
function unansweredCommandKept(): boolean {
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const name = localStorage.key(index);
      if (name?.startsWith("birka:") && name.includes("pending:")) return true;
    }
  } catch {
    /* Blocked or broken storage: say only what is true without it. */
  }
  return false;
}

/**
 * What a seller sees when a screen breaks, instead of a blank page (owner
 * decision, 2026-10-03): «Щось пішло не так» and «Перезапустити».
 *
 * It says which of two cases it is, and never claims a basket was kept
 * (carried out, 2026-10-03). A command sent without an answer is on the
 * phone: reopened, the app finds it and checks it, so it is neither lost nor
 * made twice. Otherwise nothing is saved: a sale that went through shows
 * nothing after the reload, so the seller is told to check before ringing it
 * again, and that a basket not yet sent is gone.
 *
 * It never clears the phone's storage. Reloading keeps the address, and with
 * it Telegram's launch data, so within that data's hour the app signs in
 * again by itself.
 */
function Crashed(): JSX.Element {
  const [kept, setKept] = useState(unansweredCommandKept);
  // A command still on its way when the screen broke is answered a moment
  // later, and its journal removed: the promise must not outlive it.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setKept(unansweredCommandKept());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  // A screen that broke on its first drawing never told Telegram the app is
  // ready, nor took its colours. This screen must not break in turn.
  useEffect(() => {
    try {
      const stop = connectTelegram();
      return () => {
        try {
          stop();
        } catch {
          /* Leaving a screen that is already the last one. */
        }
      };
    } catch {
      return undefined;
    }
  }, []);
  return (
    <main data-crashed="">
      <h1>birka</h1>
      <h2>Щось пішло не так</h2>
      {kept ? (
        <p>
          Операцію, на яку сервер ще не відповів, збережено: після перезапуску
          застосунок покаже її для перевірки. Не очищайте дані застосунку.
        </p>
      ) : (
        <p>
          Якщо ви щойно провели операцію, перевірте, чи її записано, перш ніж
          повторювати. Кошик, який ви ще не надіслали, доведеться скласти
          заново.
        </p>
      )}
      <button
        onClick={() => {
          window.location.reload();
        }}
      >
        Перезапустити
      </button>
      <p>
        <small>Версія {release}</small>
      </p>
    </main>
  );
}

/** Around the whole app: a render that throws ends here, and is noted. */
export class CrashBoundary extends Component<
  { children: ReactNode },
  { crashed: boolean }
> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(error: unknown): void {
    reportError("render", error);
  }

  override render(): ReactNode {
    return this.state.crashed ? <Crashed /> : this.props.children;
  }
}
