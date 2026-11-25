// SPDX-License-Identifier: AGPL-3.0-only
import type { ProviderKind } from '@app/shared';
import { evalJudgeOutputSchema } from '@app/shared';

import { parseModelJson } from '../../common/model-json';
import type { CredentialId, WorkspaceId } from '../../db/ids';
import { type Llm, type ModelMessage } from '../../providers';
import { buildJudgeMessages, type JudgePromptInput } from './judge-prompt';

export interface JudgeConfig {
  workspaceId: WorkspaceId;
  credentialId: CredentialId;
  provider: ProviderKind;
  model: string;
}

export type JudgeResult =
  | {
      verdict: 'correct' | 'partially_correct' | 'incorrect';
      score: number;
      rationale: string;
      unsupportedClaims: string[];
      inputTokens: number;
      outputTokens: number;
    }
  | { error: 'judge_error'; inputTokens: number; outputTokens: number };

export async function judgeAnswer(
  llm: Llm,
  config: JudgeConfig,
  input: JudgePromptInput,
  signal: AbortSignal,
): Promise<JudgeResult> {
  const messages: ModelMessage[] = buildJudgeMessages(input);
  let inputTokens = 0;
  let outputTokens = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = llm.streamChat({
        workspaceId: config.workspaceId,
        credentialId: config.credentialId,
        model: config.model,
        messages,
        maxOutputTokens: 300,
        temperature: 0,
        signal,
      });
      let raw = '';
      for await (const delta of result.textStream) raw += delta;
      const usage = await result.final;
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
      return {
        ...evalJudgeOutputSchema.parse(parseModelJson(raw)),
        inputTokens,
        outputTokens,
      };
    } catch {
      if (attempt === 1) return { error: 'judge_error', inputTokens, outputTokens };
    }
  }
  return { error: 'judge_error', inputTokens, outputTokens };
}
