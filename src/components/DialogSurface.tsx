import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

export function DialogSurface({
  ariaLabel,
  ariaLabelledBy,
  children,
  className,
  disableEscape = false,
  disableFocusTrap = false,
  layerClassName = "modal-layer",
  onClose
}: {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  children: ReactNode;
  className: string;
  disableEscape?: boolean;
  disableFocusTrap?: boolean;
  layerClassName?: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ active: boolean; lastDelta: number; pointerId: number; startY: number } | null>(null);
  const supportsSwipeDismiss = className
    .split(/\s+/)
    .some((name) => ["detail-sheet", "form-sheet", "profile-sheet", "insights-sheet", "filter-sheet"].includes(name));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const firstFocusable = getFocusableElements(dialog)[0];
      (firstFocusable ?? dialog).focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !disableEscape) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || disableFocusTrap) return;

      const focusable = getFocusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (active instanceof HTMLElement && !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [disableEscape, disableFocusTrap, onClose]);

  return (
    <div
      className={layerClassName}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-modal="true"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          if (!supportsSwipeDismiss || window.innerWidth >= 720) return;
          if (event.pointerType === "mouse" && event.button !== 0) return;

          const target = event.target as HTMLElement;
          const sheet = event.currentTarget;
          const topOffset = event.clientY - sheet.getBoundingClientRect().top;
          if (topOffset > 44) return;
          if (target !== sheet && target.closest("button,a,input,select,textarea,label")) return;

          dragRef.current = { active: true, lastDelta: 0, pointerId: event.pointerId, startY: event.clientY };
          sheet.setPointerCapture?.(event.pointerId);
          sheet.classList.add("is-dragging");
          sheet.style.transition = "none";
          sheet.style.willChange = "transform";
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag?.active || drag.pointerId !== event.pointerId) return;
          const delta = Math.max(0, event.clientY - drag.startY);
          drag.lastDelta = delta;
          if (delta > 2) event.preventDefault();
          event.currentTarget.style.transform = `translateY(${Math.round(delta)}px)`;
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (!drag?.active || drag.pointerId !== event.pointerId) return;
          const shouldClose = drag.lastDelta > 120;
          dragRef.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          event.currentTarget.classList.remove("is-dragging");
          event.currentTarget.style.transition = "";
          event.currentTarget.style.transform = "";
          event.currentTarget.style.willChange = "";
          if (shouldClose) onClose();
        }}
        onPointerCancel={(event) => {
          const drag = dragRef.current;
          if (!drag?.active || drag.pointerId !== event.pointerId) return;
          dragRef.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          event.currentTarget.classList.remove("is-dragging");
          event.currentTarget.style.transition = "";
          event.currentTarget.style.transform = "";
          event.currentTarget.style.willChange = "";
        }}
      >
        {children}
      </article>
    </div>
  );
}
