// SPDX-License-Identifier: AGPL-3.0-only
import { DefaultNamingStrategy } from 'typeorm';

/** `workspaceId` -> `workspace_id`, `URLPath` -> `url_path`. */
function snakeCase(name: string): string {
  return name
    .replace(/([A-Z])([A-Z])([a-z])/g, '$1_$2$3') // URLPath -> URL_Path
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2') // workspaceId -> workspace_Id
    .toLowerCase();
}

/**
 * snake_case tables and columns for camelCase TypeScript properties (architecture 7.3).
 *
 * Constraint and index names keep TypeORM's deterministic hashed names, so `db:check`
 * output is stable. Entities should name their table explicitly with `@Entity('bots')`:
 * a class name is only snake-cased, never pluralised.
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy {
  override tableName(className: string, customName: string | undefined): string {
    return customName ?? snakeCase(className);
  }

  /** An explicit column name is used exactly as given; embedded columns get a prefix. */
  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    const name = customName ?? snakeCase(propertyName);
    return embeddedPrefixes.length > 0 ? `${snakeCase(embeddedPrefixes.join('_'))}_${name}` : name;
  }

  override relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(`${relationName}_${referencedColumnName}`);
  }

  /**
   * `bots` + `tags` -> `bots_tags`. The property names are ignored on purpose; a second
   * many-to-many between the same two tables must name its `@JoinTable({ name })`.
   */
  override joinTableName(firstTableName: string, secondTableName: string): string {
    return snakeCase(`${firstTableName}_${secondTableName}`);
  }

  override joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return snakeCase(`${tableName}_${columnName ?? propertyName}`);
  }

  override joinTableInverseColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return this.joinTableColumnName(tableName, propertyName, columnName);
  }
}
