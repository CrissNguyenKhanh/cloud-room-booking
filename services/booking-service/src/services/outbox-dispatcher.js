export class OutboxDispatcher {
  constructor(repository, notificationClient, config) {
    this.repository = repository;
    this.notificationClient = notificationClient;
    this.config = config;
  }
  async dispatchById(eventId, requestId) {
    const event = await this.repository.getOutbox(eventId);
    if (!event || event.status === 'SENT' || event.status === 'FAILED') return event;
    try {
      await this.notificationClient.send(event, requestId);
      await this.repository.markOutboxSent(event.event_id);
      return { ...event, status: 'SENT' };
    } catch (error) {
      const attempts = Number(event.attempts) + 1;
      const retryable = error.transient !== false;
      const status = !retryable || attempts >= this.config.outboxMaxAttempts ? 'FAILED' : 'PENDING';
      const delaySeconds = Math.min(300, 2 ** attempts);
      await this.repository.markOutboxFailure(event.event_id, {
        attempts, status, nextRetryAt: new Date(Date.now() + delaySeconds * 1000), error: error.message
      });
      return { ...event, attempts, status };
    }
  }
  async retryBatch(requestId) {
    const events = await this.repository.listDueOutbox(this.config.outboxBatchSize);
    const results = [];
    for (const event of events) results.push(await this.dispatchById(event.event_id, requestId));
    return results;
  }
}
