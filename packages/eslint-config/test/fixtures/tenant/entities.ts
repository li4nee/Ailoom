// SPDX-License-Identifier: MIT
export class BotEntity {
  id!: string;
  workspaceId!: string;
}

export class UserEntity {
  id!: string;
}

type Where<T> = Partial<T>;

export interface Repository<T> {
  findOne(options: { where: Where<T> }): Promise<T | null>;
  findOneBy(where: Where<T>): Promise<T | null>;
  find(options?: { where?: Where<T> }): Promise<T[]>;
  findBy(where: Where<T>): Promise<T[]>;
  update(criteria: Where<T>, partial: Partial<T>): Promise<unknown>;
  delete(criteria: Where<T>): Promise<unknown>;
  save(entity: T): Promise<T>;
  remove(entity: T): Promise<T>;
  count(options?: { where?: Where<T> }): Promise<number>;
}
