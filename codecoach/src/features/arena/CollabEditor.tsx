import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { io, type Socket } from "socket.io-client";

type CollabEditorProps = {
  roomId: string;
  initialCode?: string;
  language?: string;
  onCodeChange?: (code: string) => void;
};

function getSocketUrl() {
  const configuredBase = String(import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
  if (!configuredBase) return window.location.origin;
  return configuredBase.endsWith("/api") ? configuredBase.slice(0, -4) : configuredBase;
}

export function CollabEditor({
  roomId,
  initialCode = "// Start collaborating here",
  language = "javascript",
  onCodeChange
}: CollabEditorProps) {
  const [code, setCode] = useState(initialCode);
  const socketRef = useRef<Socket | null>(null);
  const isRemoteUpdateRef = useRef(false);

  useEffect(() => {
    setCode(initialCode);
  }, [initialCode, roomId]);

  useEffect(() => {
    if (!roomId) return undefined;

    const socket = io(getSocketUrl(), {
      transports: ["websocket", "polling"]
    });

    socketRef.current = socket;
    socket.emit("join-room", roomId);
    socket.on("code-update", (nextCode: string) => {
      isRemoteUpdateRef.current = true;
      setCode(String(nextCode || ""));
    });

    return () => {
      socket.off("code-update");
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId]);

  return (
    <div
      style={{
        marginTop: "20px",
        borderRadius: "20px",
        overflow: "hidden",
        border: "1px solid #1e1e2e",
        background: "#111118",
        boxShadow: "0 20px 48px rgba(0, 0, 0, 0.28)"
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          background: "linear-gradient(135deg, rgba(99, 102, 241, 0.16), rgba(17, 17, 24, 0.98))",
          color: "#f8fafc",
          fontWeight: 700,
          borderBottom: "1px solid #1e1e2e"
        }}
      >
        Collaborative Editor: {roomId}
      </div>
      <Editor
        height="420px"
        theme="vs-dark"
        language={language}
        value={code}
        onChange={(value) => {
          const nextCode = value ?? "";
          setCode(nextCode);
          onCodeChange?.(nextCode);

          if (isRemoteUpdateRef.current) {
            isRemoteUpdateRef.current = false;
            return;
          }

          socketRef.current?.emit("code-change", {
            roomId,
            code: nextCode
          });
        }}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily: "JetBrains Mono, Consolas, monospace"
        }}
      />
    </div>
  );
}
