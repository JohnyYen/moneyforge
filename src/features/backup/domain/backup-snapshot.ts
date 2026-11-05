import { err, ok, type Result } from '@/shared/result';

export type BackupCell = string | number | null;

export type BackupTable = {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly BackupCell[])[];
};

export type BackupSnapshot = {
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly tables: readonly BackupTable[];
};

/** One column of one table, as the migrations declare it. */
export type SchemaColumn = {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
};

export type TableSchema = {
  readonly name: string;
  readonly columns: readonly SchemaColumn[];
};

export type SnapshotErrorCode =
  | 'invalid-contents'
  | 'unbalanced'
  | 'weak-passphrase'
  | 'passphrase-mismatch';

export type SnapshotError = {
  readonly code: SnapshotErrorCode;
  readonly message: string;
};

const invalid = (message: string) => err<SnapshotError>({ code: 'invalid-contents', message });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCell = (value: unknown): value is BackupCell =>
  value === null || typeof value === 'string' || typeof value === 'number';

const INTEGER_AMOUNT = /^-?\d+$/;

/**
 * ASCII bytes for a snapshot. Anything outside ASCII is written as an escape, so the payload
 * survives a text path that is not guaranteed to preserve bytes.
 */
export function encodeSnapshot(snapshot: BackupSnapshot): Uint8Array {
  const json = JSON.stringify(snapshot).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return Uint8Array.from(json, (char) => char.charCodeAt(0));
}

/** Reads back what `encodeSnapshot` wrote, or nothing when the bytes hold no JSON object. */
export function decodeSnapshot(bytes: Uint8Array): BackupSnapshot | undefined {
  if (bytes.some((byte) => byte > 0x7f)) return undefined;
  let json = '';
  for (const byte of bytes) json += String.fromCharCode(byte);
  try {
    const value: unknown = JSON.parse(json);
    return isObject(value) ? (value as unknown as BackupSnapshot) : undefined;
  } catch {
    return undefined;
  }
}

function readTable(value: unknown): BackupTable | SnapshotError {
  if (!isObject(value)) return { code: 'invalid-contents', message: 'A table is not an object.' };
  if (Object.keys(value).sort().join() !== ['name', 'columns', 'rows'].sort().join()) {
    return { code: 'invalid-contents', message: 'A table has unexpected fields.' };
  }
  const { name, columns, rows } = value;
  if (typeof name !== 'string' || name === '') {
    return { code: 'invalid-contents', message: 'A table has no name.' };
  }
  if (!Array.isArray(columns) || columns.length === 0) {
    return { code: 'invalid-contents', message: `Table ${name} has no columns.` };
  }
  if (!columns.every((column) => typeof column === 'string' && column !== '')) {
    return { code: 'invalid-contents', message: `Table ${name} has a column with no name.` };
  }
  if (new Set(columns).size !== columns.length) {
    return { code: 'invalid-contents', message: `Table ${name} names a column twice.` };
  }
  if (!Array.isArray(rows)) {
    return { code: 'invalid-contents', message: `Table ${name} has no rows list.` };
  }
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== columns.length) {
      return { code: 'invalid-contents', message: `Table ${name} has a row of another width.` };
    }
    if (!row.every(isCell)) {
      return { code: 'invalid-contents', message: `Table ${name} has a cell that is not text, a number, or empty.` };
    }
  }
  return { name, columns, rows };
}

/** Amounts are texts of minor units, summed exactly so 18-decimal currencies stay exact. */
function checkBalance(postings: BackupTable): SnapshotError | null {
  const [transactionAt, amountAt, currencyAt] = ['transaction_id', 'amount', 'currency_code'].map(
    (column) => postings.columns.indexOf(column),
  );
  if (transactionAt < 0 || amountAt < 0 || currencyAt < 0) {
    return { code: 'invalid-contents', message: 'The postings table is missing a column a ledger needs.' };
  }
  const totals = new Map<string, bigint>();
  for (const row of postings.rows) {
    const amount = row[amountAt];
    if (typeof amount !== 'string' || !INTEGER_AMOUNT.test(amount)) {
      return { code: 'invalid-contents', message: 'A posting amount is not a whole number of minor units.' };
    }
    const key = `${String(row[transactionAt])}\u0000${String(row[currencyAt])}`;
    totals.set(key, (totals.get(key) ?? 0n) + BigInt(amount));
  }
  for (const total of totals.values()) {
    if (total !== 0n) {
      return { code: 'unbalanced', message: 'This backup holds a transaction that does not balance.' };
    }
  }
  return null;
}

