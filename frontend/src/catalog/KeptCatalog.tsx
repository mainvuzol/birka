import type { JSX } from "react";
import { Kept } from "@/shared/Kept";
import { keptText, useAutoCheck } from "@/shared/reach";
import {
  CANCEL_CREATION_REASON,
  useCatalogCommand,
  useCatalogJournal,
} from "./commands";
import type { Command } from "./commands";

const base = "/catalog/match-decisions";

/**
 * A catalogue operation kept on the phone, its outcome unknown: said where it
 * was sent — «Перевірка каталогу», or the sheet «Нова модель» over another
 * screen — resent unchanged by its button, and checked by the phone itself
 * as the server comes back (ADR-0013 §4.3, G11). An unfinished creation may
 * be cancelled instead. `loaded`: read from the phone's storage as its
 * screen opened, and checked once at once.
 *
 * In the one form every kept operation has (goods task list after stage 2,
 * P1-4): its stub still attached, «Ще не підтверджено» on it, «Перевірити
 * результат операції» — the same operation, never recorded twice — and the
 * phone's checking line, as «Моделі»'s change says it.
 */
export function KeptCatalog({
  loaded,
  run,
}: {
  loaded: boolean;
  run: (command: Command) => Promise<void>;
}): JSX.Element | null {
  const { pending, busy } = useCatalogCommand();
  const person = useCatalogJournal((state) => state.person);
  useAutoCheck([
    {
      pending: pending !== null,
      busy,
      loaded,
      run: () => {
        if (pending) void run(pending);
      },
    },
  ]);
  if (pending === null) return null;
  return (
    <Kept
      own
      title="Операцію каталогу ще не підтверджено"
      busy={busy}
      check={{
        label: "Перевірити результат операції",
        run: () => {
          void run(pending);
        },
      }}
      after={
        pending.path.endsWith("/create-product") && (
          <>
            <p>
              Якщо створення не вдається, можна скасувати пропозицію. Якщо товар
              уже збережено, покажемо результат.
            </p>
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() => {
                void run({
                  path: `${base}/${pending.decisionId}/reject`,
                  decisionId: pending.decisionId,
                  body: { reason: CANCEL_CREATION_REASON },
                  ambiguous: true,
                });
              }}
            >
              Скасувати незавершене створення
            </button>
          </>
        )
      }
    >
      <p>
        Невідомо, чи записано операцію каталогу. Перевірте результат — та сама
        операція не запишеться двічі.
      </p>
      <p>{keptText(pending.since, person)}</p>
    </Kept>
  );
}
