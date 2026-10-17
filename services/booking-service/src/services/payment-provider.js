import { randomUUID } from 'node:crypto';

export class MockPaymentProvider {
  constructor() { this.name = 'MOCK'; }

  async charge({ paymentId: _paymentId, bookingCode: _bookingCode, amount: _amount, currency: _currency }) {
    return {
      success: true,
      transactionId: `MOCK-${randomUUID()}`
    };
  }
}
