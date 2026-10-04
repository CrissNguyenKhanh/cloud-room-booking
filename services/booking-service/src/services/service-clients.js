import { ApiError } from '../utils/errors.js';

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  catch (error) {
    const wrapped = new Error(error.name === 'AbortError' ? 'Downstream request timed out' : 'Downstream service unavailable');
    wrapped.transient = true;
    throw wrapped;
  } finally { clearTimeout(timer); }
}

export function createIdentityClient(config) {
  return {
    async assertActive(userId, requestId) {
      const response = await fetchWithTimeout(`${config.identityServiceUrl}/internal/v1/users/${userId}/status`, {
        headers: { 'X-Service-Key': config.internalServiceKey, 'X-Request-Id': requestId }
      }, config.identityTimeoutMs);
      if (!response.ok) {
        if (response.status === 404) throw new ApiError(403, 'ACCOUNT_NOT_AVAILABLE', 'Tài khoản không khả dụng');
        const error = new ApiError(response.status >= 500 ? 503 : response.status, 'IDENTITY_CHECK_FAILED', 'Không thể xác minh tài khoản');
        error.transient = response.status >= 500 || response.status === 429;
        throw error;
      }
      const { data } = await response.json();
      if (data.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_LOCKED', 'Tài khoản đã bị khóa');
      return data;
    }
  };
}

export function createNotificationClient(config) {
  return {
    async send(event, requestId) {
      const response = await fetchWithTimeout(`${config.notificationServiceUrl}/internal/v1/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Service-Key': config.internalServiceKey, 'X-Request-Id': requestId },
        body: JSON.stringify({ event_id: event.event_id, event_type: event.event_type, aggregate_id: event.aggregate_id,
          user_id: event.user_id, payload: event.payload, occurred_at: event.created_at })
      }, config.notificationTimeoutMs);
      if (!response.ok) {
        const error = new Error(`Notification responded with ${response.status}`);
        error.transient = response.status === 408 || response.status === 429 || response.status >= 500;
        throw error;
      }
    }
  };
}
