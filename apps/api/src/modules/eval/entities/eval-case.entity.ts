// SPDX-License-Identifier: AGPL-3.0-only
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { EvalCaseOrigin } from '@app/shared';

import type { WorkspaceId } from '../../../db/ids';
import { TenantEntity } from '../../../db/tenant-entity';
import { WorkspaceEntity } from '../../workspaces';
import { EvalDatasetEntity } from './eval-dataset.entity';

@Entity({ name: 'eval_cases' })
@Check('eval_cases_question_check', 'char_length("question") BETWEEN 1 AND 2000')
@Check(
  'eval_cases_expected_answer_check',
  '"expected_answer" IS NULL OR char_length("expected_answer") <= 4000',
)
@Check(
  'eval_cases_expectation_check',
  '"needs_expectation" OR "expected_answer" IS NOT NULL OR cardinality("expected_document_ids") > 0 OR cardinality("must_include") > 0 OR cardinality("must_not_include") > 0 OR "expect_handoff" IS NOT NULL',
)
@Index('eval_cases_workspace_dataset_created', ['workspaceId', 'datasetId', 'createdAt'])
export class EvalCaseEntity extends TenantEntity {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  override id!: string;

  @Column({ type: 'uuid' })
  override workspaceId!: WorkspaceId;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id', foreignKeyConstraintName: 'eval_cases_workspace_fkey' })
  workspace!: WorkspaceEntity;

  @Column({ type: 'uuid' })
  datasetId!: string;

  @ManyToOne(() => EvalDatasetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dataset_id', foreignKeyConstraintName: 'eval_cases_dataset_fkey' })
  dataset!: EvalDatasetEntity;

  @Column({ type: 'varchar', length: 2_000 })
  question!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  history!: { role: 'visitor' | 'ai'; content: string }[];

  @Column({ type: 'varchar', length: 4_000, nullable: true })
  expectedAnswer!: string | null;

  @Column({ type: 'uuid', array: true, default: () => "'{}'" })
  expectedDocumentIds!: string[];

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  mustInclude!: string[];

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  mustNotInclude!: string[];

  @Column({ type: 'boolean', nullable: true })
  expectHandoff!: boolean | null;

  @Column({ type: 'boolean', default: false })
  needsExpectation!: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  toolFixtures!: unknown[];

  @Column({
    type: 'enum',
    enum: ['manual', 'correction', 'feedback', 'import'],
    enumName: 'eval_case_origin',
    default: 'manual',
  })
  origin!: EvalCaseOrigin;

  @Column({ type: 'uuid', nullable: true })
  originRef!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
