"use client";

import { ReactNode } from "react";
import { clsx } from "clsx";

interface SectionCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: SectionCardProps) {
  return (
    <section
      className={clsx(
        "bg-panel/90 backdrop-blur rounded-3xl border border-border shadow-lg shadow-indigo-100/30 p-8 transition hover:shadow-xl hover:-translate-y-[2px]",
        className,
      )}
    >
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-wide text-primary">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-muted/80">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      <div className="mt-6">{children}</div>
    </section>
  );
}
