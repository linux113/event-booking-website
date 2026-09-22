import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

type LinkHref = ComponentPropsWithoutRef<typeof Link>["href"];

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-marigold text-marigold-foreground shadow-lg shadow-marigold/20 hover:bg-marigold-soft hover:shadow-marigold/30",
  secondary: "border border-border bg-surface-raised/70 text-foreground hover:bg-surface-raised",
  ghost: "text-muted hover:bg-surface-raised/60 hover:text-foreground",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-sm sm:text-base",
  lg: "h-12 px-7 text-base",
};

const baseStyles =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold tracking-tight transition-colors duration-200 disabled:pointer-events-none disabled:opacity-50";

type ButtonBaseProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
};

type ButtonAsLinkProps = ButtonBaseProps & {
  href: LinkHref;
} & Omit<ComponentPropsWithoutRef<typeof Link>, "href" | "className" | "children">;

type ButtonAsButtonProps = ButtonBaseProps & {
  href?: undefined;
} & Omit<ComponentPropsWithoutRef<"button">, "className" | "children">;

export type ButtonProps = ButtonAsLinkProps | ButtonAsButtonProps;

/**
 * The shared button classes.
 *
 * Exported for the few places that need button styling on an element that is
 * neither a `next/link` nor a `<button>` — a download, for instance, has to be a
 * plain `<a download>` so the browser saves the file instead of the router
 * navigating to it.
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: Omit<ButtonBaseProps, "children"> = {}) {
  return cn(baseStyles, variantStyles[variant], sizeStyles[size], className);
}

/** `next/link` styled as a button. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...linkProps
}: ButtonAsLinkProps) {
  return (
    <Link className={buttonClasses({ variant, size, className })} {...linkProps}>
      {children}
    </Link>
  );
}

/** Native `<button>` styled as a button — used for actions, not navigation. */
export function ButtonElement({
  variant = "primary",
  size = "md",
  className,
  children,
  type,
  ...buttonProps
}: ButtonAsButtonProps) {
  return (
    <button
      className={buttonClasses({ variant, size, className })}
      type={type ?? "button"}
      {...buttonProps}
    >
      {children}
    </button>
  );
}

/**
 * Shared button. Renders a `next/link` when `href` is provided, otherwise a `<button>`.
 *
 * @example
 * <Button href="/events">Browse events</Button>
 * <Button onClick={handleClick} variant="secondary">Filter</Button>
 */
export function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    return <ButtonLink {...props} />;
  }

  return <ButtonElement {...props} />;
}
