import type {
  KGEdgeRelation,
  KnowledgeGraphData,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
} from "@pims/types/rag.ts";

export class NormativeKnowledgeGraph {
  private readonly nodes: Map<string, KnowledgeGraphNode> = new Map();
  private readonly adjacency: Map<
    string,
    Array<{ target: string; weight: number }>
  > = new Map();
  private readonly nodeToChunkIds: Map<string, string[]> = new Map();

  constructor(initialData?: KnowledgeGraphData) {
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
    this.nodes.set(node.id, node);
    if (!this.adjacency.has(node.id)) {
      this.adjacency.set(node.id, []);
    }
  }

  addEdge(edge: KnowledgeGraphEdge): void {
    if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) {
      return;
    }
    const list = this.adjacency.get(edge.source) ?? [];
    list.push({ target: edge.target, weight: edge.weight });
    this.adjacency.set(edge.source, list);

    // Undirected or symmetric traversal for associative discovery
    const revList = this.adjacency.get(edge.target) ?? [];
    revList.push({ target: edge.source, weight: edge.weight });
    this.adjacency.set(edge.target, revList);
  }

  mapNodeToChunk(nodeId: string, chunkId: string): void {
    const list = this.nodeToChunkIds.get(nodeId) ?? [];
    if (!list.includes(chunkId)) {
      list.push(chunkId);
    }
    this.nodeToChunkIds.set(nodeId, list);
  }

  getNode(nodeId: string): KnowledgeGraphNode | undefined {
    return this.nodes.get(nodeId);
  }

  private initDefaultGraph(): void {
    // 1. Define Core Nodes
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

      // ISO 27701 Clauses
      {
        id: "iso:b.3.11",
        kind: "clause",
        label: "ISO 27701 B.3.11 PII breach management procedures",
      },
      {
        id: "iso:b.3.12",
        kind: "clause",
        label: "ISO 27701 B.3.12 breach records and notifications",
      },
      {
        id: "iso:a.3.11",
        kind: "control",
        label: "ISO 27701 A.3.11 processor incident intake",
      },
      {
        id: "iso:a.3.12",
        kind: "control",
        label: "ISO 27701 A.3.12 processor response",
      },
      {
        id: "iso:6.1.3",
        kind: "clause",
        label:
          "ISO 27701 6.1.3 PII risk treatment and Statement of Applicability",
      },
      {
        id: "iso:9.2",
        kind: "clause",
        label: "ISO 27701 9.2 internal audit and corrective findings",
      },
      {
        id: "iso:10.2",
        kind: "clause",
        label: "ISO 27701 10.2 nonconformity and corrective action",
      },

      // PIMS Columns
      {
        id: "pims:incident_code",
        kind: "field",
        label: "core_incident.incident_code INC-### sequence",
      },
      {
        id: "pims:incident_type",
        kind: "field",
        label: "core_incident.incident_type (DL, UA, MW, etc.)",
      },
      {
        id: "pims:status",
        kind: "field",
        label: "core_incident.status (O, P, C)",
      },
      {
        id: "pims:action_type",
        kind: "field",
        label: "core_incident_action.action_type (C, A, R)",
      },
      {
        id: "pims:involves_personal_data",
        kind: "field",
        label: "core_incident.involves_personal_data boolean gate",
      },
      {
        id: "pims:evidence_refs",
        kind: "field",
        label: "core_incident.evidence_refs append-only citation tokens",
      },
      {
        id: "pims:measure_reported_authorities",
        kind: "field",
        label: "core_incident.measure_reported_authorities flag",
      },

      // Catalogs & Enums
      { id: "cat:dl", kind: "catalog", label: "DL: Fuga o pérdida de datos" },
      { id: "cat:ua", kind: "catalog", label: "UA: Acceso no autorizado" },
      { id: "cat:action_c", kind: "catalog", label: "C: Contención" },
      { id: "cat:action_a", kind: "catalog", label: "A: Análisis" },
      { id: "cat:action_r", kind: "catalog", label: "R: Resolución" },

      // Spec Normative Rules
      {
        id: "spec:car_sequence",
        kind: "spec",
        label: "C*->A+->R sequencing rule with >=1 A before R",
      },
      {
        id: "spec:reopen_guard",
        kind: "spec",
        label: "C->P transition guard with REOPENED:<evidence_id>",
      },
      {
        id: "spec:peru_48h",
        kind: "spec",
        label: "Peru 48h advisory unverified status",
      },
      {
        id: "spec:notify_remap",
        kind: "spec",
        label: "notify remaps to change_incident permission",
      },
      {
        id: "spec:logical_delete_restore",
        kind: "spec",
        label: "Unique occupied logical delete restore rule",
      },
    ];

    for (const node of defaultNodes) {
      this.addNode(node);
    }

    // 2. Define Core Relationships
    const defaultEdges: Array<{
      s: string;
      t: string;
      r: KGEdgeRelation;
      w: number;
    }> = [
      // ISO crosswalks to GDPR
      { s: "iso:b.3.11", t: "gdpr:art33.1", r: "crosswalks_to", w: 1.0 },
      { s: "iso:b.3.12", t: "gdpr:art33.5", r: "crosswalks_to", w: 1.0 },
      { s: "iso:b.3.12", t: "gdpr:art33.3", r: "crosswalks_to", w: 0.9 },
      { s: "iso:b.3.12", t: "pims:evidence_refs", r: "maps_to_field", w: 0.8 },
      { s: "iso:10.2", t: "pims:action_type", r: "maps_to_field", w: 0.9 },

      // GDPR to PIMS
      {
        s: "gdpr:art33.1",
        t: "pims:measure_reported_authorities",
        r: "maps_to_field",
        w: 0.9,
      },
      {
        s: "gdpr:art33.1",
        t: "pims:involves_personal_data",
        r: "requires",
        w: 1.0,
      },
      { s: "gdpr:art34.1", t: "gdpr:art34.2", r: "requires", w: 1.0 },
      { s: "gdpr:art34.2", t: "gdpr:art33.3", r: "requires", w: 1.0 },
      { s: "gdpr:art34.3a", t: "gdpr:art34.1", r: "mitigates", w: 1.0 },

      // Catalogs to fields
      { s: "cat:dl", t: "pims:incident_type", r: "maps_to_field", w: 1.0 },
      { s: "cat:ua", t: "pims:incident_type", r: "maps_to_field", w: 1.0 },
      { s: "cat:action_c", t: "pims:action_type", r: "maps_to_field", w: 1.0 },
      { s: "cat:action_a", t: "pims:action_type", r: "maps_to_field", w: 1.0 },
      { s: "cat:action_r", t: "pims:action_type", r: "maps_to_field", w: 1.0 },

      // Spec rules to fields and actions
      { s: "spec:car_sequence", t: "pims:action_type", r: "requires", w: 1.0 },
      { s: "spec:car_sequence", t: "cat:action_r", r: "requires", w: 1.0 },
      { s: "spec:reopen_guard", t: "pims:status", r: "requires", w: 1.0 },
      {
        s: "spec:logical_delete_restore",
        t: "pims:incident_code",
        r: "requires",
        w: 1.0,
      },
      {
        s: "spec:notify_remap",
        t: "pims:measure_reported_authorities",
        r: "maps_to_field",
        w: 0.8,
      },
      { s: "spec:peru_48h", t: "gdpr:art33.1", r: "crosswalks_to", w: 0.7 },
    ];

    for (const edge of defaultEdges) {
      this.addEdge({
        source: edge.s,
        target: edge.t,
        relation: edge.r,
        weight: edge.w,
      });
    }

    // 3. Map default nodes to normative chunk IDs
    this.mapNodeToChunk("gdpr:art33.1", "art33");
    this.mapNodeToChunk("gdpr:art33.1", "art33:part1");
    this.mapNodeToChunk("gdpr:art34.2", "art34");
    this.mapNodeToChunk("gdpr:art34.2", "art34:part1");
    this.mapNodeToChunk("gdpr:art34.3a", "art34");
    this.mapNodeToChunk("gdpr:art34.3a", "art34:part1");
    this.mapNodeToChunk("iso:b.3.12", "b.3.12");
    this.mapNodeToChunk("cat:dl", "anexo-02-chunk-29:part1");
    this.mapNodeToChunk("cat:ua", "anexo-02-chunk-29:part1");
    this.mapNodeToChunk("spec:car_sequence", "spec:sec_6.2");
    this.mapNodeToChunk("spec:reopen_guard", "spec:sec_6.2");
    this.mapNodeToChunk("spec:peru_48h", "spec:sec_2.6");
    this.mapNodeToChunk("spec:notify_remap", "anexo-05-chunk-7");
    this.mapNodeToChunk("spec:logical_delete_restore", "spec:sec_3.2:part1");
  }

  computePersonalizedPageRank(
    seedNodeIds: string[],
    alpha = 0.85,
    iterations = 20,
  ): Map<string, number> {
    const allNodeIds = Array.from(this.nodes.keys());
    const n = allNodeIds.length;
    if (n === 0) return new Map();

    const validSeeds = seedNodeIds.filter((id) => this.nodes.has(id));
    const effectiveSeeds = validSeeds.length > 0 ? validSeeds : allNodeIds;

    // Seed personalization vector
    const s = new Map<string, number>();
    const seedWeight = 1.0 / effectiveSeeds.length;
    for (const seed of effectiveSeeds) {
      s.set(seed, seedWeight);
    }

    // Initialize probability distribution
    let p = new Map<string, number>();
    for (const node of allNodeIds) {
      p.set(node, s.get(node) ?? 0);
    }

    // Power iteration
    for (let it = 0; it < iterations; it++) {
      const nextP = new Map<string, number>();
      for (const node of allNodeIds) {
        nextP.set(node, (1 - alpha) * (s.get(node) ?? 0));
      }

      for (const [u, edges] of this.adjacency.entries()) {
        const uProb = p.get(u) ?? 0;
        if (uProb <= 0 || edges.length === 0) continue;

        const totalWeight = edges.reduce((sum, e) => sum + e.weight, 0);
        if (totalWeight <= 0) continue;

        for (const edge of edges) {
          const transProb = (edge.weight / totalWeight) * uProb;
          const curr = nextP.get(edge.target) ?? 0;
          nextP.set(edge.target, curr + alpha * transProb);
        }
      }

      p = nextP;
    }

    return p;
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
    if (
      lower.includes("b.3.12") ||
      lower.includes("breach record") ||
      lower.includes("consequences")
    ) {
      anchors.push("iso:b.3.12");
    }
    if (
      lower.includes("dl") ||
      lower.includes("ua") ||
      lower.includes("fuga") ||
      lower.includes("acceso no autorizado")
    ) {
      anchors.push("cat:dl", "cat:ua");
    }
    if (
      lower.includes("c/a/r") ||
      lower.includes("sequencing") ||
      lower.includes("approval_id")
    ) {
      anchors.push("spec:car_sequence");
    }
    if (lower.includes("reopen") || lower.includes("reopened")) {
      anchors.push("spec:reopen_guard");
    }
    if (
      lower.includes("peru") ||
      lower.includes("48h") ||
      lower.includes("anpd")
    ) {
      anchors.push("spec:peru_48h");
    }
    if (
      lower.includes("notify") ||
      lower.includes("change_incident") ||
      lower.includes("remap")
    ) {
      anchors.push("spec:notify_remap");
    }
    if (
      lower.includes("logical-delete") ||
      lower.includes("restore") ||
      lower.includes("re-insert")
    ) {
      anchors.push("spec:logical_delete_restore");
    }

    return anchors;
  }
}
