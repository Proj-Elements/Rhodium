"use client";

import type { ComponentProps } from "react";
import { Button, Tooltip } from "@heroui/react";
import { Icon, type IconName } from "@/components/icon";

type IconButtonProps = Omit<ComponentProps<typeof Button>, "children" | "isIconOnly" | "aria-label"> & { icon: IconName; label: string };

/** An icon action with a shared accessible name and discoverable tooltip. */
export function IconButton({ icon, label, variant = "ghost", ...props }: IconButtonProps) {
  return (
    <Tooltip delay={350}>
      <Button {...props} variant={variant} isIconOnly aria-label={label}><Icon name={icon} size={17} /></Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}
