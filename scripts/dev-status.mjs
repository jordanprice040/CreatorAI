/** Reports configuration, never claims a provider call or guarantees fixture-only operation. */
export function inferenceNotice(inference) {
  return `Inference: ${inference.api_model ? `API adapter ${inference.api_model} configured (unverified)` : 'no live API adapter configured at startup (a workspace owner can save an OpenAI key in Models and connections)'}; ${inference.plan_connections ? 'plan connections available when configured in Models' : 'plan connections unavailable without saved records'}. Fixture workspaces use synthetic responses. Real calls require the matching connection settings, grants and resource limits.`;
}
