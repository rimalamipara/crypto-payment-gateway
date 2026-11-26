import { Inject, Injectable } from "@nestjs/common";

import { CacheService } from "../cache/cache.service.ts";
import { ColorGameService } from "../color-game/color-game.service.ts";
import { GameSettingsService } from "../game-settings/game-settings.service.ts";
import { PokerService } from "../poker/poker.service.ts";
import { RummyService } from "../rummy/rummy.service.ts";
import { TeenPattiService } from "../teen-patti/teen-patti.service.ts";

type TableSummary = {
  status: string;
  seatedCount: number;
  seatsFree: number;
};

function summarizeTables(tables: TableSummary[]) {
  const open = tables.filter((t) => t.status === "open");
  return {
    tables: tables.length,
    openTables: open.length,
    playersSeated: tables.reduce((n, t) => n + t.seatedCount, 0),
    seatsFree: open.reduce((n, t) => n + t.seatsFree, 0),
  };
}

@Injectable()
export class LobbyService {
  constructor(
    @Inject(PokerService) private readonly poker: PokerService,
    @Inject(TeenPattiService) private readonly teenPatti: TeenPattiService,
    @Inject(RummyService) private readonly rummy: RummyService,
    @Inject(ColorGameService) private readonly colorGame: ColorGameService,
    @Inject(GameSettingsService) private readonly gameSettings: GameSettingsService,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  async overview(userId: number) {
    const [pokerTables, tpTables, rummyTables, color, pokerStats, enabled] =
      await Promise.all([
        // Shared (not per-user) table lists; 2s stale seat counts are fine for the lobby.
        this.cache.getOrSet("lobby:poker", 2, () => this.poker.listTablesForUser()),
        this.cache.getOrSet("lobby:tp", 2, () => this.teenPatti.listTablesForUser()),
        this.cache.getOrSet("lobby:rummy", 2, () => this.rummy.listTablesForUser()),
        this.colorGame.getCurrent(),
        this.poker.myStats(userId),
        this.gameSettings.enabledMap(),
      ]);

    return {
      games: {
        poker: {
          enabled: enabled.poker,
          ...summarizeTables(pokerTables),
          featuredTables: pokerTables
            .filter((t) => t.status === "open")
            .slice(0, 6)
            .map((t) => ({
              id: t.id,
              name: t.name,
              smallBlind: t.smallBlind,
              bigBlind: t.bigBlind,
              minBuyIn: t.minBuyIn,
              maxBuyIn: t.maxBuyIn,
              maxSeats: t.maxSeats,
              seatedCount: t.seatedCount,
              seatsFree: t.seatsFree,
              status: t.status,
            })),
        },
        teenPatti: {
          enabled: enabled["teen-patti"],
          ...summarizeTables(tpTables),
        },
        rummy: { enabled: enabled.rummy, ...summarizeTables(rummyTables) },
        color: {
          enabled: enabled.color,
          periodNo: color.periodNo,
          periodName: color.periodName,
          status: color.status,
          msToReveal: color.msToReveal,
          msToClose: color.msToClose,
          resultNumber: color.resultNumber,
          resultColors: color.resultColors,
        },
      },
      player: {
        poker: pokerStats,
      },
      serverNow: new Date().toISOString(),
    };
  }
}
