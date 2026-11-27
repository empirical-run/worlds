import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "secondary";

function buttonClass(variant: ButtonVariant) {
  return variant === "primary" ? "button primary" : "button";
}

export function Button({
  variant = "secondary",
  type = "button",
  ...props
}: Omit<ComponentProps<"button">, "className"> & { variant?: ButtonVariant }) {
  return <button className={buttonClass(variant)} type={type} {...props} />;
}

export function ButtonLink({
  variant = "secondary",
  children,
  ...props
}: Omit<ComponentProps<"a">, "className"> & { variant?: ButtonVariant }) {
  return (
    <a className={buttonClass(variant)} {...props}>
      {children}
    </a>
  );
}

export function TextButton({
  type = "button",
  ...props
}: Omit<ComponentProps<"button">, "className">) {
  return <button className="text-button" type={type} {...props} />;
}
