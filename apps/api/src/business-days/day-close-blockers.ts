import { Injectable } from '@nestjs/common';

/** One thing standing between today and a closed day. */
export interface DayCloseBlocker {
  /** What kind of unfinished work this is, e.g. TRANSFER_IN_FLIGHT. */
  kind: string;
  document_id: string;
  doc_number: string;
  detail: string;
}

/**
 * Something that can stop a day being closed.
 *
 * Day Close itself is Priority 2 (§41), but its pre-check has to see work
 * that is genuinely unfinished, and each module knows its own: goods sent
 * between warehouses and not yet received are the first such case (§12-А.4).
 * Modules register here rather than Day Close importing each of them, which
 * would make the dependency run the wrong way.
 */
export interface DayCloseBlockerSource {
  readonly blockerKind: string;
  /** Unfinished work as of the given business date. */
  blockers(businessDate: Date): Promise<DayCloseBlocker[]>;
}

@Injectable()
export class DayCloseBlockerRegistry {
  private readonly sources = new Map<string, DayCloseBlockerSource>();

  register(source: DayCloseBlockerSource): void {
    const existing = this.sources.get(source.blockerKind);
    if (existing && existing !== source) {
      throw new Error(
        `Two blocker sources registered for ${source.blockerKind}`,
      );
    }
    this.sources.set(source.blockerKind, source);
  }

  /** Everything unfinished, from every module that has registered. */
  async collect(businessDate: Date): Promise<DayCloseBlocker[]> {
    const found: DayCloseBlocker[] = [];
    for (const source of this.sources.values()) {
      found.push(...(await source.blockers(businessDate)));
    }
    return found;
  }
}
