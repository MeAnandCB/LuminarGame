import type { Socket } from 'socket.io-client';
import { C2S } from '../../../shared/contract';
import type { AnswerResult } from '../../../shared/types';
import { ApiFailure, api } from './api';

type Ack = { ok: boolean; result?: AnswerResult; error?: { code: string; message: string } };

/**
 * Sends an answer over the socket (fast path) and falls back to HTTP with the SAME request id when the
 * socket is down or does not acknowledge in time. The server treats the request id as an idempotency key,
 * so a retry can never score twice.
 */
export async function submitAnswer(socket: Socket | null, payload: { requestId: string; answer: string; challengeId?: number; doubleDown?: boolean }): Promise<AnswerResult> {
  const viaSocket = () =>
    new Promise<AnswerResult>((resolve, reject) => {
      if (!socket?.connected) return reject(new Error('offline'));
      socket.timeout(4000).emit(C2S.submitAnswer, payload, (err: Error | null, ack: Ack) => {
        if (err) return reject(err);
        if (ack.ok && ack.result) return resolve(ack.result);
        reject(new ApiFailure(0, ack.error?.code ?? 'ERROR', ack.error?.message ?? 'Rejected.'));
      });
    });
  try {
    return await viaSocket();
  } catch (e) {
    if (e instanceof ApiFailure) throw e;
    return api<AnswerResult>('POST', '/team/answer', payload);
  }
}
