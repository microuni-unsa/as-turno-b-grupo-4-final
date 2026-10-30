declare module "graphology-pagerank" {
  import type Graph from "graphology";
  export interface PagerankOptions {
    alpha?: number;
    maxIterations?: number;
    tolerance?: number;
    weighted?: boolean;
    attributes?: {
      pagerank?: string;
      weight?: string;
    };
  }
  export default function pagerank(
    graph: Graph,
    options?: PagerankOptions,
  ): Record<string, number>;
}
