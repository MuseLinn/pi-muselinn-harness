// ============================================================
// Tool Policy — Types
// ============================================================

/** Tool activation policy from a single layer (profile or config). */
export interface ToolActivationPolicy {
  /** Allow-list: undefined = all allowed, empty = none allowed. */
  tools?: string[];
  /** Deny-list: applied after allow-list. */
  disallowedTools?: string[];
}

/** All layers combined for evaluation. */
export interface ToolPolicyLayers {
  profile: ToolActivationPolicy;
  sessionDisabled?: string[];
}
