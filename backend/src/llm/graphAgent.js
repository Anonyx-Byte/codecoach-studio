const { ChatGroq } = require("@langchain/groq");
const { tool } = require("@langchain/core/tools");
const { PromptTemplate } = require("@langchain/core/prompts");
const { AgentExecutor, createReactAgent } = require("langchain/agents");
const { z } = require("zod");
const { runQuery } = require("../graph/tigergraphClient");
const { callModel } = require("../../callModel");

const getSkillGapsTool = tool(
  async ({ studentId }) => {
    const result = await runQuery("skillIntelligence", { s: studentId });
    const data = result?.results?.[0];
    if (!data) return "No data";

    const weak = (data.WeakConcepts || [])
      .map((concept) => concept?.attributes?.name)
      .filter(Boolean)
      .join(", ");
    const prereqs = (data.Prerequisites || [])
      .map((concept) => concept?.attributes?.name)
      .filter(Boolean)
      .join(", ");
    const root = data.WeakConcepts?.[0]?.attributes?.name || "unknown";

    return `Root cause: ${root}. Weak: ${weak || "none"}. Prerequisites needed: ${prereqs || "none"}`;
  },
  {
    name: "get_skill_gaps",
    description: "Gets student weak concepts and prerequisite gaps from TigerGraph knowledge graph",
    schema: z.object({
      studentId: z.string().describe("student ID")
    })
  }
);

const getPrerequisiteChainTool = tool(
  async ({ studentId }) => {
    const result = await runQuery("skillIntelligence", { s: studentId });
    const data = result?.results?.[0];
    const topics = (data?.RecommendedTopics || [])
      .map((topic) => topic?.attributes?.name)
      .filter(Boolean)
      .join(" -> ");

    return `Study in this order: ${topics || "No recommended path found"}`;
  },
  {
    name: "get_prerequisite_chain",
    description: "Gets ordered learning path showing which concepts to study first",
    schema: z.object({
      studentId: z.string()
    })
  }
);

const findSimilarStudentsTool = tool(
  async ({ studentId }) => {
    const result = await runQuery("arenaMatchmaking", { target_student: studentId });
    const candidates = result?.results?.[0]?.Result || [];
    if (!candidates.length) return "No matches found";

    return candidates
      .slice(0, 3)
      .map((candidate) => candidate?.attributes?.name)
      .filter(Boolean)
      .join(", ");
  },
  {
    name: "find_similar_students",
    description: "Finds students with similar weaknesses for peer learning",
    schema: z.object({
      studentId: z.string()
    })
  }
);

const graphAgentPrompt = new PromptTemplate({
  template: `You are a graph-powered learning mentor.

You must use the available TigerGraph tools before answering.
Use the student's graph data to personalize the answer.

Available tools:
{tools}

Tool names:
{tool_names}

Use this format:
Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [{tool_names}]
Action Input: the JSON input for the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat as needed)
Thought: I now know the final answer
Final Answer: the final answer to the student

Question: {input}
Thought:{agent_scratchpad}`,
  inputVariables: ["input", "tools", "tool_names", "agent_scratchpad"]
});

let graphExecutorPromise = null;

async function getGraphExecutor() {
  if (graphExecutorPromise) return graphExecutorPromise;

  graphExecutorPromise = (async () => {
    const llm = new ChatGroq({
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || "llama-3.1-8b-instant"
    });

    const tools = [
      getSkillGapsTool,
      getPrerequisiteChainTool,
      findSimilarStudentsTool
    ];

    const agent = await createReactAgent({
      llm,
      tools,
      prompt: graphAgentPrompt
    });

    return new AgentExecutor({
      agent,
      tools,
      returnIntermediateSteps: true,
      maxIterations: 4
    });
  })().catch((err) => {
    graphExecutorPromise = null;
    throw err;
  });

  return graphExecutorPromise;
}

function normalizeAnswerContent(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((item) => String(item || "")).join("\n").trim();
  return String(value || "").trim();
}

async function graphAgentAsk(studentId, question) {
  try {
    const executor = await getGraphExecutor();
    const result = await executor.invoke({
      input: `StudentID: ${studentId}
Question: ${question}
Use tools to check their knowledge graph before answering.`
    });

    const toolsUsed = Array.isArray(result?.intermediateSteps)
      ? result.intermediateSteps
        .map((step) => step?.action?.tool)
        .filter(Boolean)
      : [];

    return {
      answer: normalizeAnswerContent(result?.output),
      tools_used: toolsUsed,
      graph_powered: true,
      source: "langchain-graph-agent"
    };
  } catch (err) {
    console.warn("[graphAgentAsk] LangChain agent failed, falling back to callModel:", err?.message || err);
    // Fallback: use callModel directly with TigerGraph context
    try {
      const tgData = await runQuery("skillIntelligence", { s: studentId }).catch(() => null);
      const record = tgData?.results?.[0] || {};
      const weak = (record.WeakConcepts || []).map((c) => c?.attributes?.name).filter(Boolean).join(", ") || "unknown";
      const prereqs = (record.Prerequisites || []).map((c) => c?.attributes?.name).filter(Boolean).join(", ") || "none";
      const root = record.WeakConcepts?.[0]?.attributes?.name || "problem solving";

      const prompt = `You are CodeCoach, an AI tutor powered by TigerGraph knowledge graphs.
Student's graph data: root cause = ${root}, weak concepts = ${weak}, prerequisites needed = ${prereqs}.
Student question: ${question}
Answer helpfully and specifically based on their graph data. Be concise (3-4 sentences).`;

      const answer = await callModel(prompt, { maxTokens: 300, temperature: 0.5, timeoutMs: 15000 });
      return {
        answer: answer || "I could not generate a response right now.",
        tools_used: ["callModel-fallback"],
        graph_powered: Boolean(tgData),
        source: "callmodel-fallback"
      };
    } catch (fallbackErr) {
      console.warn("[graphAgentAsk] Fallback also failed:", fallbackErr?.message || fallbackErr);
      return {
        answer: "The graph agent is temporarily unavailable. Please try again shortly.",
        tools_used: [],
        graph_powered: false,
        source: "error-fallback"
      };
    }
  }
}

module.exports = { graphAgentAsk };
