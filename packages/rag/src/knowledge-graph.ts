import { DEFAULT_ANCHOR_SIMILARITY_THRESHOLD } from "@pims/types/constants.ts";
import { ModelUnavailableError, RagIndexError } from "@pims/types/errors.ts";
import type { ModelProvider } from "@pims/types/models.ts";
import type {
  CorpusChunk,
  KGEdgeRelation,
  KnowledgeGraphData,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
} from "@pims/types/rag.ts";
import Graph from "graphology";

export class NormativeKnowledgeGraph {
  private readonly graph: Graph;
  private readonly nodeToChunkIds: Map<string, string[]> = new Map();
  private readonly nodeEmbeddings: Map<string, number[]> = new Map();

  constructor(initialData?: KnowledgeGraphData) {
    this.graph = new Graph({ multi: false, type: "undirected" });
    this.initDefaultGraph();
    if (initialData) {
      for (const node of initialData.nodes) {
        this.addNode(node);
      }
      for (const edge of initialData.edges) {
        this.addEdge(edge);
      }
    }
  }

  addNode(node: KnowledgeGraphNode): void {
    if (!this.graph.hasNode(node.id)) {
      this.graph.addNode(node.id, {
        kind: node.kind,
        label: node.label,
        description: node.description,
      });
    }
  }

  addEdge(edge: KnowledgeGraphEdge): void {
    if (!this.graph.hasNode(edge.source) || !this.graph.hasNode(edge.target)) {
      return;
    }
    if (!this.graph.hasEdge(edge.source, edge.target)) {
      this.graph.addEdge(edge.source, edge.target, {
        relation: edge.relation,
        weight: edge.weight,
      });
    }
  }

  mapNodeToChunk(nodeId: string, chunkId: string): void {
    const list = this.nodeToChunkIds.get(nodeId) ?? [];
    if (!list.includes(chunkId)) {
      list.push(chunkId);
    }
    this.nodeToChunkIds.set(nodeId, list);
  }

  getNodeIds(): string[] {
    return this.graph.nodes();
  }

  getNode(nodeId: string): KnowledgeGraphNode | undefined {
    if (!this.graph.hasNode(nodeId)) {
      return undefined;
    }
    const attrs = this.graph.getNodeAttributes(nodeId) as {
      kind: KnowledgeGraphNode["kind"];
      label: string;
      description?: string;
    };
    return {
      id: nodeId,
      kind: attrs.kind,
      label: attrs.label,
      description: attrs.description,
    };
  }

