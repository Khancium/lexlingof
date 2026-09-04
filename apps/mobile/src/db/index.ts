import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import schema from './schema';
import OfflineContribution from './models/OfflineContribution';

const adapter = new SQLiteAdapter({
  schema,
  dbName: 'lexlingo_offline',
  jsi: true,
});

export const database = new Database({
  adapter,
  modelClasses: [OfflineContribution],
});
