import type { JSX, RefObject } from "react";
import { Icon } from "./Icon";

/**
 * The search field (spec §6.6; «Усе на бірці» task list, P0-5): 52 high,
 * the magnifier on its left, what to type as its placeholder, and «×» on
 * its right once something is typed, which empties it and keeps the cursor
 * in it. Its name is read aloud and never seen: the placeholder says it.
 * Built for the till; «Повернути» and «Внесок» take it with their tasks.
 */
export function SearchField({
  label,
  placeholder,
  value,
  change,
  inputRef,
}: {
  label: string;
  placeholder: string;
  value: string;
  change: (text: string) => void;
  inputRef: RefObject<HTMLInputElement>;
}): JSX.Element {
  return (
    <div className="search-field">
      <label>
        <span className="visually-hidden">{label}</span>
        <Icon name="search" size={20} />
        <input
          ref={inputRef}
          type="search"
          maxLength={200}
          enterKeyHint="search"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            change(event.target.value);
          }}
        />
      </label>
      {value !== "" && (
        <button
          type="button"
          className="search-clear"
          aria-label="Очистити пошук"
          onClick={() => {
            change("");
            inputRef.current?.focus();
          }}
        >
          <Icon name="close" size={20} />
        </button>
      )}
    </div>
  );
}
