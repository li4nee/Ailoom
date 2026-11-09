// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import type { CredentialId, WorkspaceId } from '../../db/ids';
import type { Llm } from '../llm.service';
import type { EmbedResult } from '../types';

/** What a provider's embedding contract run needs, and the vector size it promises. */
export interface EmbeddingContractTarget {
  llm: Llm;
  credentialId: CredentialId;
  workspaceId: WorkspaceId;
  model: string;
  dimensions: number;
}

/** A live provider or a cold local model may take a while on the first call. */
const CASE_TIMEOUT_MS = 60_000;

const INPUTS = ['How do I get a refund?', 'Our office is located in Berlin.', 'hello'];

/**
 * The behavior every embedding provider must have behind `Llm.embed`. It checks counts and
 * sizes, never vector values, so the same suite runs against the mock, the local models and,
 * later, live providers.
 */
export function runEmbeddingContract(name: string, make: () => EmbeddingContractTarget): void {
  const embed = (target: EmbeddingContractTarget, inputs: string[]): Promise<EmbedResult> =>
    target.llm.embed({
      workspaceId: target.workspaceId,
      credentialId: target.credentialId,
      model: target.model,
      inputs,
      signal: new AbortController().signal,
    });

  describe(`${name} embedding contract`, () => {
    it(
      'returns one vector per input',
      async () => {
        const { vectors } = await embed(make(), INPUTS);
        expect(vectors).toHaveLength(INPUTS.length);
        for (const vector of vectors) expect(Array.isArray(vector)).toBe(true);
      },
      CASE_TIMEOUT_MS,
    );

    it(
      'vectors have the declared dimensions',
      async () => {
        const target = make();
        const { vectors } = await embed(target, INPUTS);
        for (const vector of vectors) {
          expect(vector).toHaveLength(target.dimensions);
          for (const value of vector) expect(Number.isFinite(value)).toBe(true);
        }
      },
      CASE_TIMEOUT_MS,
    );

    it(
      'tokens > 0',
      async () => {
        const { tokens } = await embed(make(), INPUTS);
        expect(tokens).toBeGreaterThan(0);
      },
      CASE_TIMEOUT_MS,
    );

    it(
      'empty input list returns []',
      async () => {
        const { vectors } = await embed(make(), []);
        expect(vectors).toEqual([]);
      },
      CASE_TIMEOUT_MS,
    );
  });
}
