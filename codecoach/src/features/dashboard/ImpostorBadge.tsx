import { useEffect, useState } from "react";
import { getApiBase } from "../../lib/apiBase";

type ImpostorRecord = {
  id: string;
};

type ImpostorResponse = {
  impostors?: ImpostorRecord[];
};

const BASE = getApiBase(import.meta.env.VITE_API_BASE_URL);

export default function ImpostorBadge() {
  const userId = localStorage.getItem("userId") || "";
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadImpostors() {
      if (!userId) return;

      try {
        const response = await fetch(`${BASE}/api/graph/impostors`);
        if (!response.ok) return;

        const data = (await response.json()) as ImpostorResponse;
        const match = Array.isArray(data.impostors) && data.impostors.some((item) => item.id === userId);

        if (active) {
          setVisible(match);
        }
      } catch {}
    }

    loadImpostors();

    return () => {
      active = false;
    };
  }, [userId]);

  if (!visible || dismissed) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
        padding: "12px 16px",
        borderRadius: "14px",
        background: "rgba(245, 158, 11, 0.1)",
        color: "#fcd34d",
        border: "1px solid rgba(245, 158, 11, 0.3)",
        boxShadow: "0 12px 30px rgba(0, 0, 0, 0.18)"
      }}
    >
      <span>Strong scores, shaky foundations detected</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss impostor badge"
        style={{
          border: 0,
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          fontSize: "1rem",
          fontWeight: 700
        }}
      >
        X
      </button>
    </div>
  );
}