  private cosine(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      dot += x * y;
      normA += x * x;
      normB += y * y;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  private initDefaultGraph(): void {
    const defaultNodes: KnowledgeGraphNode[] = [
      {
        id: "gdpr:art33.1",
        kind: "article",
        label: "GDPR Art 33(1) 72h notification to supervisory authority",
      },
      {
        id: "gdpr:art33.2",
        kind: "article",
        label: "GDPR Art 33(2) processor notification without undue delay",
      },
      {
        id: "gdpr:art33.3",
        kind: "article",
        label: "GDPR Art 33(3) notification content elements (a)-(d)",
      },
      {
        id: "gdpr:art33.4",
        kind: "article",
        label: "GDPR Art 33(4) phased notification provision",
      },
      {
        id: "gdpr:art33.5",
        kind: "article",
        label: "GDPR Art 33(5) breach documentation obligation",
      },
      {
        id: "gdpr:art34.1",
        kind: "article",
        label: "GDPR Art 34(1) high-risk subject communication",
      },
      {
        id: "gdpr:art34.2",
        kind: "article",
        label: "GDPR Art 34(2) plain language content points (b), (c), (d)",
      },
      {
        id: "gdpr:art34.3a",
        kind: "article",
        label: "GDPR Art 34(3)(a) encryption and unintelligibility exemption",
      },
      {
        id: "gdpr:art34.3b",
        kind: "article",
        label: "GDPR Art 34(3)(b) subsequent measures preventing high-risk",
      },
      {
        id: "gdpr:art34.3c",
        kind: "article",
        label: "GDPR Art 34(3)(c) disproportionate effort public notice",
      },
      {
        id: "gdpr:art34.4",
        kind: "article",
        label: "GDPR Art 34(4) supervisory authority override",
      },
      {
        id: "iso:b.3.11",
        kind: "clause",
        label: "ISO 27701 B.3.11 PII breach management planning & procedures",
      },
      {
        id: "iso:b.3.12",
        kind: "clause",
        label:
          "ISO 27701 B.3.12 response to incidents, notifications & breach records",
      },
      {
        id: "iso:a.3.11",
        kind: "control",
        label:
          "ISO 27701 A.3.11 processor incident intake & event decision (crosswalk 6.13.1.4)",
      },
      {
        id: "iso:a.3.12",
        kind: "control",
        label:
          "ISO 27701 A.3.12 processor response execution (crosswalk 6.13.1.5)",
      },
      {
        id: "iso:6.13.1.1",
        kind: "clause",
        label: "ISO 27701 6.13.1.1 incident management planning & preparation",
      },
      {
        id: "iso:6.13.1.4",
        kind: "clause",
        label:
          "ISO 27701 6.13.1.4 assessment and decision on information security events",
      },
      {
        id: "iso:6.13.1.5",
        kind: "clause",
        label: "ISO 27701 6.13.1.5 response to information security incidents",
      },
      {
        id: "iso:6.13.1.7",
        kind: "clause",
        label: "ISO 27701 6.13.1.7 collection of evidence",
      },
      {
        id: "iso:6.1.3",
        kind: "clause",
        label:
          "ISO 27701 6.1.3 PII risk treatment and Statement of Applicability",
      },
      {
        id: "iso:5.3",
        kind: "clause",
        label:
          "ISO 27701 5.3 Organizational roles, responsibilities and authorities",
      },
      {
        id: "iso:6.13",
        kind: "clause",
        label: "ISO 27701 6.13 Information security incident management",
      },
      {
        id: "iso:5.4",
        kind: "clause",
        label: "ISO 27701 5.3/5.4 PIMS information security and roles",
      },
      {
        id: "iso:9.2",
        kind: "clause",
        label: "ISO 27701 9.2 internal audit and corrective findings",
      },
      {
        id: "iso:9.3.2",
        kind: "clause",
        label:
          "ISO 27701 9.3.2 management review inputs and nonconformity trends",
      },
      {
        id: "iso:10.2",
        kind: "clause",
        label: "ISO 27701 10.2 nonconformity and corrective action (steps a-e)",
      },
      { id: "cat:dl", kind: "catalog", label: "DL: Fuga o pérdida de datos" },
      { id: "cat:ua", kind: "catalog", label: "UA: Acceso no autorizado" },
      { id: "cat:action_c", kind: "catalog", label: "C: Contención" },
      { id: "cat:action_a", kind: "catalog", label: "A: Análisis" },
      { id: "cat:action_r", kind: "catalog", label: "R: Resolución" },
    ];

    for (const node of defaultNodes) {
      this.addNode(node);
    }

    const defaultEdges: Array<{
      s: string;
      t: string;
      r: KGEdgeRelation;
      w: number;
    }> = [
      { s: "gdpr:art33.1", t: "gdpr:art33.2", r: "crosswalks_to", w: 0.9 },
      { s: "gdpr:art33.1", t: "gdpr:art33.3", r: "requires", w: 1.0 },
      { s: "gdpr:art33.1", t: "gdpr:art33.4", r: "requires", w: 0.8 },
      { s: "gdpr:art33.1", t: "gdpr:art33.5", r: "requires", w: 0.95 },
      { s: "gdpr:art33.3", t: "gdpr:art34.2", r: "requires", w: 1.0 },
      { s: "gdpr:art34.1", t: "gdpr:art34.2", r: "requires", w: 1.0 },
      { s: "gdpr:art34.1", t: "gdpr:art34.3a", r: "requires", w: 0.9 },
      { s: "gdpr:art34.1", t: "gdpr:art34.3b", r: "requires", w: 0.9 },
      { s: "gdpr:art34.1", t: "gdpr:art34.3c", r: "requires", w: 0.85 },
      { s: "gdpr:art33.1", t: "iso:b.3.12", r: "crosswalks_to", w: 0.9 },
      { s: "gdpr:art33.2", t: "iso:b.3.11", r: "crosswalks_to", w: 0.9 },
      { s: "gdpr:art33.5", t: "iso:b.3.12", r: "crosswalks_to", w: 0.95 },
      { s: "iso:b.3.12", t: "iso:6.13", r: "requires", w: 0.9 },
      { s: "iso:6.13", t: "iso:5.4", r: "requires", w: 0.85 },
      { s: "iso:a.3.11", t: "iso:6.13.1.4", r: "crosswalks_to", w: 1.0 },
      { s: "iso:a.3.12", t: "iso:6.13.1.5", r: "crosswalks_to", w: 1.0 },
      { s: "iso:b.3.11", t: "iso:6.13.1.1", r: "crosswalks_to", w: 1.0 },
      { s: "iso:b.3.12", t: "iso:6.13.1.5", r: "crosswalks_to", w: 0.95 },
      { s: "iso:6.13.1.5", t: "iso:6.13.1.7", r: "requires", w: 0.9 },
      { s: "iso:10.2", t: "iso:9.3.2", r: "requires", w: 0.9 },
      { s: "iso:9.2", t: "iso:9.3.2", r: "requires", w: 0.9 },
      { s: "iso:6.1.3", t: "iso:6.13", r: "requires", w: 0.85 },
      { s: "cat:dl", t: "gdpr:art33.1", r: "requires", w: 0.9 },
      { s: "cat:ua", t: "gdpr:art33.1", r: "requires", w: 0.85 },
    ];

    for (const e of defaultEdges) {
      this.addEdge({
        source: e.s,
        target: e.t,
        relation: e.r,
        weight: e.w,
      });
    }
  }

  async linkChunks(
    chunks: CorpusChunk[],
    modelProvider: ModelProvider,
    options?: { minSimilarity?: number; topK?: number },
  ): Promise<void> {
    this.nodeToChunkIds.clear();
    if (this.nodeEmbeddings.size === 0) {
      throw new RagIndexError(
        "Knowledge graph node embeddings have not been indexed. Call indexNodeEmbeddings() first.",
      );
    }
    const minSimilarity =
      options?.minSimilarity ?? DEFAULT_ANCHOR_SIMILARITY_THRESHOLD;
    const topK = options?.topK ?? 3;
    if (chunks.length === 0) {
      return;
    }
    const nodeIds = this.getNodeIds();
    const batchSize = 25;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const res = await modelProvider.embed({
        texts: batch.map((c) => c.text),
      });
      for (const [j, chunk] of batch.entries()) {
        const chunkVec = res.vectors[j];
        if (chunkVec === undefined) {
          continue;
        }
        const scored: Array<{ id: string; similarity: number }> = [];
        for (const nodeId of nodeIds) {
          const nodeVec = this.nodeEmbeddings.get(nodeId);
          if (nodeVec === undefined) {
            continue;
          }
          const similarity = this.cosine(chunkVec, nodeVec);
          if (similarity >= minSimilarity) {
            scored.push({ id: nodeId, similarity });
          }
        }
        scored.sort((a, b) => b.similarity - a.similarity);
        for (const item of scored.slice(0, topK)) {
          this.mapNodeToChunk(item.id, chunk.chunk_id);
        }
      }
    }
  }

