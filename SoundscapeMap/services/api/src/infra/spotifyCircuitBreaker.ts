export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt = 0;

  constructor(
    private failureThreshold = 5,
    private windowMs = 60000,
    private cooldownMs = 300000
  ) {}

  state() {
    if (this.openedAt === 0) return 'closed';
    if (Date.now() - this.openedAt > this.cooldownMs) return 'half-open';
    return 'open';
  }

  canRequest() {
    return this.state() !== 'open';
  }

  recordSuccess() {
    this.failures = [];
    this.openedAt = 0;
  }

  recordFailure() {
    const now = Date.now();
    this.failures = this.failures.filter((timestamp) => now - timestamp <= this.windowMs);
    this.failures.push(now);
    if (this.failures.length >= this.failureThreshold) {
      this.openedAt = now;
    }
  }
}
