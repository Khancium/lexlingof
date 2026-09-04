import { appSchema, tableSchema } from '@nozbe/watermelondb';

export default appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'offline_contributions',
      columns: [
        { name: 'module_type', type: 'string' },
        { name: 'local_audio_path', type: 'string' },
        { name: 'metadata_json', type: 'string' },
        { name: 'checksum', type: 'string' },
        { name: 'status', type: 'string' },
        { name: 'upload_attempts', type: 'number' },
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'audio_file_id', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
      ],
    }),
  ],
});
