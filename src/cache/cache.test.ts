import { afterEach, describe, expect, it, vi } from "vitest";

import { CacheService } from "./cache.service.ts";

describe("CacheService without REDIS_URL", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("runs the loader every time and never throws", async () => {
    vi.stubEnv("REDIS_URL", "");
    const cache = new CacheService();
    const load = vi.fn(async () => 1);
    expect(await cache.getOrSet("k", 5, load)).toBe(1);
    expect(await cache.getOrSet("k", 5, load)).toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
    await cache.del("k");
  });
});
