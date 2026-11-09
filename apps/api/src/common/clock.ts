// SPDX-License-Identifier: AGPL-3.0-only
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  override now(): Date {
    return new Date();
  }
}

export class FixedClock extends Clock {
  private current: Date;

  constructor(at: Date) {
    super();
    this.current = new Date(at.getTime());
  }

  override now(): Date {
    return new Date(this.current.getTime());
  }

  set(at: Date): void {
    this.current = new Date(at.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
