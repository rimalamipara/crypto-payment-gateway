import { Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

import type { RummyRoomEvent } from "./rummy.service.ts";
import { RummyService } from "./rummy.service.ts";
import { GameSettingsService } from "../game-settings/game-settings.service.ts";

interface AuthedSocket extends Socket {
  data: {
    user?: { id: number; email: string; roles: string[] };
  };
}

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: "/rummy",
})
export class RummyGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RummyGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(RummyService) private readonly rummy: RummyService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(GameSettingsService) private readonly gameSettings: GameSettingsService,
  ) {}

  /** Players cannot join or read a table of a game an admin switched off. */
  private async unavailable(): Promise<{ ok: false; error: string } | null> {
    if (await this.gameSettings.isEnabled("rummy")) return null;
    return {
      ok: false,
      error: "Rummy is currently unavailable. Please try again later.",
    };
  }

  afterInit(): void {
    this.rummy.on("room", (event: RummyRoomEvent) => {
      void this.handleRoomEvent(event);
    });
  }

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) {
        client.emit("error", { message: "Unauthorized" });
        client.disconnect(true);
        return;
      }
      const secret = this.config.getOrThrow<string>("jwt.secret");
      const payload = await this.jwt.verifyAsync<{
        sub: number;
        email: string;
        roles: string[];
      }>(token, { secret });
      client.data.user = {
        id: payload.sub,
        email: payload.email,
        roles: payload.roles ?? [],
      };
    } catch {
      client.emit("error", { message: "Unauthorized" });
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: AuthedSocket): void {
    // seats persist until cash-out
  }

  private extractToken(client: AuthedSocket): string | null {
    const auth = client.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token;
    const header = client.handshake.headers.authorization;
    if (header?.startsWith("Bearer ")) return header.slice(7);
    const q = client.handshake.query.token;
    if (typeof q === "string") return q;
    return null;
  }

  private room(tableId: number): string {
    return `table:${tableId}`;
  }

  private async handleRoomEvent(event: RummyRoomEvent): Promise<void> {
    const room = this.room(event.tableId);
    if (event.type === "table_state") {
      const sockets = await this.server.in(room).fetchSockets();
      for (const s of sockets) {
        const userId = (s.data as AuthedSocket["data"]).user?.id ?? null;
        try {
          const state = await this.rummy.buildTableState(event.tableId, userId);
          s.emit("table_state", state);
        } catch (err) {
          this.logger.warn(`rummy table_state emit failed: ${String(err)}`);
        }
      }
      return;
    }
    if (event.type === "error" && event.userId) {
      const sockets = await this.server.in(room).fetchSockets();
      for (const s of sockets) {
        if ((s.data as AuthedSocket["data"]).user?.id === event.userId) {
          s.emit("error", event.payload);
        }
      }
      return;
    }
    this.server.to(room).emit(event.type, event.payload);
  }

  @SubscribeMessage("join_table")
  async joinTable(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { tableId: number },
  ) {
    const user = client.data.user;
    if (!user) return { ok: false, error: "Unauthorized" };
    const off = await this.unavailable();
    if (off) {
      client.emit("error", { message: off.error });
      return off;
    }
    const tableId = Number(body?.tableId);
    if (!tableId) return { ok: false, error: "tableId required" };
    await client.join(this.room(tableId));
    const state = await this.rummy.buildTableState(tableId, user.id);
    client.emit("table_state", state);
    return { ok: true };
  }

  @SubscribeMessage("leave_table")
  async leaveTable(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { tableId: number },
  ) {
    const tableId = Number(body?.tableId);
    if (tableId) await client.leave(this.room(tableId));
    return { ok: true };
  }

  @SubscribeMessage("action")
  async onAction(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody()
    body: {
      tableId: number;
      type: string;
      card?: string;
      melds?: string[][];
    },
  ) {
    const user = client.data.user;
    if (!user) {
      client.emit("error", { message: "Unauthorized" });
      return { ok: false };
    }
    try {
      await this.rummy.applyPlayerAction(Number(body.tableId), user.id, {
        type: body.type as "draw_closed" | "draw_open" | "discard" | "declare" | "drop",
        card: body.card,
        melds: body.melds,
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed";
      client.emit("error", { message });
      return { ok: false, error: message };
    }
  }

  @SubscribeMessage("request_state")
  async requestState(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { tableId: number },
  ) {
    const user = client.data.user;
    if (!user) return { ok: false };
    const off = await this.unavailable();
    if (off) {
      client.emit("error", { message: off.error });
      return off;
    }
    const state = await this.rummy.buildTableState(Number(body.tableId), user.id);
    client.emit("table_state", state);
    return { ok: true };
  }
}
