// SPDX-License-Identifier: MIT

/** One source an AI answer cites (spec §13.6), as stored on the message. */
export interface Citation {
  n: number;
  chunkId: string;
  documentId: string;
  title: string;
  url: string | null;
}
