const express = require("express");
const { findArenaMatch } = require("../arena/matchmaker");

const router = express.Router();

router.post("/match", async (req, res) => {
  const studentId = String(req.body?.studentId || "s001");
  const embedding = Array.isArray(req.body?.embedding) ? req.body.embedding : [];
  const match = await findArenaMatch(studentId, embedding);
  return res.json(match);
});

module.exports = router;