  computePersonalizedPageRank(
    anchorNodeIds: string[],
    alpha = 0.85,
    maxIter = 25,
  ): Map<string, number> {
    const nodes = this.graph.nodes();
    const n = nodes.length;
    if (n === 0) return new Map();

    const validAnchors = anchorNodeIds.filter((id) => this.graph.hasNode(id));
    const teleport = new Map<string, number>();

    if (validAnchors.length > 0) {
      const p = 1.0 / validAnchors.length;
      for (const id of validAnchors) {
        teleport.set(id, p);
      }
    } else {
      const p = 1.0 / n;
      for (const id of nodes) {
        teleport.set(id, p);
      }
    }

    let currentProb = new Map<string, number>(teleport);

    for (let iter = 0; iter < maxIter; iter++) {
      const nextProb = new Map<string, number>();

      for (const node of nodes) {
        nextProb.set(node, (1 - alpha) * (teleport.get(node) ?? 0));
      }

      for (const u of nodes) {
        const uProb = currentProb.get(u) ?? 0;
        if (uProb <= 0) continue;

        const neighbors = this.graph.neighbors(u);
        if (neighbors.length === 0) continue;

        let totalWeight = 0;
        for (const v of neighbors) {
          const edgeAttrs = this.graph.getEdgeAttributes(u, v) as {
            weight?: number;
          };
          totalWeight += edgeAttrs.weight ?? 1;
        }

        if (totalWeight <= 0) continue;

        for (const v of neighbors) {
          const edgeAttrs = this.graph.getEdgeAttributes(u, v) as {
            weight?: number;
          };
          const w = edgeAttrs.weight ?? 1;
          const transProb = (w / totalWeight) * uProb;
          const curr = nextProb.get(v) ?? 0;
          nextProb.set(v, curr + alpha * transProb);
        }
      }

      currentProb = nextProb;
    }

    return currentProb;
  }