/**
 * Checks what the file claims about itself: the shape every reader depends on, the ledger
 * balance, and that no message text travelled in it.
 */
export function validateSnapshot(value: unknown, schemaVersion: number): Result<BackupSnapshot, SnapshotError> {
  if (!isObject(value)) return invalid('This backup holds no data.');
  if (Object.keys(value).sort().join() !== ['schemaVersion', 'createdAt', 'tables'].sort().join()) {
    return invalid('This backup has unexpected fields.');
  }
  if (value.schemaVersion !== schemaVersion) {
    return invalid('This backup does not match the version in its header.');
  }
  if (typeof value.createdAt !== 'string') {
    return invalid('This backup has no creation time.');
  }
  if (!Array.isArray(value.tables)) return invalid('This backup has no tables.');

  const tables: BackupTable[] = [];
  for (const candidate of value.tables) {
    const table = readTable(candidate);
    if ('code' in table) return err(table);
    tables.push(table);
  }
  if (new Set(tables.map((table) => table.name)).size !== tables.length) {
    return invalid('This backup names a table twice.');
  }

  const postings = tables.find((table) => table.name === 'postings');
  if (!postings) return invalid('This backup holds no ledger.');

  const inbox = tables.find((table) => table.name === 'inbox_items');
  if (inbox) {
    const bodyAt = inbox.columns.indexOf('body');
    if (bodyAt >= 0 && inbox.rows.some((row) => row[bodyAt] !== null)) {
      return invalid('This backup holds message text, which is never written there.');
    }
  }

  const balance = checkBalance(postings);
  if (balance) return err(balance);

  return ok({ schemaVersion, createdAt: value.createdAt, tables });
}

/** Compares names and types, never positions, because a restore inserts by column name. */
export function checkAgainstSchema(
  snapshot: BackupSnapshot,
  schema: readonly TableSchema[],
): Result<true, SnapshotError> {
  const expected = new Map(schema.map((table) => [table.name, table]));
  if (expected.size !== schema.length || snapshot.tables.length !== schema.length) {
    return invalid('This backup does not hold the tables this version of the app expects.');
  }

  for (const table of snapshot.tables) {
    const declared = expected.get(table.name);
    if (!declared) {
      return invalid('This backup holds a table this version of the app does not know.');
    }
    const columns = new Map(declared.columns.map((column) => [column.name, column]));
    if (columns.size !== declared.columns.length || columns.size !== table.columns.length) {
      return invalid(`A column of ${table.name} is missing or unexpected.`);
    }
    const order = table.columns.map((name) => {
      const column = columns.get(name);
      return column;
    });
    if (order.some((column) => column === undefined)) {
      return invalid(`A column of ${table.name} is missing or unexpected.`);
    }
    const required = order as SchemaColumn[];
    for (const row of table.rows) {
      for (let index = 0; index < required.length; index += 1) {
        const column = required[index];
        const cell = row[index];
        if (cell === null) {
          if (column.required) return invalid(`A required cell of ${table.name} is empty.`);
        } else if (column.type === 'INTEGER' ? typeof cell !== 'number' : typeof cell !== 'string') {
          return invalid(`A cell of ${table.name} has the wrong type.`);
        }
      }
    }
  }
  return ok(true);
}

/** A passphrase is the only thing between a copied file and the ledger, so length is enforced. */
export function checkPassphrase(
  passphrase: string,
  confirmation: string,
): Result<true, SnapshotError> {
  if ([...passphrase].length < 12 || passphrase.trim() === '') {
    return err({
      code: 'weak-passphrase',
      message: 'Use a passphrase of at least 12 characters.',
    });
  }
  if (passphrase !== confirmation) {
    return err({ code: 'passphrase-mismatch', message: 'The two passphrases are not the same.' });
  }
  return ok(true);
}
