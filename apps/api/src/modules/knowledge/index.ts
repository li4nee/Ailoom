// SPDX-License-Identifier: AGPL-3.0-only
export { ChunkEntity } from './entities/chunk.entity';
export { DocumentVersionEntity } from './entities/document-version.entity';
export { DocumentEntity } from './entities/document.entity';
export { KnowledgeSourceEntity } from './entities/knowledge-source.entity';
export { DocumentsRepository } from './documents.repository';
export { KnowledgeModule } from './knowledge.module';
export { SourcesRepository } from './sources.repository';
export { SourcesService } from './sources.service';
export { KnowledgeSuggestionEntity } from './entities/knowledge-suggestion.entity';
export { SuggestionsService } from './suggestions.service';
export {
  SUGGESTION_CREATED,
  SUGGESTION_REVIEWED,
  type SuggestionCreatedEvent,
  type SuggestionReviewedEvent,
} from './suggestions.events';