  getChunkScoresFromPPR(pprScores: Map<string, number>): Map<string, number> {
    const chunkScores = new Map<string, number>();
    for (const [nodeId, score] of pprScores.entries()) {
      if (score <= 0) continue;
      const chunks = this.nodeToChunkIds.get(nodeId);
      if (chunks) {
        for (const cid of chunks) {
          const existing = chunkScores.get(cid) ?? 0;
          chunkScores.set(cid, Math.max(existing, score));
        }
      }
    }
    return chunkScores;
  }

  async indexNodeEmbeddings(modelProvider: ModelProvider): Promise<void> {
    const nodeIds = this.getNodeIds();
    const nodes = nodeIds
      .map((id) => this.getNode(id))
      .filter((n): n is KnowledgeGraphNode => Boolean(n));

    if (nodes.length === 0) return;

    const texts = nodes.map((n) =>
      `${n.label}. ${n.description ?? ""} ${n.id}`.trim(),
    );

    const res = await modelProvider.embed({ texts });
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const vec = res.vectors[i];
      if (node && vec) {
        this.nodeEmbeddings.set(node.id, vec);
      }
    }
  }

  findAnchorsByVector(
    queryVector: number[],
    minSimilarity = DEFAULT_ANCHOR_SIMILARITY_THRESHOLD,
    topK = 5,
  ): string[] {
    if (this.nodeEmbeddings.size === 0) {
      throw new RagIndexError(
        "Knowledge graph node embeddings have not been indexed. Call indexNodeEmbeddings() first.",
      );
    }

    const scored: Array<{ id: string; similarity: number }> = [];

    for (const [nodeId, nodeVec] of this.nodeEmbeddings.entries()) {
      const similarity = this.cosine(queryVector, nodeVec);
      if (similarity >= minSimilarity) {
        scored.push({ id: nodeId, similarity });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topK).map((item) => item.id);
  }

  async findAnchorsInQuery(
    query: string,
    modelProvider: ModelProvider,
    options?: {
      minSimilarity?: number;
      topK?: number;
    },
  ): Promise<string[]> {
    if (this.nodeEmbeddings.size === 0) {
      throw new RagIndexError(
        "Knowledge graph node embeddings have not been indexed. Call indexNodeEmbeddings() first.",
      );
    }

    const res = await modelProvider.embed({ texts: [query] });
    const qVec = res.vectors[0];
    if (!qVec) {
      throw new ModelUnavailableError(
        "rag",
        "Failed to compute query vector for anchor resolution",
      );
    }

    return this.findAnchorsByVector(
      qVec,
      options?.minSimilarity,
      options?.topK,
    );
  }
}
