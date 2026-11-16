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

import type { TeenPattiActionType } from "./teen-patti.engine.ts";
import type { TpRoomEvent } from "./teen-patti.service.ts";
import { TeenPattiService } from "./teen-patti.service.ts";

interface AuthedSocket extends Socket {
  data: {
    user?: { id: number; email: string; roles: string[] };
  };
}

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: "/teen-patti",
})
export class TeenPattiGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TeenPattiGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(TeenPattiService) private readonly tp: TeenPattiService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  afterInit(): void {
    this.tp.on("room", (event: TpRoomEvent) => {
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

  private async handleRoomEvent(event: TpRoomEvent): Promise<void> {
    const room = this.room(event.tableId);
    if (event.type === "table_state") {
      const sockets = await this.server.in(room).fetchSockets();
      for (const s of sockets) {
        const userId = (s.data as AuthedSocket["data"]).user?.id ?? null;
        try {
          const state = await this.tp.buildTableState(event.tableId, userId);
          s.emit("table_state", state);
        } catch (err) {
          this.logger.warn(`table_state emit failed: ${String(err)}`);
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
    const tableId = Number(body?.tableId);
    if (!tableId) return { ok: false, error: "tableId required" };

    await client.join(this.room(tableId));
    const state = await this.tp.buildTableState(tableId, user.id);
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
      action: TeenPattiActionType;
    },
  ) {
    const user = client.data.user;
    if (!user) {
      client.emit("error", { message: "Unauthorized" });
      return { ok: false };
    }
    try {
      await this.tp.applyPlayerAction(Number(body.tableId), user.id, body.action);
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
    const state = await this.tp.buildTableState(Number(body.tableId), user.id);
    client.emit("table_state", state);
    return { ok: true };
  }
}
