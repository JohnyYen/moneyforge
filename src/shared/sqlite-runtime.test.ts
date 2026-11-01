import { DatabaseSync } from 'node:sqlite';

describe('test runtime', () => {
  it('runs SQL through node:sqlite, which backs the SqlDriver test adapter', () => {
    const db = new DatabaseSync(':memory:');

    db.exec('CREATE TABLE amounts (minor_units TEXT NOT NULL)');
    db.prepare('INSERT INTO amounts VALUES (?)').run('1000000000000000000');
    const row = db.prepare('SELECT minor_units FROM amounts').get();
    db.close();

    expect(row).toEqual({ minor_units: '1000000000000000000' });
  });
});
