import React from "react";

type ModalProps = {
  open: boolean;
  onClose(): void;
  title?: string;
  children?: React.ReactNode;
};

export default function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;
  return (
    <div style={backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <strong>{title ?? "Quiz"}</strong>
          <button aria-label="Close" onClick={onClose} style={closeBtn}>x</button>
        </div>
        <div style={{ padding: 12, maxHeight: "70vh", overflow: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(8, 20, 42, 0.58)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999
};

const modal: React.CSSProperties = {
  width: "min(900px, 95%)",
  background: "var(--bg-panel)",
  borderRadius: 12,
  border: "1px solid var(--line-strong)",
  boxShadow: "var(--shadow-strong)",
  overflow: "hidden"
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 12px",
  borderBottom: "1px solid var(--line)",
  background: "var(--bg-soft)",
  color: "var(--ink-strong)"
};

const closeBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  fontSize: 16,
  cursor: "pointer",
  lineHeight: 1,
  color: "var(--ink-body)"
};
