"use client";

import { JSX, ReactNode, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/provider";

export type SortableSectionItem = {
  id: string;
  title: string;
  content: ReactNode;
  visible?: boolean;
};

type SortableSectionListProps = {
  storageKey: string;
  items: SortableSectionItem[];
};

const DEFAULT_COLLAPSED: Record<string, boolean> = {};

function loadLayout(storageKey: string, itemIds: string[]): {
  order: string[];
  collapsed: Record<string, boolean>;
} {
  let order = itemIds;
  try {
    const raw = window.localStorage.getItem(`${storageKey}:order`);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) {
        const known = parsed.filter(id => itemIds.includes(id));
        const missing = itemIds.filter(id => !known.includes(id));
        if (known.length + missing.length === itemIds.length) {
          order = [...known, ...missing];
        }
      }
    }
  } catch {
    // ponytail: corrupt localStorage entry → fall back to defaults
  }

  let collapsed: Record<string, boolean> = { ...DEFAULT_COLLAPSED };
  try {
    const raw = window.localStorage.getItem(`${storageKey}:collapsed`);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      collapsed = { ...DEFAULT_COLLAPSED, ...parsed };
    }
  } catch {
    // ponytail: corrupt localStorage entry → fall back to defaults
  }

  return { order, collapsed };
}

export default function SortableSectionList({ storageKey, items }: SortableSectionListProps): JSX.Element {
  const { messages } = useI18n();
  const visibleItems = items.filter(item => item.visible !== false);
  const itemIds = visibleItems.map(item => item.id);

  const [order, setOrder] = useState<string[]>(itemIds);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragRef = useRef<number | null>(null);

  useEffect(() => {
    const { order: storedOrder, collapsed: storedCollapsed } = loadLayout(storageKey, itemIds);
    setOrder(storedOrder);
    setCollapsed(storedCollapsed);
  }, [storageKey, itemIds.join("|")]);

  useEffect(() => {
    window.localStorage.setItem(`${storageKey}:order`, JSON.stringify(order));
  }, [storageKey, order]);

  useEffect(() => {
    window.localStorage.setItem(`${storageKey}:collapsed`, JSON.stringify(collapsed));
  }, [storageKey, collapsed]);

  const onDragStart = (e: React.DragEvent<HTMLButtonElement>, index: number) => {
    dragRef.current = index;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const onDragOver = (e: React.DragEvent<HTMLElement>, index: number) => {
    if (dragIndex === null) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (index !== dragOverIndex) {
      setDragOverIndex(index);
    }
  };

  const onDragLeave = (index: number) => {
    if (dragOverIndex === index) {
      setDragOverIndex(null);
    }
  };

  const onDrop = (e: React.DragEvent<HTMLElement>, dropIndex: number) => {
    e.preventDefault();
    const sourceIndex = dragRef.current;
    dragRef.current = null;
    setDragIndex(null);
    setDragOverIndex(null);
    if (sourceIndex === null || sourceIndex === dropIndex) {
      return;
    }
    setOrder(prev => {
      const next = [...prev];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(dropIndex, 0, moved);
      return next;
    });
  };

  const onDragEnd = () => {
    dragRef.current = null;
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const toggle = (id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const byId = new Map(visibleItems.map(item => [item.id, item]));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      {order.map((id, index) => {
        const item = byId.get(id);
        if (!item) return null;
        const isCollapsed = collapsed[id] ?? false;
        const isDragging = dragIndex === index;
        const isDropTarget = dragOverIndex === index && dragIndex !== null && dragIndex !== index;
        return (
          <section
            key={id}
            className={`shrink-0 rounded-lg border border-white/8 bg-slate-900/45 shadow-[0_14px_32px_rgba(0,0,0,0.18)] transition-shadow ${
              isDragging ? "opacity-50" : ""
            } ${isDropTarget ? "ring-2 ring-sky-400/60" : ""}`}
            onDragOver={(e) => onDragOver(e, index)}
            onDragLeave={() => onDragLeave(index)}
            onDrop={(e) => onDrop(e, index)}
          >
            <header className="flex items-center justify-between gap-2 rounded-t-lg bg-zinc-800/70 px-2 py-1.5 text-xs text-zinc-100">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => onDragStart(e, index)}
                  onDragEnd={onDragEnd}
                  aria-label={messages.common.dragHandle}
                  className="cursor-grab select-none rounded p-1 text-zinc-400 hover:bg-zinc-700 active:cursor-grabbing"
                  title={messages.common.dragHandle}
                >
                  ⋮⋮
                </button>
                <span className="font-medium">{item.title}</span>
              </div>
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-label={isCollapsed ? messages.common.expandSection(item.title) : messages.common.collapseSection(item.title)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-700"
              >
                {isCollapsed ? "▼" : "▲"}
              </button>
            </header>
            <div className={isCollapsed ? "hidden" : "block"}>{item.content}</div>
          </section>
        );
      })}
    </div>
  );
}
