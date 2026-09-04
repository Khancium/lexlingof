import { Model } from '@nozbe/watermelondb';
import { field, readonly, date } from '@nozbe/watermelondb/decorators';

export default class OfflineContribution extends Model {
  static table = 'offline_contributions';

  @field('module_type') moduleType!: string;
  @field('local_audio_path') localAudioPath!: string;
  @field('metadata_json') metadataJson!: string;
  @field('checksum') checksum!: string;
  @field('status') status!: string;
  @field('upload_attempts') uploadAttempts!: number;
  @field('server_id') serverId?: string;
  @field('audio_file_id') audioFileId?: string;
  @readonly @date('created_at') createdAt!: Date;
}
