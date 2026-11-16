import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { connectDatabase, db } from "./db.ts";

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client = db;

  async onModuleInit(): Promise<void> {
    await connectDatabase();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close?.();
  }
}
