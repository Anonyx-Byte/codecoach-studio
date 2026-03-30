const axios = require("axios");

const TG_API_KEY = process.env.TG_API_KEY;

function isDemoMode() {
  return String(process.env.DEMO_MODE || "").toLowerCase() === "true";
}

async function persistMatch(studentId, opponentId) {
  if (isDemoMode()) return;

  const host = String(process.env.TG_HOST || "").replace(/\/+$/, "");
  const graph = String(process.env.TG_GRAPH || "LearningGraph");
  if (!host || !studentId || !opponentId || !TG_API_KEY) return;

  try {
    await axios.post(
      `${host}/restpp/graph/${graph}/edges`,
      {
        edges: [
          {
            from_type: "Student",
            from_id: String(studentId),
            to_type: "Student",
            to_id: String(opponentId),
            e_type: "matched_with"
          }
        ]
      },
      {
        timeout: 3000,
        headers: {
          Authorization: `Bearer ${TG_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch {}
}

function setupArenaSocket(io) {
  io.on("connection", (socket) => {
    socket.on("join-room", (roomId) => {
      socket.join(String(roomId || ""));
    });

    socket.on("code-change", ({ roomId, code }) => {
      socket.to(String(roomId || "")).emit("code-update", code);
    });

    socket.on("match-end", async ({ roomId, studentId, opponentId }) => {
      socket.to(String(roomId || "")).emit("match-ended", {
        roomId,
        studentId,
        opponentId
      });
      await persistMatch(studentId, opponentId);
    });
  });
}

module.exports = { setupArenaSocket };
