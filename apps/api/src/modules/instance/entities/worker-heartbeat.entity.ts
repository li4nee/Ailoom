// SPDX-License-Identifier: AGPL-3.0-only
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'worker_heartbeats' })
export class WorkerHeartbeatEntity {
  @PrimaryColumn({ type: 'text' })
  workerId!: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastBeatAt!: Date;

  @Column({ type: 'text', nullable: true })
  version!: string | null;
}
