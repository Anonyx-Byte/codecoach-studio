import React from "react";

type ModalProps = {
  open: boolean;
  onClose(): void;
  title?: string;
  disableClose?: boolean;
  panelStyle?: React.CSSProperties;
  contentStyle?: React.CSSProperties;
  children?: React.ReactNode;
};

export default function Modal({
  open,
  onClose,
  title,
  disableClose = false,
  panelStyle,
  contentStyle,
  children
}: ModalProps) {
  if (!open) return null;
  return (
    <div style={backdrop} onClick={() => { if (!disableClose) onClose(); }} role="dialog" aria-modal="true">
      <div style={{ ...modal, ...panelStyle }} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <strong>{title ?? "Quiz"}</strong>
          <button aria-label="Close" onClick={() => { if (!disableClose) onClose(); }} style={closeBtn} disabled={disableClose}>
            x
          </button>
        </div>
        <div style={{ ...content, ...contentStyle }}>{children}</div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(10, 10, 15, 0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
  backdropFilter: "blur(10px)"
};

const modal: React.CSSProperties = {
  width: "min(900px, 95%)",
  maxHeight: "86vh",
  background: "var(--bg-panel)",
  borderRadius: 16,
  border: "1px solid var(--line)",
  boxShadow: "var(--shadow-strong)",
  overflow: "hidden"
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 14px",
  borderBottom: "1px solid var(--line)",
  background: "linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 65%), var(--bg-soft)",
  color: "var(--ink-strong)"
};

const content: React.CSSProperties = {
  padding: 12,
  maxHeight: "70vh",
  overflow: "auto"
};

const closeBtn: React.CSSProperties = {
  background: "rgba(99, 102, 241, 0.08)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  width: 32,
  height: 32,
  fontSize: 16,
  cursor: "pointer",
  lineHeight: 1,
  color: "var(--ink-body)"
};
