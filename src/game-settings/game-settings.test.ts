import "reflect-metadata";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";

import {
  ALLOW_WHEN_DISABLED_KEY,
  GameEnabledGuard,
  REQUIRES_GAME_KEY,
} from "./game-enabled.guard.ts";
import { GameSettingsService } from "./game-settings.service.ts";
import type { GameSettingsRepository } from "./game-settings.repository.ts";

function fakeRepo(rows: { game: string; enabled: boolean }[] = []) {
  const state = [...rows];
  return {
    list: vi.fn(async () => state.map((r) => ({ ...r }))),
    setEnabled: vi.fn(async (game: string, enabled: boolean) => {
      const row = state.find((r) => r.game === game);
      if (row) row.enabled = enabled;
      else state.push({ game, enabled });
    }),
  } as unknown as GameSettingsRepository & {
    list: ReturnType<typeof vi.fn>;
    setEnabled: ReturnType<typeof vi.fn>;
  };
}

describe("GameSettingsService", () => {
  it("treats a game with no row as enabled", async () => {
    const svc = new GameSettingsService(fakeRepo());
    expect(await svc.isEnabled("poker")).toBe(true);
    expect((await svc.list()).every((g) => g.enabled)).toBe(true);
  });

  it("reflects a stored disabled row and leaves other games on", async () => {
    const svc = new GameSettingsService(
      fakeRepo([{ game: "rummy", enabled: false }]),
    );
    expect(await svc.isEnabled("rummy")).toBe(false);
    expect(await svc.isEnabled("poker")).toBe(true);
    expect((await svc.enabledMap())["teen-patti"]).toBe(true);
  });

  it("a write is visible immediately (cache is dropped)", async () => {
    const svc = new GameSettingsService(fakeRepo());
    expect(await svc.isEnabled("color")).toBe(true);
    await svc.setEnabled("color", false);
    expect(await svc.isEnabled("color")).toBe(false);
    await svc.setEnabled("color", true);
    expect(await svc.isEnabled("color")).toBe(true);
  });

  it("caches reads for a few seconds", async () => {
    const repo = fakeRepo();
    const svc = new GameSettingsService(repo);
    await svc.isEnabled("poker");
    await svc.isEnabled("rummy");
    expect(repo.list).toHaveBeenCalledTimes(1);
  });

  it("fails open when the table cannot be read", async () => {
    const repo = fakeRepo();
    repo.list.mockRejectedValue(new Error('relation "GameSetting" does not exist'));
    const svc = new GameSettingsService(repo);
    expect(await svc.isEnabled("poker")).toBe(true);
  });
});

describe("GameEnabledGuard", () => {
  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;

  function guardFor(game: string | undefined, enabled: boolean) {
    const reflector = new Reflector();
    vi.spyOn(reflector, "getAllAndOverride").mockImplementation((key) =>
      key === REQUIRES_GAME_KEY ? game : undefined,
    );
    const settings = { isEnabled: vi.fn(async () => enabled) };
    return new GameEnabledGuard(
      reflector,
      settings as unknown as GameSettingsService,
    );
  }

  it("lets requests through when the game is on", async () => {
    expect(await guardFor("poker", true).canActivate(ctx)).toBe(true);
  });

  it("rejects with 403 and a readable message when the game is off", async () => {
    const guard = guardFor("teen-patti", false);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(/Teen Patti is currently unavailable/);
  });

  it("keeps routes marked AllowWhenDisabled (cash-out) open while the game is off", async () => {
    const handler = () => undefined;
    Reflect.defineMetadata(ALLOW_WHEN_DISABLED_KEY, true, handler);
    const cashOutCtx = {
      getHandler: () => handler,
      getClass: () => class {},
    } as unknown as ExecutionContext;
    const reflector = new Reflector();
    vi.spyOn(reflector, "getAllAndOverride").mockImplementation((key) =>
      key === REQUIRES_GAME_KEY ? "rummy" : undefined,
    );
    const settings = { isEnabled: vi.fn(async () => false) };
    const guard = new GameEnabledGuard(
      reflector,
      settings as unknown as GameSettingsService,
    );
    expect(await guard.canActivate(cashOutCtx)).toBe(true);
    expect(settings.isEnabled).not.toHaveBeenCalled();
    // ...while an ordinary route of the same game is still rejected.
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("ignores routes that do not declare a game", async () => {
    expect(await guardFor(undefined, false).canActivate(ctx)).toBe(true);
  });
});
