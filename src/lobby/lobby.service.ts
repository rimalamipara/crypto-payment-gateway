import { Inject, Injectable } from "@nestjs/common";

import { ColorGameService } from "../color-game/color-game.service.ts";
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
  ) {}

  async overview(userId: number) {
    const [pokerTables, tpTables, rummyTables, color, pokerStats] =
      await Promise.all([
        this.poker.listTablesForUser(),
        this.teenPatti.listTablesForUser(),
        this.rummy.listTablesForUser(),
        this.colorGame.getCurrent(),
        this.poker.myStats(userId),
      ]);

    return {
      games: {
        poker: {
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
        teenPatti: summarizeTables(tpTables),
        rummy: summarizeTables(rummyTables),
        color: {
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
