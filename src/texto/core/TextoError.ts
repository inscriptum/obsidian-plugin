export const TEXTO_ERROR = {
	INIT_ERROR: 'InitError',
	EXECUTE_COMMAND_ERROR: 'ExecuteCommandError',
	TRANSACTION_ERROR: 'TransactionError',
	SYNC_ERROR: 'SyncError',
	KNOWN_ERROR: 'KnownError',
} as const;

export type TextoErrorType = typeof TEXTO_ERROR;
export type TextoErrorTypeKey = keyof TextoErrorType;

const MAX_ERROR_MSG = 100;

function stringifyCause(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null) {
    try {
      const json = JSON.stringify(cause);
      if (json !== undefined) return json;
    } catch {
      /* ignore non-serializable values */
    }
    return '<object>';
  }
  return String(cause);
}

export class TextoError extends Error {
	name = 'TextoError';
	type: TextoErrorType[TextoErrorTypeKey];

	constructor(type: TextoErrorType[TextoErrorTypeKey], cause: unknown) {
		let message: string = type;

		if (cause instanceof Error) {
			let errorMsg = cause.message;

			if (errorMsg.length > MAX_ERROR_MSG) {
				errorMsg = `${cause.message.slice(0, MAX_ERROR_MSG - 3)}...`;
			}

			message = `${type} \n\t - ${cause.name}: ${errorMsg}`;
		} else if (cause != null) {
			message = `${type}  \n\t - ${stringifyCause(cause)}`;
		}

		super(message);

		this.message = message;
		this.type = type;
		this.cause = cause;
	}
}
