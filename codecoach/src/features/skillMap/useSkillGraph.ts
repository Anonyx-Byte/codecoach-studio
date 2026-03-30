import { useCallback, useEffect, useState } from "react";

export type SkillGraphNode = {
  id: string;
  label: string;
  color: string;
  size: number;
};

export type SkillGraphEdge = {
  from: string;
  to: string;
  label: string;
  arrows: string;
};

type SkillGraphResponse = {
  nodes?: SkillGraphNode[];
  edges?: SkillGraphEdge[];
  source?: string;
};

const BASE = import.meta.env.VITE_API_BASE_URL || "";

export function useSkillGraph(studentId: string) {
  const [nodes, setNodes] = useState<SkillGraphNode[]>([]);
  const [edges, setEdges] = useState<SkillGraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [source, setSource] = useState("demo-mode");

  const fetchGraph = useCallback(async () => {
    if (!studentId) {
      setNodes([]);
      setEdges([]);
      setLoading(false);
      setError("Missing student ID");
      setSource("demo-mode");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${BASE}/api/graph/skill-map/${studentId}`);
      if (!response.ok) {
        throw new Error(`Failed to load graph (${response.status})`);
      }

      const data = (await response.json()) as SkillGraphResponse;
      setNodes(Array.isArray(data.nodes) ? data.nodes : []);
      setEdges(Array.isArray(data.edges) ? data.edges : []);
      setSource(String(data.source || "demo-mode"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph");
      setNodes([]);
      setEdges([]);
      setSource("demo-mode");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  return {
    nodes,
    edges,
    loading,
    error,
    refetch: fetchGraph,
    source
  };
}
