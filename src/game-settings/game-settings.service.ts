import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  GAME_KEYS,
  GAME_LABELS,
  type GameKey,
} from "./game-settings.constants.ts";
import { GameSettingsRepository } from "./game-settings.repository.ts";

const CACHE_MS = 5_000;

export type GameSetting = { game: GameKey; label: string; enabled: boolean };

/**
 * Admin on/off switch per game. A game with no stored row is enabled.
 * Reads are cached for a few seconds (every join / bet checks this).
 * If the table cannot be read (e.g. migrations/manual/20261117_game_settings.sql has not been applied yet)
 * games stay enabled and a warning is logged, so a missing table never takes
 * the casino down.
 */
@Injectable()
export class GameSettingsService {
  private readonly logger = new Logger(GameSettingsService.name);
  private cache: { at: number; map: Map<string, boolean> } | null = null;
  private warned = false;

  constructor(
    @Inject(GameSettingsRepository)
    private readonly repo: GameSettingsRepository,
  ) {}

  private async load(): Promise<Map<string, boolean>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.map;
    }
    const map = new Map<string, boolean>();
    try {
      for (const row of await this.repo.list()) map.set(row.game, row.enabled);
      this.warned = false;
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          `GameSetting table unreadable, all games treated as enabled (${String(err)}). Apply migrations/manual/20261117_game_settings.sql.`,
        );
      }
    }
    this.cache = { at: Date.now(), map };
    return map;
  }

  async isEnabled(game: GameKey): Promise<boolean> {
    return (await this.load()).get(game) ?? true;
  }

  async list(): Promise<GameSetting[]> {
    const map = await this.load();
    return GAME_KEYS.map((game) => ({
      game,
      label: GAME_LABELS[game],
      enabled: map.get(game) ?? true,
    }));
  }

  /** Enabled flags keyed by game, for the lobby payload. */
  async enabledMap(): Promise<Record<GameKey, boolean>> {
    const map = await this.load();
    return Object.fromEntries(
      GAME_KEYS.map((g) => [g, map.get(g) ?? true]),
    ) as Record<GameKey, boolean>;
  }

  async setEnabled(game: GameKey, enabled: boolean): Promise<GameSetting> {
    await this.repo.setEnabled(game, enabled);
    this.cache = null;
    return { game, label: GAME_LABELS[game], enabled };
  }
}
