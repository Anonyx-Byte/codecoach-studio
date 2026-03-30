// backend/src/llm/adaptiveHint.js
const { getStudentProfile, buildAdaptivePromptPrefix } = require("../graph/studentProfile");

async function buildAdaptivePrompt(studentId, userPrompt) {
  const profile = await getStudentProfile(studentId);
  const prefix = buildAdaptivePromptPrefix(profile);
  
  return {
    fullPrompt: `${prefix}\n\nStudent's question: ${userPrompt}`,
    hint_style: profile.hint_style,
    weak_concepts: profile.weak_concepts,
    source: profile.source
  };
}

module.exports = { buildAdaptivePrompt };