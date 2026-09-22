import { cn } from "@/lib/utils";
import { useId } from "react";

/**
 * Labelled text input with a hint and an inline error.
 *
 * Used by the checkout form. Errors are wired up with `aria-invalid` and
 * `aria-describedby`, so a screen reader announces the message together with the
 * field instead of leaving the visitor to hunt for it.
 */
type TextFieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  /** Shown under the field, replaced by `error` when there is one. */
  hint?: string;
  error?: string;
  type?: "text" | "email" | "tel" | "number";
  inputMode?: "text" | "email" | "tel" | "numeric";
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
};

export function TextField({
  label,
  name,
  value,
  onChange,
  hint,
  error,
  type = "text",
  inputMode,
  autoComplete,
  placeholder,
  required,
  min,
  max,
  disabled,
  className,
}: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold tracking-tight">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-marigold ml-1">
            *
          </span>
        ) : null}
      </label>

      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "border-border bg-background/60 h-11 w-full rounded-xl border px-3.5 text-sm transition-colors",
          "placeholder:text-muted/50 focus:border-marigold/60 focus:ring-marigold/20 focus:ring-2 focus:outline-none",
          error ? "border-rani/60" : null,
          disabled ? "opacity-60" : null,
        )}
      />

      {error ? (
        <p id={errorId} className="text-rani-soft text-xs font-medium">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-muted/80 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
