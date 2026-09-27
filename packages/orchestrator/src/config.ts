/** A positive integer setting from the environment; undefined when unset or blank. Anything else is a startup error. */
export function positiveIntegerFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return Number(raw);
}
