import React, { useEffect } from "react";

export function Modal(props: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props]);

  return (
    <div className="modal-backdrop" onMouseDown={props.onClose} role="dialog" aria-modal="true">
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{props.title}</div>
          <div className="row-actions" style={{ marginLeft: "auto" }}>
            <button className="btn small" onClick={props.onClose} aria-label="닫기">
              닫기
            </button>
          </div>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer ? (
          <div className="modal-header" style={{ borderTop: "1px solid var(--border)", borderBottom: "none" }}>
            <div style={{ flex: 1 }} />
            {props.footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

