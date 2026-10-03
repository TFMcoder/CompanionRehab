export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const unavailable = () => new ApiError(503, 'unavailable', 'The connection is unavailable. A change may be unconfirmed; check its receipt before trying again.');
