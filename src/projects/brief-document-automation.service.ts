import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { BriefDocument } from './entities/brief-document.entity';
import { BriefDocumentJobsService } from './brief-document-jobs.service';

@Injectable()
export class BriefDocumentAutomationService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(BriefDocumentAutomationService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(BriefDocument)
    private readonly documents: Repository<BriefDocument>,
    private readonly jobs: BriefDocumentJobsService,
  ) {}

  onModuleInit() {
    if (!this.jobs.enabled()) return;
    this.timer = setInterval(() => void this.reconcile(), 5 * 60_000);
    this.timer.unref();
    setTimeout(() => void this.reconcile(), 30_000).unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
      const stale = await this.documents.find({
        where: {
          status: In(['queued', 'processing']),
          updatedAt: LessThan(new Date(Date.now() - 10 * 60_000)),
        },
        order: { createdAt: 'ASC' },
        take: 50,
      });
      for (const document of stale) {
        document.status = 'queued';
        await this.documents.save(document);
        await this.jobs.enqueue(document.id);
      }
    } catch (error) {
      this.logger.error(
        `Requirements document recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
