import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { StreamEvent } from '@quell/shared';

@Injectable()
export class EventsService {
  readonly stream = new Subject<StreamEvent>();

  emit(event: StreamEvent): void {
    this.stream.next(event);
  }
}
