import { Q } from '@nozbe/watermelondb';
import NetInfo from '@react-native-community/netinfo';
import RNFS from 'react-native-blob-util';
import { database } from '../db/index';
import OfflineContribution from '../db/models/OfflineContribution';
import { api } from './api.service';
import { useAppStore } from '../store/app.store';

const MAX_UPLOAD_ATTEMPTS = 3;
const COLLECTION_NAME = 'offline_contributions';

function collection() {
  return database.collections.get<OfflineContribution>(COLLECTION_NAME);
}

class SyncService {
  isRunning = false;

  startNetworkListener() {
    NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable) {
        useAppStore.getState().setOffline(false);
        this.processPendingQueue();
      } else {
        useAppStore.getState().setOffline(true);
      }
    });
  }

  async queueContribution(
    moduleType: string,
    localAudioPath: string,
    metadata: Record<string, unknown>,
    checksum: string,
  ): Promise<string> {
    const record = await database.write(() =>
      collection().create((rec) => {
        rec.moduleType = moduleType;
        rec.localAudioPath = localAudioPath;
        rec.metadataJson = JSON.stringify(metadata);
        rec.checksum = checksum;
        rec.status = 'queued';
        rec.uploadAttempts = 0;
      }),
    );

    useAppStore.getState().setPendingCount(await this.getPendingCount());

    return record.id;
  }

  async processPendingQueue(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    try {
      const items = await collection()
        .query(Q.where('status', Q.oneOf(['queued', 'failed'])), Q.where('upload_attempts', Q.lt(MAX_UPLOAD_ATTEMPTS)))
        .fetch();

      // Sequential, not Promise.all -- uploads share the same network and
      // retry budget, and one failure shouldn't race ahead of another.
      for (const item of items) {
        await this.uploadSingleItem(item);
      }
    } finally {
      this.isRunning = false;
    }

    useAppStore.getState().setPendingCount(await this.getPendingCount());
  }

  private async uploadSingleItem(item: OfflineContribution): Promise<void> {
    await database.write(() =>
      item.update((rec) => {
        rec.status = 'uploading';
        rec.uploadAttempts += 1;
      }),
    );

    try {
      const metadata = JSON.parse(item.metadataJson) as Record<string, any>;

      // Step 1: reserve an upload slot.
      const { audioFileId, uploadUrl } = await api.audio.getUploadUrl({
        module: item.moduleType,
        filename: 'recording.m4a',
        mimeType: 'audio/m4a',
        checksumSha256: item.checksum,
        fileSizeBytes: (await RNFS.fs.stat(item.localAudioPath)).size,
      });

      // Step 2: upload the file bytes.
      await RNFS.fetch('PUT', uploadUrl, { 'Content-Type': 'audio/m4a' }, RNFS.wrap(item.localAudioPath));

      // Step 3: confirm the upload.
      await api.audio.confirmUpload(audioFileId, {
        durationMs: metadata.durationMs,
        checksumSha256: item.checksum,
      });

      // Step 4: submit the contribution itself, per module type.
      let serverId: string;
      if (item.moduleType === 'WORD') {
        const res = await api.contributions.submitWord({ ...metadata, audioFileId });
        serverId = res.contributionId;
      } else if (item.moduleType === 'TRANSLATION') {
        const res = await api.contributions.submitTranslation(metadata.sentenceId, { ...metadata, audioFileId });
        serverId = res.contributionId;
      } else if (item.moduleType === 'SCENE') {
        const res = await api.scenes.submitContribution(metadata.sceneId, { ...metadata, audioFileId });
        serverId = res.contributionId;
      } else {
        // TRANSCRIPTION (Module 2) isn't queueable here -- its multi-step
        // upload/transcribe/segment flow doesn't fit a single audio+submit
        // retry unit. Fail loudly instead of silently marking it "uploaded"
        // with no server-side record.
        throw new Error(`Unsupported moduleType for offline sync: ${item.moduleType}`);
      }

      // Step 5: mark as uploaded.
      await database.write(() =>
        item.update((rec) => {
          rec.status = 'uploaded';
          rec.serverId = serverId;
          rec.audioFileId = audioFileId;
        }),
      );
    } catch (error) {
      await database.write(() =>
        item.update((rec) => {
          rec.status = rec.uploadAttempts >= MAX_UPLOAD_ATTEMPTS ? 'dead' : 'failed';
        }),
      );
      console.error('[sync] Failed to upload offline contribution', item.id, error);
    }
  }

  async getPendingCount(): Promise<number> {
    return collection()
      .query(Q.where('status', Q.oneOf(['queued', 'uploading', 'failed'])))
      .fetchCount();
  }
}

export const syncService = new SyncService();
