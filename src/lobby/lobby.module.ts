import { Module } from "@nestjs/common";

import { ColorGameModule } from "../color-game/color-game.module.ts";
import { PokerModule } from "../poker/poker.module.ts";
import { RummyModule } from "../rummy/rummy.module.ts";
import { TeenPattiModule } from "../teen-patti/teen-patti.module.ts";
import { LobbyController } from "./lobby.controller.ts";
import { LobbyService } from "./lobby.service.ts";

@Module({
  imports: [PokerModule, TeenPattiModule, RummyModule, ColorGameModule],
  controllers: [LobbyController],
  providers: [LobbyService],
})
export class LobbyModule {}
