import type { ElementType, HTMLAttributes, ReactNode } from "react";

/** The shared Bento tile: rounded card, one job, a small label. `accent` makes it the (single) amber tile on a screen. */
export default function Tile({
  label,
  accent = false,
  as: Tag = "section",
  className = "",
  children,
  ...rest
}: {
  label?: ReactNode;
  accent?: boolean;
  as?: ElementType;
  className?: string;
  children?: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={`tile ${accent ? "tile-accent" : ""} ${className}`} {...rest}>
      {label && <div className="tile-label mb-2">{label}</div>}
      {children}
    </Tag>
  );
}
