import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { EventsService } from './core/events.service';
import { MubitService } from './core/mubit.service';
import { StoreService } from './core/store.service';
import { CorrectionsService } from './moderation/corrections.service';
import { MetricsService } from './moderation/metrics.service';
import { ModerationService } from './moderation/moderation.service';
import { SwarmService } from './swarm/swarm.service';

@Module({
  controllers: [ApiController],
  providers: [
    EventsService,
    MubitService,
    StoreService,
    ModerationService,
    CorrectionsService,
    MetricsService,
    SwarmService,
  ],
})
export class AppModule {}
