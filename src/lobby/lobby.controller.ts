import { Controller, Get, Inject } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../common/decorators/current-user.decorator.ts";
import type { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface.ts";
import { LobbyService } from "./lobby.service.ts";

@ApiTags("lobby")
@ApiBearerAuth("access-token")
@Controller("lobby")
export class LobbyController {
  constructor(@Inject(LobbyService) private readonly lobby: LobbyService) {}

  @Get("overview")
  @ApiOperation({
    summary: "Casino floor overview — live counts for all games",
  })
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.lobby.overview(user.id);
  }
}
