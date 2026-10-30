import type {
  KGEdgeRelation,
  KnowledgeGraphData,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
} from "@pims/types/rag.ts";
import Graph from "graphology";

export class NormativeKnowledgeGraph {
  private readonly graph: Graph;
  private readonly nodeToChunkIds: Map<string, string[]> = new Map();

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

  private initDefaultGraph(): void {
    const defaultNodes: KnowledgeGraphNode[] = [
      // GDPR Articles
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

      // ISO 27701 Clauses and Controls
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

      // Catalogs & Enums
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

    // Default Node to Chunk mappings for core compliance anchors
    this.mapNodeToChunk("gdpr:art33.1", "art33");
    this.mapNodeToChunk("gdpr:art33.2", "art33");
    this.mapNodeToChunk("gdpr:art33.3", "art33");
    this.mapNodeToChunk("gdpr:art33.4", "art33");
    this.mapNodeToChunk("gdpr:art33.5", "art33");
    this.mapNodeToChunk("gdpr:art34.1", "art34");
    this.mapNodeToChunk("gdpr:art34.2", "art34");
    this.mapNodeToChunk("gdpr:art34.3a", "art34");
    this.mapNodeToChunk("gdpr:art34.3b", "art34");
    this.mapNodeToChunk("gdpr:art34.3c", "art34");
    this.mapNodeToChunk("gdpr:art34.4", "art34");
    this.mapNodeToChunk("iso:b.3.11", "b.3.11");
    this.mapNodeToChunk("iso:b.3.11", "b.3.11:part1");
    this.mapNodeToChunk("iso:b.3.11", "b.3.11:part2");
    this.mapNodeToChunk("iso:b.3.12", "b.3.12");
    this.mapNodeToChunk("iso:b.3.12", "b.3.12:part1");
    this.mapNodeToChunk("iso:b.3.12", "b.3.12:part2");
    this.mapNodeToChunk("iso:b.3.12", "b.3.12:part3");
    this.mapNodeToChunk("iso:a.3.11", "a.3.11");
    this.mapNodeToChunk("iso:a.3.11", "6.13.1.4");
    this.mapNodeToChunk("iso:a.3.12", "a.3.12");
    this.mapNodeToChunk("iso:a.3.12", "6.13.1.5");
    this.mapNodeToChunk("iso:6.13.1.1", "6.13.1.1");
    this.mapNodeToChunk("iso:6.13.1.4", "6.13.1.4");
    this.mapNodeToChunk("iso:6.13.1.5", "6.13.1.5");
    this.mapNodeToChunk("iso:6.13.1.7", "6.13.1.7");
    this.mapNodeToChunk("iso:6.13", "6.13");
    this.mapNodeToChunk("iso:6.1.3", "6.1.3");
    this.mapNodeToChunk("iso:5.3", "5.3");
    this.mapNodeToChunk("iso:5.4", "5.3");
    this.mapNodeToChunk("iso:9.2", "9.2");
    this.mapNodeToChunk("iso:9.3.2", "9.3.2");
    this.mapNodeToChunk("iso:10.2", "10.2");
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

  findAnchorsInQuery(query: string): string[] {
    const anchors: string[] = [];
    const lower = query.toLowerCase();

    if (
      lower.includes("33(1)") ||
      lower.includes("72") ||
      lower.includes("authority deadline") ||
      lower.includes("delay")
    ) {
      anchors.push("gdpr:art33.1");
    }
    if (
      lower.includes("33(2)") ||
      lower.includes("processor notification") ||
      lower.includes("undue delay")
    ) {
      anchors.push("gdpr:art33.2");
    }
    if (
      lower.includes("33(3)") ||
      lower.includes("content elements") ||
      lower.includes("nature of the personal data breach")
    ) {
      anchors.push("gdpr:art33.3");
    }
    if (
      lower.includes("33(5)") ||
      lower.includes("breach documentation") ||
      lower.includes("internal register")
    ) {
      anchors.push("gdpr:art33.5");
    }
    if (
      lower.includes("34(1)") ||
      lower.includes("high-risk") ||
      lower.includes("subject communication")
    ) {
      anchors.push("gdpr:art34.1");
    }
    if (
      lower.includes("34(2)") ||
      lower.includes("clear and plain") ||
      lower.includes("subject content")
    ) {
      anchors.push("gdpr:art34.2");
    }
    if (
      lower.includes("34(3)(a)") ||
      lower.includes("encryption") ||
      lower.includes("unintelligible")
    ) {
      anchors.push("gdpr:art34.3a");
    }
    if (lower.includes("34(3)(b)") || lower.includes("subsequent measures")) {
      anchors.push("gdpr:art34.3b");
    }
    if (
      lower.includes("b.3.11") ||
      lower.includes("planning and preparation") ||
      lower.includes("incident management planning")
    ) {
      anchors.push("iso:b.3.11", "iso:6.13.1.1");
    }
    if (
      lower.includes("b.3.12") ||
      lower.includes("breach record") ||
      lower.includes("consequences of the incident") ||
      lower.includes("response to information security incidents")
    ) {
      anchors.push("iso:b.3.12", "iso:6.13.1.5");
    }
    if (
      lower.includes("a.3.11") ||
      lower.includes("6.13.1.4") ||
      lower.includes("assessment and decision on information security events")
    ) {
      anchors.push("iso:a.3.11", "iso:6.13.1.4");
    }
    if (lower.includes("a.3.12") || lower.includes("6.13.1.5")) {
      anchors.push("iso:a.3.12", "iso:6.13.1.5");
    }
    if (
      lower.includes("6.13.1.7") ||
      lower.includes("collection of evidence")
    ) {
      anchors.push("iso:6.13.1.7");
    }
    if (
      lower.includes("6.1.3") ||
      lower.includes("privacy risk treatment") ||
      lower.includes("statement of applicability")
    ) {
      anchors.push("iso:6.1.3");
    }
    if (lower.includes("9.2") || lower.includes("internal audit")) {
      anchors.push("iso:9.2");
    }
    if (lower.includes("9.3") || lower.includes("management review")) {
      anchors.push("iso:9.3.2");
    }
    if (
      lower.includes("10.2") ||
      lower.includes("nonconformity and corrective action") ||
      lower.includes("corrective action")
    ) {
      anchors.push("iso:10.2");
    }
    if (lower.includes("6.13") || lower.includes("incident management")) {
      anchors.push("iso:6.13");
    }
    if (
      lower.includes("5.4") ||
      lower.includes("security event") ||
      lower.includes("event management")
    ) {
      anchors.push("iso:5.4");
    }
    if (
      lower.includes("dl") ||
      lower.includes("ua") ||
      lower.includes("fuga") ||
      lower.includes("acceso no autorizado")
    ) {
      anchors.push("cat:dl", "cat:ua");
    }

    return anchors;
  }
}
