import { Slot } from "@radix-ui/react-slot";
import type { ComponentProps } from "react";
import { twMerge } from "tailwind-merge";

export function Button({ asChild, className, variant = "primary", ...props }: ComponentProps<"button"> & {
  asChild?: boolean;
  variant?: "primary" | "secondary" | "quiet";
}) {
  const Component = asChild ? Slot : "button";
  return <Component data-slot="button" {...props} className={twMerge("button", variant, className)} />;
}
