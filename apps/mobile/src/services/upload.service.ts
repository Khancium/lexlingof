import RNFS from 'react-native-blob-util';
import recorderPlayer, { type PlayBackType } from 'react-native-audio-recorder-player';
import { api } from './api.service';
import { stripFileScheme } from '../utils/path';

const MIME_BY_EXTENSION: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  flac: 'audio/flac',
};

function mimeTypeForPath(path: string): string {
  const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : '';
  return MIME_BY_EXTENSION[ext] ?? 'audio/mp4';
}

// Uploads an audio file (already local -- either an AudioRecorder output, or
// a picked file previously copied local via keepLocalCopy) via the
// presigned-URL flow: reserve -> PUT bytes -> confirm. Returns the
// audioFileId every module's submit endpoint expects.
export async function uploadAudioFile(params: {
  localPath: string;
  durationMs: number;
  checksumSha256: string;
  module: 'WORD' | 'TRANSCRIPTION' | 'TRANSLATION' | 'SCENE';
}): Promise<string> {
  const localPath = stripFileScheme(params.localPath);
  const filename = localPath.split('/').pop() ?? `recording_${Date.now()}.m4a`;
  const mimeType = mimeTypeForPath(filename);

  const stat = await RNFS.fs.stat(localPath);

  const { audioFileId, uploadUrl } = await api.audio.getUploadUrl({
    module: params.module,
    filename,
    mimeType,
    checksumSha256: params.checksumSha256,
    fileSizeBytes: Number(stat.size),
  });

  await RNFS.fetch('PUT', uploadUrl, { 'Content-Type': mimeType }, RNFS.wrap(localPath));

  await api.audio.confirmUpload(audioFileId, {
    durationMs: params.durationMs,
    checksumSha256: params.checksumSha256,
  });

  return audioFileId;
}

// No lightweight "read audio duration" utility is installed, so this plays
// the file muted-in-effect (immediately stopped) just to read the duration
// off the first playback event, then tears the player down.
export function getAudioDurationMs(localPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (result: number | Error) => {
      if (settled) {
        return;
      }
      settled = true;
      recorderPlayer.removePlayBackListener();
      recorderPlayer.stopPlayer().catch(() => {});
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    };

    recorderPlayer.addPlayBackListener((e: PlayBackType) => {
      if (e.duration > 0) {
        finish(e.duration);
      }
    });

    recorderPlayer.startPlayer(stripFileScheme(localPath)).catch((err) => {
      finish(err instanceof Error ? err : new Error('Failed to read audio duration'));
    });

    setTimeout(() => finish(new Error('Timed out reading audio duration')), 5000);
  });
}
